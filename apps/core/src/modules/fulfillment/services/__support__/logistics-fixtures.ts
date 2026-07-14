import { randomUUID } from 'crypto';
import { wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';

export async function seedWarehouseWithZone(tx: DbTx): Promise<{ warehouseId: string; locationId: string }> {
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
    .returning();
  const [loc] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: wh.id, code: `IT-Z-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  return { warehouseId: wh.id, locationId: loc.id };
}

export async function seedHolder(tx: DbTx): Promise<{ holderId: string }> {
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
    .returning();
  return { holderId: holder.id };
}

// sku.code 는 대문자 — inspectScan 바코드 매칭이 대문자 code 로 대조.
export async function seedSku(tx: DbTx, holderId: string): Promise<{ skuId: string; skuCode: string }> {
  const skuCode = `IT-${randomUUID().toUpperCase()}`;
  const [sku] = await tx.insert(wmsTables.skus).values({ name: 'it-sku', code: skuCode, holderId }).returning();
  return { skuId: sku.id, skuCode };
}

// RECEIVE 이벤트 + ON_HAND ledger 를 남긴다. toLocationId 필수.
export async function receiveStock(
  command: InventoryCommandService,
  tx: DbTx,
  args: { skuId: string; warehouseId: string; locationId: string; quantity: number },
): Promise<void> {
  await command.receive(
    {
      skuId: args.skuId,
      toWarehouseId: args.warehouseId,
      toLocationId: args.locationId,
      quantity: args.quantity,
      reason: 'IT-SEED',
      idempotencyKey: `recv-${randomUUID()}`,
    },
    tx,
  );
}

// SO + 라인. 라인 mappingSnapshotId 는 default null → 라이브 매칭 경로 강제. variantId 는 임의 UUID.
export async function seedSalesOrder(
  tx: DbTx,
  args: { lines: Array<{ variantId: string; quantity: number; productName?: string }> },
): Promise<{ salesOrderId: string; lineIds: string[] }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `IT-CH-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: 'confirmed',
      shippingAddress: { name: 'IT', address1: 'x' },
      orderDate: new Date(),
    })
    .returning();

  const lineIds: string[] = [];
  for (const l of args.lines) {
    const [line] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: so.id,
        variantId: l.variantId,
        productName: l.productName ?? 'IT Product',
        quantity: l.quantity,
        unitPrice: 1000,
      })
      .returning();
    lineIds.push(line.id);
  }
  return { salesOrderId: so.id, lineIds };
}

// 사전 매칭(matched/variant) + link. 재매칭-깨우기 경로를 태우지 않는 케이스용(1a/2a/골든 SO-1).
export async function seedMatching(
  tx: DbTx,
  args: { variantId: string; skuId: string; quantity?: number; strategy?: 'variant' | 'void' },
): Promise<{ matchingId: string }> {
  const strategy = args.strategy ?? 'variant';
  const [matching] = await tx
    .insert(wmsTables.productMatchings)
    .values({ variantId: args.variantId, status: 'matched', strategy, isResolved: true, preStockSellable: true })
    .returning();
  if (strategy === 'variant') {
    await tx
      .insert(wmsTables.productVariantSkuLinks)
      .values({ productMatchingId: matching.id, skuId: args.skuId, quantity: args.quantity ?? 1 });
  }
  return { matchingId: matching.id };
}

// issueInvoice(tx 거부) 우회 — issued 인보이스 직접 seed. openBoxByScan 의 입구.
export async function seedInvoiceIssued(
  tx: DbTx,
  args: { fulfillmentOrderId: string },
): Promise<{ trackingNo: string }> {
  const trackingNo = `IT-TRK-${randomUUID().slice(0, 8)}`;
  await tx.insert(wmsTables.invoices).values({
    trackingNo,
    carrier: 'CJ',
    issueMethod: 'self',
    issuedForFulfillmentOrderId: args.fulfillmentOrderId,
    status: 'issued',
  });
  return { trackingNo };
}
