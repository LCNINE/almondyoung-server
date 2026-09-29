import { eq, inArray } from 'drizzle-orm';
import { outbox_events } from '@app/events';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { seedPickableShipment } from './logistics-fixtures';

/** Deletes only this suite's committed fixture graph, including nested command and outbox rows. */
export async function cleanupPreparationFixture(tx: DbTx, f: Awaited<ReturnType<typeof seedPickableShipment>>) {
  const [item] = await tx
    .select()
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.skuId, f.skuId));
  const [sku] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuId));
  if (!item?.salesOrderId || !item.salesOrderLineId || !sku?.deliveryProfileId)
    throw new Error('Incomplete fixture cleanup identity');
  const sessions = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
  const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
  const attempts = await tx
    .select()
    .from(wmsTables.dispatchAttempts)
    .where(eq(wmsTables.dispatchAttempts.shipmentId, f.shipmentId));
  const resourceIds = [
    ...attempts.map((a) => a.id),
    f.shipmentId,
    f.batchId,
    f.workItemId,
    ...sessions.map((s) => s.id),
  ];
  await tx
    .delete(wmsTables.fulfillmentCommandRequests)
    .where(inArray(wmsTables.fulfillmentCommandRequests.resourceId, resourceIds));
  await tx
    .delete(outbox_events)
    .where(
      inArray(outbox_events.aggregateId, [
        ...resourceIds,
        f.skuId,
        item.fulfillmentOrderId,
        ...events.map((e) => e.id),
      ]),
    );
  await tx.delete(wmsTables.auditLogs).where(eq(wmsTables.auditLogs.userId, f.actorId));
  if (attempts.length) {
    await tx.delete(wmsTables.dispatchAttemptSources).where(
      inArray(
        wmsTables.dispatchAttemptSources.dispatchAttemptId,
        attempts.map((a) => a.id),
      ),
    );
    await tx.delete(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.shipmentId, f.shipmentId));
  }
  if (sessions.length) {
    await tx.delete(wmsTables.batchInventorySessionEvents).where(
      inArray(
        wmsTables.batchInventorySessionEvents.sessionId,
        sessions.map((s) => s.id),
      ),
    );
    await tx.delete(wmsTables.batchInventorySessionBalances).where(
      inArray(
        wmsTables.batchInventorySessionBalances.sessionId,
        sessions.map((s) => s.id),
      ),
    );
    await tx.delete(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
  }
  const workItemIds = (
    await tx
      .select({ id: wmsTables.outboundBatchWorkItems.id })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, f.batchId))
  ).map((row) => row.id);
  if (workItemIds.length) {
    // 배정은 작업 항목을 restrict FK 로 물고 있으므로 작업 항목보다 먼저 지운다.
    await tx
      .delete(wmsTables.pickingSourceAllocations)
      .where(inArray(wmsTables.pickingSourceAllocations.workItemId, workItemIds));
  }
  await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.batchId, f.batchId));
  await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, f.batchId));
  await tx.delete(wmsTables.stockReservations).where(eq(wmsTables.stockReservations.shipmentLineId, f.shipmentLineId));
  await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, f.shipmentId));
  await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, f.shipmentLineId));
  await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, f.shipmentId));
  await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
  await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, item.fulfillmentOrderId));
  await tx.delete(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, item.salesOrderLineId));
  await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, item.salesOrderId));
  await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
  const journals = events.flatMap((e) => (e.journalId ? [e.journalId] : []));
  if (journals.length) await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journals));
  await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
  await tx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, f.skuId));
  await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuId));
  await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, f.holderId));
  await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, f.warehouseId));
  await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, f.warehouseId));
  await tx.delete(wmsTables.deliveryProfiles).where(eq(wmsTables.deliveryProfiles.id, sku.deliveryProfileId));
}
