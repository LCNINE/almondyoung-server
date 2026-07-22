import { eq } from 'drizzle-orm';
import type { Wired } from '../../../apps/core/src/modules/fulfillment/services/__support__/logistics-wiring';
import { DbTx, wmsTables } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';
import { SEED_IDS, SEED_SKUS } from './constants';

const ORDER_COUNT = 10;

/** variant id 도 결정론 — 매칭 재현과 URL 안정성을 위해. 이 파일이 쓰는 UUID 접두(019d0007)의
 * 전체 할당 목록은 constants.ts 상단 레지스트리 참고.
 * 마지막 세그먼트는 SEED_SKUS 와 동일한 이유로 8자리 zero-padding(00000000+seq)을 써서
 * 12자리(8-4-4-4-12 UUID 포맷)를 맞춘다 — 브리프 원안의 7자리 padding(0000000+seq)은
 * 11자리라 postgres uuid 파싱을 통과하지 못한다. */
function variantIdFor(index: number): string {
  const seq = String(index + 1).padStart(4, '0');
  return `019d0007-${seq}-7000-a000-00000000${seq}`;
}

/**
 * SO/라인/매칭은 결정론이 필요해 직접 insert 하고,
 * FO·예약·draft shipment 는 FulfillmentsService.create 가 만든다.
 * 재고가 있는 SKU(index 2 이상)만 쓴다 — 예약이 서야 하기 때문.
 */
export async function seedOrders(wired: Wired, tx: DbTx): Promise<string[]> {
  const shipmentIds: string[] = [];

  for (let index = 0; index < ORDER_COUNT; index += 1) {
    const sku = SEED_SKUS[index + 2];
    const variantId = variantIdFor(index);
    const quantity = (index % 3) + 1;
    const seq = String(index + 1).padStart(4, '0');

    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `DEV-ORDER-${seq}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: {
          recipientName: `개발 수취인 ${seq}`,
          phone: '010-0000-0000',
          postalCode: '14547',
          roadAddress: '경기도 부천시 길주로 1',
          detailAddress: `${seq}호`,
        },
        orderDate: new Date('2026-07-20T00:00:00.000Z'),
      })
      .returning();

    await tx.insert(wmsTables.salesOrderLines).values({
      salesOrderId: salesOrder.id,
      variantId,
      productName: sku.name,
      quantity,
      unitPrice: 10_000,
      channelOrderItemId: `DEV-ITEM-${seq}`,
      channelProductId: `DEV-PRODUCT-${seq}`,
    });

    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({ variantId, status: 'matched', strategy: 'variant', isResolved: true, preStockSellable: true })
      .returning();
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values({ productMatchingId: matching.id, skuId: sku.id, quantity: 1 });

    await wired.fulfillments.create({ salesOrderId: salesOrder.id, warehouseId: SEED_IDS.warehouseBucheon }, tx);

    // 방금 만든 SO 의 shipment 를 그래프로 되짚는다. shipments 테이블에는 salesOrderId 가 없고
    // shipment_lines → fulfillment_order_items → fulfillment_orders 로만 이어진다.
    // "마지막 행" 같은 순서 의존은 쓰지 않는다 — ORDER BY 없는 select 의 행 순서는 보장되지 않는다.
    const [shipment] = await tx
      .selectDistinct({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrder.id));

    if (!shipment) {
      throw new Error(`[seed-dev-core] ${salesOrder.channelOrderId} 의 shipment 를 찾지 못했습니다`);
    }
    shipmentIds.push(shipment.id);
  }

  return shipmentIds;
}
