import { and, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockAggregate } from '../picking/allocation/allocation.locks';
import { conflict } from '../picking/allocation/allocation.errors';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';

/** Lock the recursive component first; a work-item or batch lock first inverts batch start's order. */
export async function lockPreparation(batchId: string, invariant: FulfillmentInvariantService, tx: DbTx) {
  const shipmentIds = await preparationShipmentIds(batchId, tx);
  const aggregate = await lockAggregate(tx, invariant, batchId, shipmentIds);
  // addShipment can commit while the optimistic scope is being discovered. Never
  // acquire its new FOI/component later, while already holding the batch/work locks.
  const lockedShipmentIds = await preparationShipmentIds(batchId, tx);
  if (shipmentIds.join(',') !== lockedShipmentIds.join(',')) {
    throw conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Batch membership changed while acquiring preparation locks');
  }
  return aggregate;
}

async function preparationShipmentIds(batchId: string, tx: DbTx): Promise<string[]> {
  const items = await tx
    .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
    .from(wmsTables.outboundBatchWorkItems)
    .where(
      and(
        eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
        inArray(wmsTables.outboundBatchWorkItems.status, [
          'queued',
          'picking',
          'ready_to_pack',
          'packing',
          'short_pick_recovery',
        ]),
      ),
    );
  return [...new Set(items.map((row) => row.shipmentId))].sort();
}

/** 잠금 없는 읽기. 시작은 한 번만 일어나므로(`startedAt` 단조) 읽은 값이 뒤집히지 않는다. */
export async function isBatchStarted(batchId: string, tx: DbTx): Promise<boolean> {
  const [batch] = await tx
    .select({ startedAt: wmsTables.outboundBatches.startedAt })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  return Boolean(batch?.startedAt);
}

/**
 * Called under the active work-item lock, before downstream work -> session guards.
 * Do not introduce a session lock here; the session is locked by the command that mutates it.
 */
export async function activePreparationSession(batchId: string, tx: DbTx): Promise<string | null> {
  const sessions = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    );
  if (sessions.length !== 1 || sessions[0].status !== 'active') return null;
  return sessions[0].id;
}
