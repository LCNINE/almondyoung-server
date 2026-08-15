import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { PickingStrategyName, PickingPlanResult } from '../picking-strategy.interface';
import { conflict } from './picking-plan.errors';
import { ShipmentAllocation, ShipmentCustodyBalance, WorkItemRow, uniqueSorted } from './picking-plan.types';

/**
 * Layer 1 — no collaborators. Every function here takes an open `trx` plus plain values, so a fake
 * `trx` is the whole test fixture. Canonical body is `discrete` unless noted (ADR-0030 §4).
 */

export async function loadWorkItem(trx: DbTx, workItemId: string, lock = false): Promise<WorkItemRow> {
  const query = trx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
    .limit(1);
  const rows = lock ? await query.for('update') : await query;
  const item = rows[0];
  if (!item) throw new NotFoundException(`Outbound batch work item ${workItemId} not found`);
  return item;
}

export function assertWorkItemIdentity(item: WorkItemRow, batchId: string, shipmentId: string): void {
  if (item.batchId !== batchId || item.shipmentId !== shipmentId) {
    throw conflict('PICKING_WORK_ITEM_MISMATCH', 'Work item does not belong to the requested batch/shipment');
  }
}

export async function assertPlanMembers(trx: DbTx, planId: string, shipmentIds: string[]): Promise<void> {
  const ids = uniqueSorted(shipmentIds);
  if (!ids.length || ids.length !== shipmentIds.length) {
    throw new BadRequestException('Plan member shipments must be unique and non-empty');
  }
  const rows = await trx
    .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
    .from(wmsTables.pickingPlanMembers)
    .where(
      and(
        eq(wmsTables.pickingPlanMembers.planId, planId),
        inArray(wmsTables.pickingPlanMembers.shipmentId, ids),
        isNull(wmsTables.pickingPlanMembers.retiredAt),
      ),
    )
    .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
    .for('update');
  if (rows.length !== ids.length || rows.some((row, index) => row.shipmentId !== ids[index])) {
    throw conflict('PICKING_SHIPMENT_NOT_IN_PLAN', 'Every requested shipment must belong to the active plan');
  }
}

/** Active custody trusts its immutable allocation; source ledger versions are a pre-HAND_IN gate only. */
export async function assertActivePlanSession(
  trx: DbTx,
  planId: string,
  sessionId: string,
  batchId: string,
  strategyName: PickingStrategyName,
): Promise<void> {
  const [plan] = await trx
    .select({
      batchId: wmsTables.pickingPlans.batchId,
      strategy: wmsTables.pickingPlans.strategy,
      status: wmsTables.pickingPlans.status,
    })
    .from(wmsTables.pickingPlans)
    .where(eq(wmsTables.pickingPlans.id, planId))
    .limit(1)
    .for('update');
  if (!plan || plan.batchId !== batchId || plan.strategy !== strategyName || plan.status !== 'active') {
    throw conflict('PICKING_PLAN_NOT_ACTIVE', `Picking plan ${planId} is not an active ${strategyName} plan`);
  }
  const [session] = await trx
    .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.id, sessionId))
    .limit(1)
    .for('update');
  if (!session || session.batchId !== batchId || session.status !== 'active') {
    throw conflict('PICKING_SESSION_NOT_ACTIVE', `Inventory session ${sessionId} is not active for the batch`);
  }
  const [identity] = await trx
    .select({ id: wmsTables.batchInventorySessionEvents.id })
    .from(wmsTables.batchInventorySessionEvents)
    .where(
      and(
        eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
        eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        sql`${wmsTables.batchInventorySessionEvents.payload}->>'planId' = ${planId}`,
      ),
    )
    .limit(1);
  if (!identity) throw conflict('PICKING_SESSION_PLAN_MISMATCH', 'Inventory session belongs to another plan');
}

export async function lockAndAssertPickerClaim(
  trx: DbTx,
  workItemId: string,
  batchId: string,
  shipmentId: string,
  actorId: string,
  expectedLeaseVersion: number,
): Promise<WorkItemRow> {
  if (!Number.isSafeInteger(expectedLeaseVersion) || expectedLeaseVersion < 0) {
    throw new BadRequestException('expectedLeaseVersion must be a non-negative integer');
  }
  const item = await loadWorkItem(trx, workItemId, true);
  assertWorkItemIdentity(item, batchId, shipmentId);
  const now = await databaseNow(trx);
  if (
    item.status !== 'picking' ||
    item.pickerId !== actorId ||
    item.pickerReleasedAt ||
    item.leaseVersion !== expectedLeaseVersion ||
    !item.leaseExpiresAt ||
    item.leaseExpiresAt.getTime() <= now.getTime()
  ) {
    throw conflict('PICKING_STALE_CLAIM', `Worker ${actorId} does not own the active picker lease`);
  }
  return item;
}

/**
 * Canonical: `aggregate_then_sort`. It is a strict superset — it also selects `id` (its custody
 * layer keys idempotency on `allocation.id`) and adds `id` as a final ORDER BY tiebreaker.
 * Planning never emits two rows for the same (line, source), so the tiebreaker never fires.
 */
