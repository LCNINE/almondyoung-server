import { randomUUID } from 'crypto';
import { DbTx, returnRequests, wmsTables } from '../../../inventory/schema/inventory.schema';

/** 정체 보드 판정 스펙 전용 — 판정이 읽는 칸만 채운다(실제 흐름 서비스는 부르지 않는다). */
export type World = { warehouseId: string; skuId: string };

export async function seedWorld(tx: DbTx): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `op-wh-${suffix}`, supportedPickingStrategies: ['discrete'], isSellable: true })
    .returning();
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `op-holder-${suffix}` })
    .returning();
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'op-sku', code: `OP-${randomUUID().toUpperCase()}`, holderId: holder.id })
    .returning();
  return { warehouseId: wh.id, skuId: sku.id };
}

export async function seedOrder(
  tx: DbTx,
  args: { status?: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'; createdAt?: Date } = {},
): Promise<{ salesOrderId: string; lineId: string }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `OP-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: args.status ?? 'confirmed',
      shippingAddress: { name: 'OP', address1: 'x' },
      orderDate: args.createdAt ?? new Date(),
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({ salesOrderId: so.id, variantId: randomUUID(), productName: 'OP', quantity: 1, unitPrice: 1000 })
    .returning();
  return { salesOrderId: so.id, lineId: line.id };
}

export async function seedBacklog(
  tx: DbTx,
  salesOrderId: string,
  status: 'pending' | 'processing' | 'awaiting_matching' | 'completed' | 'not_required' | 'failed',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({ salesOrderId, status, createdAt });
}

export async function seedFo(
  tx: DbTx,
  w: World,
  order: { salesOrderId: string; lineId: string },
  args: {
    status?: 'created' | 'partially_reserved' | 'ready' | 'processing' | 'completed';
    dropShip?: 'pending' | 'forwarded' | 'completed' | 'canceled';
    createdAt?: Date;
  } = {},
): Promise<{ foId: string; foItemId: string }> {
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({
      salesOrderId: order.salesOrderId,
      warehouseId: w.warehouseId,
      status: args.status ?? 'ready',
      fulfillmentMode: args.dropShip ? 'drop_ship' : 'in_house',
      directShipStatus: args.dropShip ?? null,
      totalQty: 1,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fo.id,
      salesOrderId: order.salesOrderId,
      salesOrderLineId: order.lineId,
      skuId: w.skuId,
      qty: 1,
    })
    .returning();
  return { foId: fo.id, foItemId: item.id };
}

export async function seedBox(
  tx: DbTx,
  w: World,
  foItemIds: string[],
  args: {
    status: 'draft' | 'planned' | 'shipped' | 'in_transit' | 'delivered' | 'failed' | 'canceled' | 'recovery_required';
    recoveryCode?: string;
    openedAt?: Date;
    plannedAt?: Date;
    shippedAt?: Date;
  },
): Promise<{ shipmentId: string; lineIds: string[] }> {
  const [s] = await tx
    .insert(wmsTables.shipments)
    .values({
      warehouseId: w.warehouseId,
      status: args.status,
      recoveryCode: args.recoveryCode ?? null,
      openedAt: args.openedAt ?? new Date(),
      plannedAt: args.plannedAt ?? null,
      shippedAt: args.shippedAt ?? null,
    })
    .returning();
  const lineIds: string[] = [];
  for (const fulfillmentOrderItemId of foItemIds) {
    const [l] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: s.id, fulfillmentOrderItemId, skuId: w.skuId, qty: 1 })
      .returning();
    lineIds.push(l.id);
  }
  return { shipmentId: s.id, lineIds };
}

export async function seedWorkItem(
  tx: DbTx,
  w: World,
  shipmentId: string,
  args: {
    status: 'queued' | 'picking' | 'packing' | 'completed' | 'excluded';
    completedAt?: Date;
    pickerClaimedAt?: Date;
  },
): Promise<void> {
  const [batch] = await tx
    .insert(wmsTables.outboundBatches)
    .values({ batchNumber: `OP-B-${randomUUID()}`, warehouseId: w.warehouseId, pickingMethod: 'individual' })
    .returning();
  await tx.insert(wmsTables.outboundBatchWorkItems).values({
    batchId: batch.id,
    shipmentId,
    status: args.status,
    completedAt: args.completedAt ?? null,
    pickerClaimedAt: args.pickerClaimedAt ?? null,
  });
}

export async function seedWaybill(
  tx: DbTx,
  shipmentId: string,
  status: 'pending' | 'allocated' | 'registered' | 'used' | 'voided',
): Promise<void> {
  await tx.insert(wmsTables.waybills).values({
    shipmentId,
    source: 'manual',
    carrier: 'HANJIN',
    status,
    trackingNo: status === 'registered' || status === 'used' ? `T${Date.now()}` : null,
    manifestVersion: 1,
    recipientHash: 'x'.repeat(64),
  });
}

export async function seedConfirmedReservation(
  tx: DbTx,
  w: World,
  args: { foId: string; foItemId: string; shipmentLineId: string },
): Promise<void> {
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: args.foId,
    fulfillmentOrderItemId: args.foItemId,
    shipmentLineId: args.shipmentLineId,
    skuId: w.skuId,
    warehouseId: w.warehouseId,
    quantity: 1,
    status: 'confirmed',
  });
}

export async function seedCancellation(tx: DbTx, salesOrderId: string, occurredAt: Date): Promise<void> {
  await tx.insert(wmsTables.salesOrderCancellations).values({ salesOrderId, occurredAt, reasonCode: 'customer' });
}

export async function seedReturn(
  tx: DbTx,
  salesOrderId: string,
  status: 'requested' | 'collection_pending' | 'completed' | 'rejected',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(returnRequests).values({ salesOrderId, status, reasonCode: 'defective', createdAt });
}
