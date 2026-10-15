import { randomUUID } from 'crypto';
import { asc, eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { seedHolder, seedSalesOrder, seedSku, seedWarehouseWithZone, Wired } from '../../services/__support__';

export interface DraftBoxFixture {
  warehouseId: string;
  locationId: string;
  holderId: string;
  salesOrderId: string;
  lineIds: string[];
  variantIds: string[];
  /** 라인마다 매칭 링크 SKU(넘긴 qtyPerUnits 순) */
  skuIdsByLine: string[][];
  /** 아직 아무 데도 안 쓴 SKU — 교체 대상 */
  spareSkuIds: string[];
  fulfillmentOrderId: string;
  shipmentId: string;
}

/** SKU 하나 + 그 창고 ON_HAND 재고(onHand 0 이면 재고 없음). */
export async function seedStockedSku(
  tx: DbTx,
  at: { warehouseId: string; locationId: string; holderId: string },
  onHand: number,
): Promise<string> {
  const { skuId } = await seedSku(tx, at.holderId);
  if (onHand > 0) {
    await tx.insert(wmsTables.stockLedgers).values({
      skuId,
      warehouseId: at.warehouseId,
      locationId: at.locationId,
      stockState: 'ON_HAND',
      qty: onHand,
    });
  }
  return skuId;
}

/** 판매주문(라인마다 매칭 SKU × qtyPerUnits) → FO → draft 박스 하나. 재고는 SKU 마다 onHand(기본 100). */
export async function seedOrderWithDraftBox(
  tx: DbTx,
  logistics: Wired,
  args: { lines: Array<{ quantity: number; qtyPerUnits: number[] }>; onHand?: number; spareSkus?: number },
): Promise<DraftBoxFixture> {
  const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
  const { holderId } = await seedHolder(tx);
  const at = { warehouseId, locationId, holderId };
  const onHand = args.onHand ?? 100;
  const variantIds = args.lines.map(() => randomUUID());
  const { salesOrderId, lineIds } = await seedSalesOrder(tx, {
    lines: args.lines.map((line, i) => ({ variantId: variantIds[i], quantity: line.quantity })),
  });
  await tx
    .update(wmsTables.salesOrders)
    .set({
      shippingAddress: {
        recipientName: 'IT',
        phone: '010-0000-0000',
        postalCode: '01234',
        roadAddress: 'Seoul',
        detailAddress: '101',
      },
    })
    .where(eq(wmsTables.salesOrders.id, salesOrderId));

  const skuIdsByLine: string[][] = [];
  for (const [i, line] of args.lines.entries()) {
    const skuIds: string[] = [];
    for (let k = 0; k < line.qtyPerUnits.length; k += 1) skuIds.push(await seedStockedSku(tx, at, onHand));
    const [matching] = await tx
      .insert(wmsTables.productMatchings)
      .values({
        variantId: variantIds[i],
        status: 'matched',
        strategy: 'variant',
        isResolved: true,
        preStockSellable: true,
      })
      .returning();
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values(skuIds.map((skuId, k) => ({ productMatchingId: matching.id, skuId, quantity: line.qtyPerUnits[k] })));
    skuIdsByLine.push(skuIds);
  }
  const spareSkuIds: string[] = [];
  for (let k = 0; k < (args.spareSkus ?? 0); k += 1) spareSkuIds.push(await seedStockedSku(tx, at, onHand));

  await logistics.fulfillments.create({ salesOrderId, warehouseId }, tx);
  const [fo] = await tx
    .select({ id: wmsTables.fulfillmentOrders.id })
    .from(wmsTables.fulfillmentOrders)
    .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
  const [line] = await tx
    .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fo.id))
    .limit(1);
  return {
    ...at,
    salesOrderId,
    lineIds,
    variantIds,
    skuIdsByLine,
    spareSkuIds,
    fulfillmentOrderId: fo.id,
    shipmentId: line.shipmentId,
  };
}

export async function boxLinesOf(tx: DbTx, shipmentId: string) {
  return tx
    .select({
      id: wmsTables.shipmentLines.id,
      skuId: wmsTables.shipmentLines.skuId,
      qty: wmsTables.shipmentLines.qty,
      reservedQty: wmsTables.shipmentLines.reservedQty,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(wmsTables.shipmentLines.id));
}

export async function itemsOf(tx: DbTx, fulfillmentOrderId: string) {
  return tx
    .select({
      skuId: wmsTables.fulfillmentOrderItems.skuId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      qty: wmsTables.fulfillmentOrderItems.qty,
      canceledQty: wmsTables.fulfillmentOrderItems.canceledQty,
    })
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId));
}