export async function loadShipmentAllocations(
  trx: DbTx,
  planId: string,
  shipmentId: string,
): Promise<ShipmentAllocation[]> {
  const allocations = await trx
    .select({
      id: wmsTables.pickingSourceAllocations.id,
      shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
      skuId: wmsTables.shipmentLines.skuId,
      sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
      qty: wmsTables.pickingSourceAllocations.qty,
    })
    .from(wmsTables.pickingSourceAllocations)
    .innerJoin(
      wmsTables.shipmentLines,
      eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
    )
    .where(
      and(eq(wmsTables.pickingSourceAllocations.planId, planId), eq(wmsTables.shipmentLines.shipmentId, shipmentId)),
    )
    .orderBy(
      asc(wmsTables.pickingSourceAllocations.shipmentLineId),
      asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      asc(wmsTables.pickingSourceAllocations.id),
    );
  if (!allocations.length) {
    throw conflict('PICKING_SHIPMENT_NOT_IN_PLAN', `Shipment ${shipmentId} has no plan allocation`);
  }
  return allocations;
}

export async function loadPositiveShipmentCustody(
  trx: DbTx,
  sessionId: string,
  shipmentId: string,
): Promise<ShipmentCustodyBalance[]> {
  return trx
    .select({
      id: wmsTables.batchInventorySessionBalances.id,
      skuId: wmsTables.batchInventorySessionBalances.skuId,
      sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
      custodyType: wmsTables.batchInventorySessionBalances.custodyType,
      custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
      shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
      qty: wmsTables.batchInventorySessionBalances.qty,
    })
    .from(wmsTables.batchInventorySessionBalances)
    .innerJoin(
      wmsTables.shipmentLines,
      eq(wmsTables.shipmentLines.id, wmsTables.batchInventorySessionBalances.shipmentLineId),
    )
    .where(
      and(
        eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
        eq(wmsTables.shipmentLines.shipmentId, shipmentId),
        gt(wmsTables.batchInventorySessionBalances.qty, 0),
      ),
    )
    .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
}

/** Canonical: `discrete` (byte-identical to `pick_to_tote`; `aggregate` differed only in wording). */
export async function invalidateDraftPlan(
  trx: DbTx,
  planId: string,
  batchId: string,
  reason: string,
  operationId: string,
): Promise<PickingPlanResult> {
  const [invalidated] = await trx
    .update(wmsTables.pickingPlans)
    .set({
      status: 'invalidated',
      invalidatedAt: sql`now()`,
      invalidationReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(wmsTables.pickingPlans.id, planId),
        eq(wmsTables.pickingPlans.batchId, batchId),
        eq(wmsTables.pickingPlans.status, 'draft'),
      ),
    )
    .returning({ id: wmsTables.pickingPlans.id });
  if (!invalidated) {
    throw conflict('PICKING_PLAN_STALE_VERSION', `Draft plan ${planId} changed while invalidating`);
  }
  return { state: 'invalidated', operationId, planId, batchId, reason };
}

export function assertRecipientComplete(value: unknown): void {
  const recipient = (value ?? {}) as Record<string, unknown>;
  const missing = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'].filter(
    (key) => typeof recipient[key] !== 'string' || !recipient[key].trim(),
  );
  if (missing.length) {
    throw conflict('SHIPMENT_RECIPIENT_INCOMPLETE', `Missing recipient fields: ${missing.join(',')}`);
  }
}

export function assertProfileComplete(profile: typeof wmsTables.deliveryProfiles.$inferSelect): void {
  const snapshots = [profile.senderSnapshot, profile.originAddressSnapshot, profile.returnAddressSnapshot];
  const sender = (profile.senderSnapshot ?? {}) as Record<string, unknown>;
  const senderName = sender.name ?? sender.senderName;
  const senderPhone = sender.phone ?? sender.senderPhone;
  if (
    snapshots.some(
      (snapshot) =>
        !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0,
    ) ||
    typeof senderName !== 'string' ||
    !senderName.trim() ||
    typeof senderPhone !== 'string' ||
    !senderPhone.trim() ||
    !profile.carrierAccountRef?.trim()
  ) {
    throw conflict(
      'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
      'Shipping profile execution snapshots and carrier account are required',
    );
  }
}

export function requiredIds(name: string, values: readonly string[]): string[] {
  const ids = uniqueSorted(values.map((value) => value.trim()).filter(Boolean));
  if (!ids.length) throw new BadRequestException(`${name} must not be empty`);
  if (ids.length !== values.length) throw new BadRequestException(`${name} must contain unique non-empty IDs`);
  return ids;
}

export function assertPositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new BadRequestException('quantity must be a positive integer');
  }
}

export async function databaseNow(trx: DbTx): Promise<Date> {
  const rows = await trx.execute<{ now: Date }>(sql`SELECT CURRENT_TIMESTAMP AS now`);
  const value = (rows as unknown as Array<{ now: Date }>)[0]?.now;
  if (!value) throw new Error('Database clock unavailable');
  return value instanceof Date ? value : new Date(value);
}
