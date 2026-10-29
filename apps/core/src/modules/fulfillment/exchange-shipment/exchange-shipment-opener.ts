import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { BadRequestError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import type { CompositionItem } from '../../product-matching/line-composition/line-composition';
import { ShipmentReservationService } from '../services/shipment-reservation.service';
import { compatibleShippingProfileId } from '../services/shipping-profile';
import { openShipment } from '../shipment/shipment-lifecycle';
import { reprojectFulfillmentOrders } from '../fulfillment-order/fulfillment-order-projection';

/** 다시 보낼 판매 줄 하나 — 줄 수량 × 굳은 구성이 FOI·상자 줄이 된다 */
export type ExchangeShipmentLine = {
  salesOrderLineId: string;
  variantId: string;
  quantity: number;
  composition: readonly CompositionItem[];
};

export type ExchangeShipmentRequest = {
  salesOrderId: string;
  lines: readonly ExchangeShipmentLine[];
  recipientSnapshot: unknown;
  entrancePassword: string | null;
};

/**
 * 교환 상자 열기의 출고 쪽 쓰기 (K8 PR11 N13) — 판매주문의 기존 FO 에 FOI 를 더하고, FO 창고의 draft 상자 하나를 열어
 * 예약을 건다. FO 생성(`FulfillmentsService.createV2`)과 같은 도구·순서다: `openShipment` → 재고 키 잠금 → 줄 id 순
 * `reservePartial` → 하나도 안 움직였으면 `recompute` → 투영. 재고가 모자라면 덜 잡힌 draft 로 남는다(던지지 않는다).
 * 판매주문 쪽(교환 기록·교환 줄)은 부르는 쪽이 정한다 — 판매주문 코드는 출고 표를 직접 쓰지 않는다(K7 가드).
 * 부르는 쪽이 판매주문을 잠근 트랜잭션 안에서 부른다.
 */
@Injectable()
export class ExchangeShipmentOpener {
  constructor(private readonly shipmentReservation: ShipmentReservationService) {}

  async open(trx: DbTx, request: ExchangeShipmentRequest): Promise<{ fulfillmentOrderId: string; shipmentId: string }> {
    // 판매주문:FO 는 0..1 — 교환은 배송완료한 주문에만 생기므로 FO 가 없으면 결함이다
    const [fo] = await trx
      .select({ id: wmsTables.fulfillmentOrders.id, warehouseId: wmsTables.fulfillmentOrders.warehouseId })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, request.salesOrderId))
      .for('update');
    if (!fo) throw new Error(`Sales order ${request.salesOrderId} has no fulfillment order to re-ship an exchange`);
    const warehouseId = fo.warehouseId;
    if (warehouseId === null) {
      throw new BadRequestError('교환은 창고에서 내보내는 상품만 받습니다 — 이 주문의 출고주문에 창고가 없습니다');
    }
    if (request.lines.length === 0) throw new Error(`Exchange re-shipment for ${request.salesOrderId} has no lines`);

    const itemsToInsert: Array<typeof wmsTables.fulfillmentOrderItems.$inferInsert> = request.lines.flatMap((line) => {
      if (line.composition.length === 0) {
        throw new Error(`Exchange line ${line.salesOrderLineId} has no frozen composition`);
      }
      return line.composition.map((item) => ({
        fulfillmentOrderId: fo.id,
        salesOrderId: request.salesOrderId,
        salesOrderLineId: line.salesOrderLineId,
        variantId: line.variantId,
        skuId: item.skuId,
        qty: line.quantity * item.qtyPerUnit,
        reservedQty: 0,
        pickedQty: 0,
        shippedQty: 0,
        status: 'pending',
      }));
    });
    const skuRows = await trx
      .select({ stockType: wmsTables.skus.stockType, deliveryProfileId: wmsTables.skus.deliveryProfileId })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, [...new Set(itemsToInsert.map((item) => item.skuId))]));
    // 직배 SKU 는 입점사 상자가 필요하다 — 이 PR 범위 밖이라 창고 상자에 섞지 않고 거절한다
    if (skuRows.some((row) => row.stockType === 'drop_shipped')) {
      throw new BadRequestError('교환은 창고에서 내보내는 상품만 받습니다 — 입점사 직배 상품이 섞여 있습니다');
    }

    const insertedItems = await trx.insert(wmsTables.fulfillmentOrderItems).values(itemsToInsert).returning();
    await this.recomputeTotals(trx, fo.id);
    const { shipment, lines } = await openShipment(
      trx,
      {
        owner: { kind: 'warehouse', warehouseId },
        status: 'draft',
        shippingProfileId: compatibleShippingProfileId(skuRows.map((row) => row.deliveryProfileId)),
        recipientSnapshot: request.recipientSnapshot,
        entrancePassword: request.entrancePassword,
      },
      insertedItems.map((item) => ({ fulfillmentOrderItemId: item.id, skuId: item.skuId, qty: item.qty })),
    );

    // 잠금 순서는 예약 커널과 같다: 이 상자가 닿는 FOI·상자 그래프(이미 배송완료된 원래 상자·앞선 교환 상자 포함)를 먼저,
    // 그다음 재고 키(SKU 정렬). reservePartial 은 같은 순서로 다시 들어와도 안전하다. 재고 키를 먼저 잡으면 그래프를 먼저 잡는
    // 재시도 워커·작성 중 상자 맞추기와 엇갈려 교착할 수 있다
    await this.shipmentReservation.lockShipmentGraphForDispatch(shipment.id, trx);
    await acquireStockAvailabilityLocks(
      trx,
      lines.map((line) => ({ skuId: line.skuId, warehouseId })),
    );
    let mutated = false;
    for (const line of [...lines].sort((a, b) => a.id.localeCompare(b.id))) {
      const result = await this.shipmentReservation.reservePartial(line.id, line.qty, trx);
      mutated ||= result.mutated;
    }
    if (!mutated) await this.shipmentReservation.recompute(shipment.id, trx);
    await reprojectFulfillmentOrders(trx, [fo.id]);
    return { fulfillmentOrderId: fo.id, shipmentId: shipment.id };
  }

  /** FO 합계 칸 — 작성 중 상자 맞추기(DraftBoxAmender)와 같은 셈(qty 0 항목은 품목 수에 세지 않는다) */
  private async recomputeTotals(trx: DbTx, fulfillmentOrderId: string): Promise<void> {
    const items = wmsTables.fulfillmentOrderItems;
    const [totals] = await trx
      .select({
        totalItems: sql<number>`count(*) filter (where ${items.qty} > 0)::int`,
        totalQty: sql<number>`coalesce(sum(${items.qty}), 0)::int`,
      })
      .from(items)
      .where(eq(items.fulfillmentOrderId, fulfillmentOrderId));
    await trx
      .update(wmsTables.fulfillmentOrders)
      .set({ totalItems: totals.totalItems, totalQty: totals.totalQty, updatedAt: new Date() })
      .where(eq(wmsTables.fulfillmentOrders.id, fulfillmentOrderId));
  }
}
