import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { seedBox, seedOrder, World } from '../../../fulfillment/order-progress/__support__/order-progress.fixtures';
import type { CustomerReturnStatus } from '../../customer-return/customer-return.types';
import { seedDispatchedParcel } from './shipment-facts.fixtures';

/**
 * 청구 사실 픽스처 (K6 PR3a) — 배송완료 소포가 있는 라인과 그 라인의 반품 예정 기록(K8 PR5·PR10).
 * 출고·배송은 `seedDispatchedParcel` 로 만든다(상자 status 만 바꾼 데이터는 수량 문이 출고로 보지 않는다, P5).
 * 반품 예정 기록은 매니저를 거치지 않고 직접 넣는다 — 수량 문이 읽는 칸만 채운다.
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

/**
 * 반품 예정 기록(K8 PR5) 하나와 그 줄들 — 매니저를 거치지 않고 직접 넣는다. 수량 문이 읽는 칸(상태·줄의 판매 라인·판매 단위
 * 수량)만 뜻 있게 채우고, 채널 식별자는 겹치지 않는 값으로 둔다. 줄은 소포를 모른다(판매 라인 단위다).
 */
export async function insertCustomerReturn(
  tx: DbTx,
  args: {
    salesOrderId: string;
    status: CustomerReturnStatus;
    lines: Array<{ salesOrderLineId: string; quantity: number; missingQty?: number }>;
  },
): Promise<{ customerReturnId: string }> {
  const [customerReturn] = await tx
    .insert(wmsTables.customerReturns)
    .values({
      salesOrderId: args.salesOrderId,
      channelReturnId: `ret-${randomUUID()}`,
      channelRequestId: `req-${randomUUID()}`,
      status: args.status,
      reason: 'defective',
      feeBearer: 'seller',
      requestedBy: 'customer',
      requestedAt: new Date(),
      cancelledAt: args.status === 'cancelled' ? new Date() : null,
    })
    .returning();
  await tx.insert(wmsTables.customerReturnLines).values(
    args.lines.map((line) => ({
      customerReturnId: customerReturn.id,
      salesOrderLineId: line.salesOrderLineId,
      channelOrderItemId: `ci-${randomUUID()}`,
      quantity: line.quantity,
      missingQty: line.missingQty ?? 0,
    })),
  );
  return { customerReturnId: customerReturn.id };
}
