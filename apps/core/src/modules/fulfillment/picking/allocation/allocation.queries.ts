import { BadRequestException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { STRATEGY_BY_PICKING_METHOD } from '../picking-method.contract';
import { PickingStrategyName } from '../picking-strategy.interface';
import { conflict, shipmentWithdrawn } from './allocation.errors';
import { ShipmentAllocation, ShipmentCustodyBalance, WorkItemRow, uniqueSorted } from './allocation.types';

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

/**
 * 배치 행은 잠그지 않는다: `startedAt` 은 한 번만 쓰이고 `pickingMethod` 는 불변이다.
 * 여기서 배치를 잠그면 작업 항목 → 배치 순서가 되어, 배치 → 작업 항목 순서로 잠그는
 * 배치 시작·박스 추가와 교착한다.
 */
export async function assertActiveBatchSession(
  trx: DbTx,
  sessionId: string,
  batchId: string,
  strategyName: PickingStrategyName,
): Promise<void> {
  await assertBatchSessionLifecycle(trx, sessionId, batchId, strategyName, ['active']);
}

export async function assertBatchSessionLifecycle(
  trx: DbTx,
  sessionId: string,
  batchId: string,
  strategyName: PickingStrategyName,
  allowedSessionStatuses: readonly ('active' | 'settled')[],
): Promise<void> {
  const [batch] = await trx
    .select({
      pickingMethod: wmsTables.outboundBatches.pickingMethod,
      startedAt: wmsTables.outboundBatches.startedAt,
    })
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1);
  if (!batch || !batch.startedAt || STRATEGY_BY_PICKING_METHOD[batch.pickingMethod] !== strategyName) {
    throw conflict('PICKING_BATCH_NOT_STARTED', `Batch ${batchId} is not a started ${strategyName} batch`);
  }
  const [session] = await trx
    .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
    .from(wmsTables.batchInventorySessions)
    .where(eq(wmsTables.batchInventorySessions.id, sessionId))
    .limit(1)
    .for('update');
  if (
    !session ||
    session.batchId !== batchId ||
    !(allowedSessionStatuses as readonly string[]).includes(session.status)
  ) {
    throw conflict('PICKING_SESSION_NOT_ACTIVE', `Inventory session ${sessionId} is not active for the batch`);
  }
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
  // 전략 7곳이 모두 여기를 지난다 — 빠지는 박스는 리스가 살아 있어도 더 집지 않는다(정한 것 11).
  if (item.status === 'withdrawing' || item.status === 'excluded') throw shipmentWithdrawn(shipmentId);
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

export async function loadWorkItemAllocations(trx: DbTx, workItemId: string): Promise<ShipmentAllocation[]> {
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
    .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId))
    .orderBy(
      asc(wmsTables.pickingSourceAllocations.shipmentLineId),
      asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      asc(wmsTables.pickingSourceAllocations.id),
    );
  if (!allocations.length) {
    throw conflict('PICKING_WORK_ITEM_NOT_ALLOCATED', `Work item ${workItemId} has no picking allocation`);
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
