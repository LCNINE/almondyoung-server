import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { lockAggregate } from '../picking/plan/picking-plan.locks';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';

/** Lock the recursive component first; a work-item or batch lock first inverts planning's order. */
export async function lockPreparation(batchId: string, invariant: FulfillmentInvariantService, tx: DbTx) {
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
  const stored = await tx
    .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
    .from(wmsTables.pickingPlanMembers)
    .innerJoin(wmsTables.pickingPlans, eq(wmsTables.pickingPlans.id, wmsTables.pickingPlanMembers.planId))
    .where(
      and(
        eq(wmsTables.pickingPlans.batchId, batchId),
        inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
        isNull(wmsTables.pickingPlanMembers.retiredAt),
      ),
    );
  return lockAggregate(tx, invariant, batchId, [...new Set([...items, ...stored].map((row) => row.shipmentId))].sort());
}

/** A zero balance is not evidence of no execution: retain header/event and work-item history checks. */
export async function preparationExecutionFacts(batchId: string, actorId: string, tx: DbTx) {
  const sessions = await tx
    .select()
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.batchId, batchId))
    .orderBy(asc(wmsTables.batchInventorySessions.id))
    .for('update');
  const ids = sessions.map((row) => row.id);
  const balances = ids.length
    ? await tx
        .select({ id: wmsTables.batchInventorySessionBalances.id })
        .from(wmsTables.batchInventorySessionBalances)
        .where(inArray(wmsTables.batchInventorySessionBalances.sessionId, ids))
        .limit(1)
    : [];
  const events = ids.length
    ? await tx
        .select({ id: wmsTables.batchInventorySessionEvents.id })
        .from(wmsTables.batchInventorySessionEvents)
        .where(inArray(wmsTables.batchInventorySessionEvents.sessionId, ids))
        .limit(1)
    : [];
  const items = await tx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId));
  const lines = await tx
    .select({
      inspectedQty: wmsTables.shipmentLines.inspectedQty,
      pickedQty: wmsTables.fulfillmentOrderItems.pickedQty,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(
      inArray(
        wmsTables.shipmentLines.shipmentId,
        items.map((item) => item.shipmentId),
      ),
    );
  return {
    hasSession: sessions.length > 0,
    hasCustody: balances.length > 0,
    hasPickHistory:
      events.length > 0 ||
      lines.some((line) => line.pickedQty > 0) ||
      items.some((item) => item.status !== 'queued' || item.pickerClaimedAt !== null || item.handedOffAt !== null),
    hasInspection: lines.some((line) => line.inspectedQty > 0) || items.some((item) => item.packerClaimedAt !== null),
    hasOtherActiveClaim: items.some(
      (item) =>
        item.pickerId !== null &&
        item.pickerId !== actorId &&
        item.pickerReleasedAt === null &&
        item.leaseExpiresAt !== null &&
        item.leaseExpiresAt.getTime() > Date.now(),
    ),
  };
}
