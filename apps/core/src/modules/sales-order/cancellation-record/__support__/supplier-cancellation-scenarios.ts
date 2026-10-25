import { randomUUID } from 'crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  receiveStock,
  seedHolder,
  seedMatching,
  seedSalesOrder,
  seedSku,
  seedWarehouseWithZone,
} from '../../../fulfillment/services/__support__';
import { seedHandoff } from '../../../fulfillment/order-progress/__support__/order-progress.fixtures';
import type { wireCancellation } from './cancellation-scenarios';

/**
 * 직배(입점사 상자)가 낀 판매주문 취소 통합 스펙의 시드 (K3 PR6).
 * 상자는 실제 FO 생성(`fulfillments.create`)이 만든다 — 직배분은 입점사마다 draft 상자 하나(K3 PR4).
 */
const RECIPIENT = {
  recipientName: '홍길동',
  phone: '010-1234-5678',
  postalCode: '06236',
  roadAddress: '서울 강남구 테헤란로 1',
  detailAddress: '101호',
};

export async function seedDirectSupplier(tx: DbTx): Promise<string> {
  const [row] = await tx
    .insert(wmsTables.suppliers)
    .values({ name: `it-direct-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
    .returning();
  return row.id;
}

/**
 * 라인 = SKU 하나(매칭 1:1). 입점사 라인이 앞, 창고 라인(`warehouseQty`)이 맨 뒤 — `lineIds` 도 그 순서다.
 * `supplierIds` 를 넘기면 같은 키의 입점사를 다시 쓴다(합포장처럼 두 주문이 한 입점사를 공유할 때).
 */
export async function seedSupplierCancellableOrder(
  tx: DbTx,
  w: ReturnType<typeof wireCancellation>,
  input: {
    warehouseQty?: number;
    supplierLines: Array<{ supplierKey: string; quantity: number }>;
    supplierIds?: Record<string, string>;
  },
): Promise<{
  salesOrderId: string;
  lineIds: string[];
  foId: string;
  supplierIds: Record<string, string>;
  warehouseId: string;
}> {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const supplierIds: Record<string, string> = { ...(input.supplierIds ?? {}) };
  const lines: Array<{ skuId: string; quantity: number }> = [];
  for (const line of input.supplierLines) {
    supplierIds[line.supplierKey] ??= await seedDirectSupplier(tx);
    const { skuId } = await seedSku(tx, holderId);
    await tx.update(wmsTables.skus).set({ stockType: 'drop_shipped' }).where(eq(wmsTables.skus.id, skuId));
    await tx
      .insert(wmsTables.skuSuppliers)
      .values({ skuId, supplierId: supplierIds[line.supplierKey], supplierSku: `SUP-${skuId.slice(0, 6)}` });
    lines.push({ skuId, quantity: line.quantity });
  }
  if (input.warehouseQty) {
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 100 });
    lines.push({ skuId, quantity: input.warehouseQty });
  }
  const variants = lines.map(() => randomUUID());
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
    lines: lines.map((line, i) => ({ variantId: variants[i], quantity: line.quantity })),
  });
  for (const [i, line] of lines.entries()) await seedMatching(tx, { variantId: variants[i], skuId: line.skuId });
  // 발송(입점사 포함)은 라인의 채널 식별자를 요구한다
  for (const lineId of lineIds) {
    await tx
      .update(wmsTables.salesOrderLines)
      .set({ channelOrderItemId: `item-${lineId.slice(0, 8)}` })
      .where(eq(wmsTables.salesOrderLines.id, lineId));
  }
  await tx
    .update(wmsTables.salesOrders)
    .set({ shippingAddress: RECIPIENT })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));
  const fo = await w.logistics.fulfillments.create({ salesOrderId, warehouseId }, tx);
  if (!fo) throw new Error('expected a fulfillment order');
  return { salesOrderId, lineIds, foId: fo.id, supplierIds, warehouseId };
}

/** 그 판매주문의 상자(상자 id 순)와 라인. */
export async function boxesOfOrder(tx: DbTx, salesOrderId: string) {
  const lines = await tx
    .select({
      line: wmsTables.shipmentLines,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
  const ids = [...new Set(lines.map((row) => row.line.shipmentId))];
  if (ids.length === 0) return [];
  const shipments = await tx
    .select()
    .from(wmsTables.shipments)
    .where(inArray(wmsTables.shipments.id, ids))
    .orderBy(asc(wmsTables.shipments.id));
  return shipments.map((shipment) => ({
    shipment,
    lines: lines
      .filter((row) => row.line.shipmentId === shipment.id)
      .map((row) => ({ ...row.line, salesOrderLineId: row.salesOrderLineId })),
  }));
}

/** 그 입점사의 살아 있는(draft) 상자 — 주문 하나에 입점사 상자는 하나다. */
export async function draftSupplierBoxOf(tx: DbTx, salesOrderId: string, supplierId: string) {
  const box = (await boxesOfOrder(tx, salesOrderId)).find(
    (b) => b.shipment.supplierId === supplierId && b.shipment.status === 'draft',
  );
  if (!box) throw new Error(`no draft supplier box of ${supplierId} in ${salesOrderId}`);
  return box;
}

/** 넘김 기록을 찍는다(넘김 서비스의 시트 조립은 이 스펙의 관심이 아니다). */
export async function markHandedOff(tx: DbTx, shipmentId: string, supplierId: string): Promise<string> {
  const handoffId = await seedHandoff(tx, supplierId);
  await tx
    .update(wmsTables.shipments)
    .set({ supplierHandoffId: handoffId })
    .where(eq(wmsTables.shipments.id, shipmentId));
  return handoffId;
}

export function cancelNoticesOf(tx: DbTx, salesOrderId: string) {
  return tx
    .select()
    .from(wmsTables.directShipCancelNotices)
    .where(eq(wmsTables.directShipCancelNotices.salesOrderId, salesOrderId))
    .orderBy(asc(wmsTables.directShipCancelNotices.createdAt), asc(wmsTables.directShipCancelNotices.id));
}
