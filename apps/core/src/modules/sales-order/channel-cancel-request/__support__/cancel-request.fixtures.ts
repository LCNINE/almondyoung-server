import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  wireLogistics,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
} from '../../../fulfillment/services/__support__';

export const ADDRESS = { recipientName: '김', phone: '010-1', postalCode: '12345', roadAddress: '서울', detailAddress: '101' };

/** 판매주문(채널 라인 2개 — 수량 2·1) → 선택적으로 FO(→ draft 박스). channel-order-change 스펙의 seedOrder 와 같은 모양. */
export async function seedChannelOrder(
  tx: DbTx,
  w: { logistics: ReturnType<typeof wireLogistics> },
  opts: { withFo: boolean; salesChannel?: 'medusa' | 'naver' | 'coupang' | '3pl'; noChannelItemIds?: boolean },
) {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const lines = [
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 2 },
    { item: `ci-${randomUUID().slice(0, 6)}`, qty: 1 },
  ];
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `ext-${randomUUID().slice(0, 8)}`,
      salesChannel: opts.salesChannel ?? 'medusa',
      status: 'confirmed',
      shippingAddress: ADDRESS,
      orderDate: new Date(),
    })
    .returning();
  const lineIds: string[] = [];
  for (const line of lines) {
    const { skuId } = await seedSku(tx, holderId);
    await receiveStock(w.logistics.command, tx, { skuId, warehouseId, locationId, quantity: 10 });
    const variantId = randomUUID();
    await seedMatching(tx, { variantId, skuId, quantity: 1 });
    const [row] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId,
        productName: 'IT',
        quantity: line.qty,
        unitPrice: 1000,
        channelOrderItemId: opts.noChannelItemIds ? null : line.item,
        channelProductId: `cp-${line.item}`,
      })
      .returning();
    lineIds.push(row.id);
  }
  if (opts.withFo) await w.logistics.fulfillments.create({ salesOrderId: so.id, warehouseId }, tx);
  return { salesOrderId: so.id, externalOrderId: so.channelOrderId, lines, lineIds, warehouseId };
}

export type SeededOrder = Awaited<ReturnType<typeof seedChannelOrder>>;

/** 수집된 변경. 기본은 «아무것도 안 바뀜». */
export function modifiedPayload(
  seed: SeededOrder,
  over: { quantities?: number[]; cancelRequests?: OrderModifiedPayload['snapshot']['cancelRequests']; address?: typeof ADDRESS } = {},
): OrderModifiedPayload {
  return {
    orderId: randomUUID(),
    salesChannel: 'medusa',
    externalOrderId: seed.externalOrderId,
    modifiedAt: new Date().toISOString(),
    snapshot: {
      shippingAddress: over.address ?? ADDRESS,
      lines: seed.lines.map((line, i) => ({
        channelOrderItemId: line.item,
        channelProductId: `cp-${line.item}`,
        quantity: over.quantities?.[i] ?? line.qty,
        unitPrice: 1000,
        cancelled: false,
      })),
      ...(over.cancelRequests ? { cancelRequests: over.cancelRequests } : {}),
    },
  };
}

/** 줄의 출고 수량을 찍는다(31번·남은 몫 0 시나리오). FOI 비율 1 이라 판매 수량 = 물리 수량. */
export async function markLineShipped(tx: DbTx, salesOrderLineId: string, shippedQty: number): Promise<void> {
  await tx
    .update(wmsTables.fulfillmentOrderItems)
    .set({ shippedQty })
    .where(eq(wmsTables.fulfillmentOrderItems.salesOrderLineId, salesOrderLineId));
}
