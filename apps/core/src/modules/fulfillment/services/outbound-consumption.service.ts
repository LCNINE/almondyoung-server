import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import {
  LOCATION_RESOLUTION_STRATEGY,
  LocationResolutionStrategy,
} from '../../inventory/core/services/location-resolution.strategy';
import { ReservationLifecycleService } from '../../inventory/shared/services/reservation-lifecycle.service';

/**
 * 출고 종결 seam (Phase 0). Phase 1 의 `consumeShipment`(상자 단위) 의 stand-in —
 * 현재 1:1(운송장=FO) 모델에서 FO 단위로 재고원장을 소진한다.
 *
 * fulfillment 모듈에 둔다 — 소진은 `InventoryCommandService`(원장 쓰기) + 예약 닫기를
 * 함께 오케스트레이션하므로, shared 에 두면 core↔shared 순환이 생긴다.
 * (inventory→fulfillment 역방향 import 없음 → 순환 없음.)
 */
@Injectable()
export class OutboundConsumptionService {
  private readonly logger = new Logger(OutboundConsumptionService.name);

  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    @Inject(LOCATION_RESOLUTION_STRATEGY) private readonly locationStrategy: LocationResolutionStrategy,
    private readonly inventoryCommand: InventoryCommandService,
    private readonly reservationLifecycle: ReservationLifecycleService,
  ) {}

  /**
   * FO 의 출고분을 재고원장에서 소진한다.
   *
   * FOI 별로: 차감 로케이션을 전략(FIFO)으로 정하고, chunk 마다 SHIP 이벤트를 원장에
   * append(on_hand 차감) + 예약을 **소진**(release 아님). on_hand 와 reserved 가 함께
   * 줄어 available 은 불변 (ADR-0027 결정 5). 호출자(`FulfillmentsService.ship`)가
   * 이미 `FOI.shippedQty` 를 세팅한 뒤 호출하므로 그 값을 소진 수량으로 쓴다.
   *
   * 멱등: SHIP `idempotencyKey = ship:{foId}:{foiId}:{locationId}` (상위 status 전이
   * FOR UPDATE 는 호출자 `ship()` 가 1차로 보장).
   */
  async consumeFulfillmentOrder(fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.db.run(async (trx) => {
      const [fo] = await trx
        .select({
          id: wmsTables.fulfillmentOrders.id,
          warehouseId: wmsTables.fulfillmentOrders.warehouseId,
        })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!fo) {
        throw new NotFoundException(`Fulfillment order ${fulfillmentOrderId} not found`);
      }
      if (!fo.warehouseId) {
        throw new Error(`FO ${fulfillmentOrderId} 에 warehouseId 가 없어 출고 소진 불가 (불변식 위반)`);
      }
      const warehouseId = fo.warehouseId;

      const items = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      for (const item of items) {
        if (item.shippedQty <= 0) continue;

        const chunks = await this.locationStrategy.resolve(item.skuId, warehouseId, item.shippedQty, trx);
        for (const chunk of chunks) {
          await this.inventoryCommand.ship(
            {
              skuId: item.skuId,
              warehouseId,
              locationId: chunk.locationId,
              quantity: chunk.qty,
              idempotencyKey: `ship:${fulfillmentOrderId}:${item.id}:${chunk.locationId}`,
              reason: `FO ${fulfillmentOrderId} shipped`,
            },
            trx,
          );
        }
      }

      // 예약 소진(환원 아님) — SHIP 이벤트가 위에서 emit 됐으므로 available 불변.
      await this.reservationLifecycle.consumeFulfillmentOrderReservations(fulfillmentOrderId, trx);

      this.logger.log(`Consumed FO ${fulfillmentOrderId}: ${items.length} FOI shipped to ledger`);
    }, tx);
  }
}
