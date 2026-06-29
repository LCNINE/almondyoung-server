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
 * 출고 종결 seam (Phase 1). 상자(shipment) 단위로 재고원장을 소진한다.
 *
 * fulfillment 모듈에 둔다 — 소진은 `InventoryCommandService`(원장 쓰기) + 예약 닫기를
 * 함께 오케스트레이션하므로, shared 에 두면 core↔shared 순환이 생긴다.
 * (inventory→fulfillment 역방향 import 없음 → 순환 없음.)
 *
 * 현재 FO↔상자 1:1 — 상자 라인은 그 FO 의 FOI 를 미러한다. 모델은 M:N(송장분할·합배송)을
 * 표현하지만 그 흐름 구현은 후속(RFC Non-Goal).
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
   * packing 연산: 상자에 그 FO 의 FOI 를 미러한 `shipment_line` 을 생성한다.
   *
   * qty 는 `FOI.shippedQty` (호출자 `ship()` 가 이미 세팅) — `shippedQty<=0` 라인은 건너뛴다.
   * 멱등: `unique(shipmentId, foiId)` + `onConflictDoNothing` — ship 재시도/수렴 호출(invoice·
   * direct-ship 경유 중복)에 안전. 라인은 Phase 1 에선 생성 직후 소진되는 scaffolding 이며,
   * 독립 운영가치(검수·분할)는 Phase 2 부터.
   */
  async ensureShipmentLines(shipmentId: string, fulfillmentOrderId: string, tx?: DbTx): Promise<void> {
    return this.db.run(async (trx) => {
      const items = await trx
        .select({
          id: wmsTables.fulfillmentOrderItems.id,
          skuId: wmsTables.fulfillmentOrderItems.skuId,
          shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
        })
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));

      const lines = items
        .filter((it) => it.shippedQty > 0)
        .map((it) => ({
          shipmentId,
          fulfillmentOrderItemId: it.id,
          skuId: it.skuId,
          qty: it.shippedQty,
        }));

      if (lines.length === 0) return;

      await trx
        .insert(wmsTables.shipmentLines)
        .values(lines)
        .onConflictDoNothing({
          target: [wmsTables.shipmentLines.shipmentId, wmsTables.shipmentLines.fulfillmentOrderItemId],
        });
    }, tx);
  }

  /**
   * 상자의 라인을 재고원장에서 소진한다.
   *
   * 라인별: 차감 로케이션을 전략(FIFO)으로 정하고, chunk 마다 SHIP 이벤트를 원장에
   * append(on_hand 차감) + 예약을 **소진**(release 아님). on_hand 와 reserved 가 함께
   * 줄어 available 은 불변 (ADR-0027 결정 5). SHIP 들은 한 `stock_journal` 로 묶여
   * 작업자(`shipment.openedBy`)에게 귀속된다.
   *
   * 멱등: SHIP `idempotencyKey = ship:{shipmentId}:{lineId}:{locationId}`, journal 은
   * `ship:{shipmentId}` (상위 status 전이 FOR UPDATE 는 호출자 `ship()` 가 1차 보장).
   */
  async consumeShipment(shipmentId: string, tx?: DbTx): Promise<void> {
    return this.db.run(async (trx) => {
      const [shipment] = await trx
        .select({
          id: wmsTables.shipments.id,
          fulfillmentOrderId: wmsTables.shipments.fulfillmentOrderId,
          openedBy: wmsTables.shipments.openedBy,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);
      if (!shipment) {
        throw new NotFoundException(`Shipment ${shipmentId} not found`);
      }
      const fulfillmentOrderId = shipment.fulfillmentOrderId;
      if (!fulfillmentOrderId) {
        throw new Error(`Shipment ${shipmentId} 에 fulfillmentOrderId 가 없어 출고 소진 불가 (불변식 위반)`);
      }

      // warehouseId 는 FO 에서 도출 (Phase 1 shipments 에 warehouseId 컬럼 없음 — Phase 2 추가).
      const [fo] = await trx
        .select({ warehouseId: wmsTables.fulfillmentOrders.warehouseId })
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId))
        .limit(1);
      if (!fo?.warehouseId) {
        throw new Error(`FO ${fulfillmentOrderId} 에 warehouseId 가 없어 출고 소진 불가 (불변식 위반)`);
      }
      const warehouseId = fo.warehouseId;

      const lines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          skuId: wmsTables.shipmentLines.skuId,
          qty: wmsTables.shipmentLines.qty,
        })
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));

      if (lines.length === 0) {
        this.logger.warn(`Shipment ${shipmentId} 에 소진할 라인이 없음 (no-op)`);
        return;
      }

      // 작업자 귀속: SHIP 이벤트들을 한 journal 로 묶는다 (actorId = 박스 연 작업자).
      const journalId = await this.ensureShipJournal(trx, shipmentId, shipment.openedBy ?? null);

      for (const line of lines) {
        const chunks = await this.locationStrategy.resolve(line.skuId, warehouseId, line.qty, trx);
        for (const chunk of chunks) {
          await this.inventoryCommand.ship(
            {
              skuId: line.skuId,
              warehouseId,
              locationId: chunk.locationId,
              quantity: chunk.qty,
              idempotencyKey: `ship:${shipmentId}:${line.id}:${chunk.locationId}`,
              reason: `Shipment ${shipmentId} shipped`,
              journalId,
            },
            trx,
          );
        }
      }

      // 예약 소진(환원 아님) — SHIP 이벤트가 위에서 emit 됐으므로 available 불변.
      // Phase 1 은 FO 1:1 이라 상자=FO 의 예약을 닫는다.
      await this.reservationLifecycle.consumeFulfillmentOrderReservations(fulfillmentOrderId, trx);

      this.logger.log(`Consumed shipment ${shipmentId}: ${lines.length} line(s) shipped to ledger`);
    }, tx);
  }

  /**
   * 출고 SHIP journal 을 멱등하게 확보한다. `ship:{shipmentId}` idempotencyKey 로 재실행 시 재사용.
   * actorId = 박스 연 작업자(openedBy) — null 이면 무귀속(graceful).
   */
  private async ensureShipJournal(trx: DbTx, shipmentId: string, openedBy: string | null): Promise<string> {
    const idempotencyKey = `ship:${shipmentId}`;
    const [created] = await trx
      .insert(wmsTables.stockJournals)
      .values({ sourceType: 'SHIPMENT', sourceId: shipmentId, actorId: openedBy, idempotencyKey })
      .onConflictDoNothing({ target: wmsTables.stockJournals.idempotencyKey })
      .returning({ id: wmsTables.stockJournals.id });
    if (created) return created.id;

    const [existing] = await trx
      .select({ id: wmsTables.stockJournals.id })
      .from(wmsTables.stockJournals)
      .where(eq(wmsTables.stockJournals.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!existing) {
      throw new Error(`Failed to ensure ship journal for shipment ${shipmentId}`);
    }
    return existing.id;
  }
}
