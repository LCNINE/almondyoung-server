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
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';

/**
 * 출고 종결 seam (Cluster A). 상자(shipment) 단위로 출고를 **전체 종결**한다.
 *
 * fulfillment 모듈에 둔다 — 종결은 `InventoryCommandService`(원장 쓰기) + 예약 닫기 +
 * FOI/FO/박스 status 전이를 함께 오케스트레이션하므로,
 * shared 에 두면 core↔shared 순환이 생긴다.
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
    private readonly workflowGate: FulfillmentWorkflowGate,
  ) {}

  /**
   * 상자를 재고원장에서 소진하고 출고를 **전체 종결**한다.
   *
   * 라인별: 차감 로케이션을 전략(FIFO)으로 정하고, chunk 마다 SHIP 이벤트를 원장에
   * append(on_hand 차감) + 예약을 **소진**(release 아님). on_hand 와 reserved 가 함께
   * 줄어 available 은 불변 (ADR-0027 결정 5). SHIP 들은 한 `stock_journal` 로 묶여
   * 작업자(`shipment.openedBy`)에게 귀속된다. 이어서 FOI.shippedQty 누적·FOI/FO/박스
   * status 전이까지 한 트랜잭션으로 끝낸다. 외부 자사출고 신호는 V2의
   * ShipmentShipped consumer만 소유하며 이 legacy seam은 V1을 발행하지 않는다.
   *
   * 멱등: 박스가 이미 'shipped' 면 early-return. SHIP `idempotencyKey =
   * ship:{shipmentId}:{lineId}:{locationId}`, journal 은 `ship:{shipmentId}`.
   */
  async consumeShipment(shipmentId: string, tx?: DbTx): Promise<void> {
    this.workflowGate.assertMutationAllowed('shipment.consume');
    return this.db.run(async (trx) => {
      const [shipment] = await trx
        .select({
          id: wmsTables.shipments.id,
          foId: wmsTables.shipments.openedForFulfillmentOrderId,
          openedBy: wmsTables.shipments.openedBy,
          warehouseId: wmsTables.shipments.warehouseId,
          status: wmsTables.shipments.status,
        })
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, shipmentId))
        .limit(1);
      if (!shipment) {
        throw new NotFoundException(`Shipment ${shipmentId} not found`);
      }
      // 멱등: 이미 종결된 박스는 no-op (재시도/수렴 호출 안전).
      if (shipment.status === 'shipped') {
        return;
      }
      const fulfillmentOrderId = shipment.foId;
      if (!fulfillmentOrderId) {
        throw new Error(`Shipment ${shipmentId} 에 openedForFulfillmentOrderId 가 없어 출고 소진 불가 (불변식 위반)`);
      }
      const warehouseId = shipment.warehouseId;

      const lines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          foiId: wmsTables.shipmentLines.fulfillmentOrderItemId,
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
      const now = new Date();

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

        // FOI.shippedQty 누적 + qty 충족 시 FOI status 전이.
        const [foi] = await trx
          .select({
            qty: wmsTables.fulfillmentOrderItems.qty,
            shippedQty: wmsTables.fulfillmentOrderItems.shippedQty,
          })
          .from(wmsTables.fulfillmentOrderItems)
          .where(eq(wmsTables.fulfillmentOrderItems.id, line.foiId))
          .limit(1);
        const newShipped = (foi?.shippedQty ?? 0) + line.qty;
        await trx
          .update(wmsTables.fulfillmentOrderItems)
          .set({
            shippedQty: newShipped,
            // A 는 box=FO 전량이라 항상 full→'shipped' 분기만 탄다. 'pending' 회귀 분기는 부분출고
            // (Cluster B)에서 FOI 의 기존 status(approved 등)를 덮을 수 있어 B 에서 재검토 대상.
            status: newShipped >= (foi?.qty ?? newShipped) ? 'shipped' : 'pending',
            updatedAt: now,
          })
          .where(eq(wmsTables.fulfillmentOrderItems.id, line.foiId));
      }

      // 예약 소진(환원 아님) — SHIP 이벤트가 위에서 emit 됐으므로 available 불변.
      // FO 1:1 이라 상자=FO 의 예약을 닫는다.
      await this.reservationLifecycle.consumeFulfillmentOrderReservations(fulfillmentOrderId, trx);

      // 박스/FO status 전이 (전체 종결).
      await trx
        .update(wmsTables.shipments)
        .set({ status: 'shipped', shippedAt: now, lastUpdated: now })
        .where(eq(wmsTables.shipments.id, shipmentId));
      await trx
        .update(wmsTables.fulfillmentOrders)
        .set({ status: 'shipped', shippedAt: now, updatedAt: now })
        .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));

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
