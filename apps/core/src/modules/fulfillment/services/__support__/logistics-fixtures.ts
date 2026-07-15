import { randomUUID } from 'crypto';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../../inventory/schema/inventory.schema';
import { InventoryCommandService } from '../../../inventory/core/services/inventory-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';

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

export interface OutboundV2Checkpoint {
  fulfillmentOrderIds: string[];
  skuId: string;
  warehouseId: string;
  outboxAggregateIds: string[];
  expected: {
    onHandQty: number;
    reservedQty: number;
    availableQty: number;
    outboxCount: number;
    inventoryOutboxCount: number;
    dispatchAttemptCount: number;
    dispatchSourceCount: number;
    shipEventCount: number;
  };
}

/**
 * Release-scenario checkpoint. The production invariant checker owns demand,
 * active-line/reservation, session and dispatch source/event cardinality. This
 * wrapper adds the externally observable inventory/outbox totals and exact
 * dispatch attempt/source/SHIP-event topology that are deliberately outside
 * that connected-component invariant.
 */
export async function assertOutboundV2Checkpoint(tx: DbTx, checkpoint: OutboundV2Checkpoint): Promise<void> {
  try {
    await new FulfillmentInvariantService().assertFulfillmentOrders(checkpoint.fulfillmentOrderIds, tx);
  } catch (error) {
    // getResponse() only exists on HttpException. Anything else — a DB error, a
    // TypeError — must still report its message, or JSON.stringify(error)
    // silently renders "{}" and hides the real failure.
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    const detail =
      response !== undefined
        ? JSON.stringify(response)
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error);
    throw new Error(`Outbound V2 invariant checkpoint failed: ${detail}`, {
      cause: error,
    });
  }

  const [ledger] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}), 0)::int` })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        eq(wmsTables.stockLedgers.skuId, checkpoint.skuId),
        eq(wmsTables.stockLedgers.warehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    );
  const [reservations] = await tx
    .select({ qty: sql<number>`coalesce(sum(${wmsTables.stockReservations.quantity}), 0)::int` })
    .from(wmsTables.stockReservations)
    .where(
      and(
        eq(wmsTables.stockReservations.skuId, checkpoint.skuId),
        eq(wmsTables.stockReservations.warehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  const [outbox] = checkpoint.outboxAggregateIds.length
    ? await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.outboxEvents)
        .where(inArray(wmsTables.outboxEvents.aggregateId, checkpoint.outboxAggregateIds))
    : [{ count: 0 }];
  const [inventoryOutbox] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(wmsTables.outboxEvents)
    .innerJoin(wmsTables.stockEvents, eq(wmsTables.stockEvents.id, wmsTables.outboxEvents.aggregateId))
    .where(
      and(
        eq(wmsTables.outboxEvents.topic, 'inventory.events.v1'),
        eq(wmsTables.outboxEvents.eventType, 'StockShipped'),
        eq(wmsTables.outboxEvents.aggregateType, 'Stock'),
        eq(wmsTables.stockEvents.skuId, checkpoint.skuId),
        eq(wmsTables.stockEvents.transitionType, 'SHIP'),
        or(
          eq(wmsTables.stockEvents.fromWarehouseId, checkpoint.warehouseId),
          eq(wmsTables.stockEvents.toWarehouseId, checkpoint.warehouseId),
        ),
      ),
    );
  const [dispatchAttempts] = await tx
    .select({ count: sql<number>`count(distinct ${wmsTables.dispatchAttempts.id})::int` })
    .from(wmsTables.dispatchAttempts)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.dispatchAttempts.shipmentId))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, checkpoint.fulfillmentOrderIds));
  // Reach lines through the source's own shipmentLineId FK, not through the
  // attempt's shipment. A consolidated shipment carries lines from several
  // fulfillment orders, so a shipment-level join would count sources belonging
  // to orders the checkpoint never listed.
  const [dispatchSources] = await tx
    .select({ count: sql<number>`count(distinct ${wmsTables.dispatchAttemptSources.id})::int` })
    .from(wmsTables.dispatchAttemptSources)
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId))
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, checkpoint.fulfillmentOrderIds));
  const [shipEvents] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(wmsTables.stockEvents)
    .where(
      and(
        eq(wmsTables.stockEvents.skuId, checkpoint.skuId),
        eq(wmsTables.stockEvents.fromWarehouseId, checkpoint.warehouseId),
        eq(wmsTables.stockEvents.transitionType, 'SHIP'),
      ),
    );

  const onHandQty = Number(ledger?.qty ?? 0);
  const reservedQty = Number(reservations?.qty ?? 0);
  expect({
    onHandQty,
    reservedQty,
    availableQty: onHandQty - reservedQty,
    outboxCount: Number(outbox?.count ?? 0),
    inventoryOutboxCount: Number(inventoryOutbox?.count ?? 0),
    dispatchAttemptCount: Number(dispatchAttempts?.count ?? 0),
    dispatchSourceCount: Number(dispatchSources?.count ?? 0),
    shipEventCount: Number(shipEvents?.count ?? 0),
  }).toEqual(checkpoint.expected);
}
