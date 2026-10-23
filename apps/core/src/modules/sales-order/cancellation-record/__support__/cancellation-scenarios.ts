import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CORE_ORDER_STREAM, FULFILLMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  receiveStock,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
  wireLogistics,
} from '../../../fulfillment/services/__support__';
import { ambientDbService, assembleOutbound } from '../../../fulfillment/services/__support__/simple-outbound-wiring';
import { outboxPublisherFor } from '../../../fulfillment/outbox/__support__/outbox-publisher.factory';
import { SalesOrdersService } from '../../services/sales-orders.service';

/**
 * 판매주문 취소 통합 스펙이 함께 쓰는 배선·시드 (K6).
 * 취소 기록 스펙(PR 1)과 라인 수량 문 일치 스펙(PR 2a)이 같은 실제 쓰기 경로(`salesOrders.cancel`)로 시나리오를 만든다.
 */
const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

export function wireCancellation(tx: DbTx) {
  const dbService = ambientDbService(tx);
  const logistics = wireLogistics(dbService);
  const outbound = assembleOutbound(tx);
  const salesOrders = new SalesOrdersService(
    dbService,
    outboxPublisherFor(FULFILLMENT_STREAM, dbService),
    outboxPublisherFor(CORE_ORDER_STREAM, dbService),
    logistics.lifecycle,
    logistics.productSkuMapping,
    logistics.sellable,
    logistics.backlog,
    undefined,
    undefined,
    undefined,
    { get: () => outbound.planning } as never,
  );
  return { logistics, salesOrders };
}

/** 라인 하나(주문 수량 quantity), 매칭 SKU 하나 × 1, 재고 넉넉. */
export async function seedCancellableOrder(tx: DbTx, w: ReturnType<typeof wireCancellation>, quantity: number) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const { skuId } = await seedSku(tx, holderId);
  await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
  const variantId = randomUUID();
  await seedMatching(tx, { variantId, skuId, quantity: 1 });
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, { lines: [{ variantId, quantity }] });
  await tx
    .update(wmsTables.salesOrders)
    .set({ shippingAddress: ADDRESS })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  return { salesOrderId, lineId: lineIds[0], warehouseId, skuId };
}

/**
 * 상자 없는 옛(상자 전) FO 를 두고 셀메이트 스크립트(scripts/ops/cellmate-local/mark-core-shipped.js)처럼 출고로 표시한다 —
 * FO status='shipped'·shipped_at, FOI shipped_qty=qty·status='shipped'. 상자가 없으니 취소는 상자 전 경로를 탄다.
 */
export async function seedShippedV1Fulfillment(
  tx: DbTx,
  o: { salesOrderId: string; lineId: string; warehouseId: string; skuId: string },
  qty: number,
) {
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({ salesOrderId: o.salesOrderId, warehouseId: o.warehouseId, totalItems: 1, totalQty: qty })
    .returning();
  await tx.insert(wmsTables.fulfillmentOrderItems).values({
    fulfillmentOrderId: fo.id,
    salesOrderId: o.salesOrderId,
    salesOrderLineId: o.lineId,
    skuId: o.skuId,
    qty,
  });
  await tx
    .update(wmsTables.fulfillmentOrders)
    .set({ status: 'shipped', shippedAt: new Date(), updatedAt: new Date() })
    .where(eq(wmsTables.fulfillmentOrders.id, fo.id));
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty: qty, status: 'shipped', updatedAt: new Date() })
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id));
}
