import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import {
  DbTx,
  returnExchangeTables,
  returnRequestStatusEnum,
  wmsTables,
} from '../../../inventory/schema/inventory.schema';
import { seedBox, seedOrder, World } from '../../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { seedDispatchedParcel } from './shipment-facts.fixtures';

/**
 * 청구 사실 픽스처 (K6 PR3a) — 배송완료 소포가 있는 라인과 그 소포를 적은 반품·교환 요청.
 * 출고·배송은 `seedDispatchedParcel` 로 만든다(상자 status 만 바꾼 데이터는 수량 문이 출고로 보지 않는다, P5).
 * 청구 행은 서비스를 거치지 않고 직접 넣는다 — 수량 문이 읽는 칸(상태·항목 수량·소포 칸)만 채운다.
 */

export type DeliveredLine = {
  salesOrderId: string;
  lineId: string;
  foItemIdBySku: Map<string, string>;
  parcels: Array<{ shipmentId: string; dispatchAttemptId: string; shipmentLineIdBySku: Map<string, string> }>;
};

/** 같은 보유자의 SKU 하나 더 — 세트 구성품용. */
export async function seedComponentSku(tx: DbTx, w: World): Promise<string> {
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'cf-sku', code: `CF-${randomUUID().toUpperCase()}`, holderId: w.holderId })
    .returning();
  return sku.id;
}

/**
 * 라인 하나 + 굳은 구성 + FOI(구성품마다, 수량 = 라인 수량 × 1개당 수량) + 소포들.
 * parcels[i].qtyBySku 는 그 소포에 담긴 SKU 별 수량. 소포마다 seedBox → seedDispatchedParcel(delivered 기본 true).
 * 구성은 `sales_order_line_compositions` 에 직접 넣는다(실제 FO 생성이 굳히는 모양).
 */
export async function seedDeliveredLine(
  tx: DbTx,
  w: World,
  args: {
    quantity: number;
    composition: Array<{ skuId: string; qtyPerUnit: number }>;
    parcels: Array<{ qtyBySku: Record<string, number>; delivered?: boolean }>;
    customerId?: string;
  },
): Promise<DeliveredLine> {
  const order = await seedOrder(tx, { quantity: args.quantity });
  if (args.customerId) {
    await tx
      .update(wmsTables.salesOrders)
      .set({ customerId: args.customerId })
      .where(eq(wmsTables.salesOrders.id, order.salesOrderId));
  }
  await tx.insert(wmsTables.salesOrderLineCompositions).values(
    args.composition.map((component) => ({
      salesOrderLineId: order.lineId,
      skuId: component.skuId,
      qtyPerUnit: component.qtyPerUnit,
    })),
  );
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'matching', compositionSetAt: new Date() })
    .where(eq(wmsTables.salesOrderLines.id, order.lineId));

  const totalQty = args.composition.reduce((sum, component) => sum + component.qtyPerUnit * args.quantity, 0);
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({
      salesOrderId: order.salesOrderId,
      warehouseId: w.warehouseId,
      status: 'ready',
      fulfillmentMode: 'in_house',
      totalItems: args.composition.length,
      totalQty,
    })
    .returning();
  const foItemIdBySku = new Map<string, string>();
  for (const component of args.composition) {
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fo.id,
        salesOrderId: order.salesOrderId,
        salesOrderLineId: order.lineId,
        skuId: component.skuId,
        qty: component.qtyPerUnit * args.quantity,
      })
      .returning();
    foItemIdBySku.set(component.skuId, item.id);
  }

  const parcels: DeliveredLine['parcels'] = [];
  for (const parcel of args.parcels) {
    const contents = Object.entries(parcel.qtyBySku).map(([skuId, qty]) => {
      const foItemId = foItemIdBySku.get(skuId);
      if (!foItemId) throw new Error(`seedDeliveredLine: 구성에 없는 SKU 를 소포에 담았다: ${skuId}`);
      return { skuId, foItemId, qty };
    });
    const box = await seedBox(
      tx,
      w,
      contents.map((content) => content.foItemId),
      { status: 'planned', qty: contents.map((content) => content.qty) },
    );
    const shipmentLineIdBySku = new Map<string, string>();
    for (const [i, content] of contents.entries()) {
      const shipmentLineId = box.lineIds[i];
      shipmentLineIdBySku.set(content.skuId, shipmentLineId);
      // seedBox 는 라인 SKU 를 w.skuId 로 둔다 — 실제 상자 라인은 FOI 의 SKU 를 싣는다
      await tx
        .update(wmsTables.shipmentLines)
        .set({ skuId: content.skuId })
        .where(eq(wmsTables.shipmentLines.id, shipmentLineId));
    }
    const { dispatchAttemptId } = await seedDispatchedParcel(tx, w, {
      shipmentId: box.shipmentId,
      lines: contents.map((content, i) => ({
        shipmentLineId: box.lineIds[i],
        foItemId: content.foItemId,
        qty: content.qty,
      })),
      delivered: parcel.delivered ?? true,
    });
    parcels.push({ shipmentId: box.shipmentId, dispatchAttemptId, shipmentLineIdBySku });
  }

  return { salesOrderId: order.salesOrderId, lineId: order.lineId, foItemIdBySku, parcels };
}

/** 반품·교환 요청 하나와 그 항목들. 두 상태 enum 은 같은 값이다. */
export async function seedClaim(
  tx: DbTx,
  args: {
    kind: 'return' | 'exchange';
    salesOrderId: string;
    status: (typeof returnRequestStatusEnum.enumValues)[number];
    items: Array<{
      salesOrderLineId: string;
      shipmentLineId: string | null;
      dispatchAttemptId: string | null;
      quantity: number;
    }>;
  },
): Promise<{ requestId: string }> {
  const t = returnExchangeTables;
  if (args.kind === 'return') {
    const [request] = await tx
      .insert(t.returnRequests)
      .values({ salesOrderId: args.salesOrderId, status: args.status, reasonCode: 'defective' })
      .returning();
    await tx.insert(t.returnRequestItems).values(args.items.map((item) => ({ returnRequestId: request.id, ...item })));
    return { requestId: request.id };
  }
  const [request] = await tx
    .insert(t.exchangeRequests)
    .values({ salesOrderId: args.salesOrderId, status: args.status, reasonCode: 'defective' })
    .returning();
  await tx
    .insert(t.exchangeRequestItems)
    .values(args.items.map((item) => ({ exchangeRequestId: request.id, ...item })));
  return { requestId: request.id };
}
