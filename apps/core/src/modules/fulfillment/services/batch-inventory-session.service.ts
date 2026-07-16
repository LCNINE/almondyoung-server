import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';

type SessionRow = typeof wmsTables.batchInventorySessions.$inferSelect;
export type BatchInventoryCustodyType = (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];

export interface BatchInventoryBucket {
  skuId: string;
  sourceLocationId: string;
  custodyType: BatchInventoryCustodyType;
  custodyRef?: string | null;
  shipmentLineId?: string | null;
}

export interface MoveBatchCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  actorId: string;
  quantity: number;
  from: BatchInventoryBucket;
  to: BatchInventoryBucket;
  context?: Record<string, unknown>;
}

export interface ReturnBatchCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  actorId: string;
  quantity: number;
  from: BatchInventoryBucket;
}

export interface SettleBatchCustodyInput extends ReturnBatchCustodyInput {
  dispatchAttemptSourceId: string;
}

export const APPROVED_SHORTAGE_REASON_CODES = ['MISSING', 'DAMAGED', 'DEFECTIVE'] as const;
export type ApprovedShortageReasonCode = (typeof APPROVED_SHORTAGE_REASON_CODES)[number];

export function isApprovedShortageReasonCode(value: unknown): value is ApprovedShortageReasonCode {
  return typeof value === 'string' && APPROVED_SHORTAGE_REASON_CODES.includes(value as ApprovedShortageReasonCode);
}

export interface ApproveBatchShortageInput {
  sessionId: string;
  idempotencyKey: string;
  shortPickOperationId: string;
  shipmentLineId: string;
  quantity: number;
  from: BatchInventoryBucket;
  reasonCode: ApprovedShortageReasonCode;
  reason: string;
  approverId: string;
}

export interface ReturnShortPickCustodyInput {
  sessionId: string;
  idempotencyKey: string;
  shortPickOperationId: string;
  shipmentLineId: string;
  quantity: number;
  from: BatchInventoryBucket;
  reason: string;
  actorId: string;
}

export type ShortPickOperationIntentProof = {
  kind: 'short_pick';
  operationId: string;
  shipmentId: string;
  sessionId: string;
  actorId: string;
  reason: string;
  lines: Array<{
    shipmentLineId: string;
    sourceLocationId: string;
    shortQty: number;
    allocationQty: number;
  }>;
};

export interface BatchInventorySessionFaultInjector {
  afterEventAppended?(eventType: string, sessionId: string, tx: DbTx): Promise<void> | void;
}

export const BATCH_INVENTORY_SESSION_FAULT_INJECTOR = Symbol('BATCH_INVENTORY_SESSION_FAULT_INJECTOR');

interface SessionEventSide {
  custodyType: BatchInventoryCustodyType;
  custodyRef: string | null;
  sourceLocationId: string;
  shipmentLineId: string | null;
}

function normalizedBucket(bucket: BatchInventoryBucket): SessionEventSide {
  return {
    custodyType: bucket.custodyType,
    custodyRef: bucket.custodyRef?.trim() || null,
    sourceLocationId: bucket.sourceLocationId,
    shipmentLineId: bucket.shipmentLineId ?? null,
  };
}

function bucketKey(bucket: SessionEventSide): string {
  return [bucket.custodyType, bucket.sourceLocationId, bucket.custodyRef ?? '', bucket.shipmentLineId ?? ''].join('|');
}

function stableJson(value: unknown, ancestors: Set<object>, arrayElement = false): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'bigint') throw new TypeError('BigInt is not JSON serializable');
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    return arrayElement ? 'null' : undefined;
  }
  if (value instanceof Date) return JSON.stringify(value.toJSON());
  if (ancestors.has(value)) throw new TypeError('Circular structure is not JSON serializable');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (entry) => stableJson(entry, ancestors, true) ?? 'null').join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const serialized = stableJson(record[key], ancestors);
        return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
      });
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function shortPickOperationIntentOf(snapshot: unknown): ShortPickOperationIntentProof | null {
  const intent = recordOf(recordOf(snapshot).intent);
  if (
    intent.kind !== 'short_pick' ||
    typeof intent.operationId !== 'string' ||
    typeof intent.shipmentId !== 'string' ||
    typeof intent.sessionId !== 'string' ||
    typeof intent.actorId !== 'string' ||
    typeof intent.reason !== 'string' ||
    !Array.isArray(intent.lines) ||
    intent.lines.length === 0
  ) {
    return null;
  }
  const lines: ShortPickOperationIntentProof['lines'] = [];
  const pairs = new Set<string>();
  for (const value of intent.lines) {
    const line = recordOf(value);
    if (
      typeof line.shipmentLineId !== 'string' ||
      typeof line.sourceLocationId !== 'string' ||
      !Number.isSafeInteger(line.shortQty) ||
      Number(line.shortQty) < 0 ||
      !Number.isSafeInteger(line.allocationQty) ||
      Number(line.allocationQty) < Number(line.shortQty)
    ) {
      return null;
    }
    const pair = `${line.shipmentLineId}:${line.sourceLocationId}`;
    if (pairs.has(pair)) return null;
    pairs.add(pair);
    lines.push({
      shipmentLineId: line.shipmentLineId,
      sourceLocationId: line.sourceLocationId,
      shortQty: Number(line.shortQty),
      allocationQty: Number(line.allocationQty),
    });
  }
  return {
    kind: 'short_pick',
    operationId: intent.operationId,
    shipmentId: intent.shipmentId,
    sessionId: intent.sessionId,
    actorId: intent.actorId,
    reason: intent.reason,
    lines,
  };
}

export function canonicalBatchSessionRequestHash(value: unknown): string {
  const canonical = stableJson(value, new Set());
  if (canonical === undefined) throw new TypeError('Request must be JSON serializable');
  return createHash('sha256').update(canonical).digest('hex');
}

export function remainingShortPickAllocation(input: {
  allocatedQty: number;
  activeAttributedQty: number;
  returnedQty: number;
  settledQty: number;
  shortageQty: number;
}): number {
  return input.allocatedQty - input.activeAttributedQty - input.returnedQty - input.settledQty - input.shortageQty;
}

@Injectable()
export class BatchInventorySessionService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly controlledStock: BatchControlledStockGuard,
    private readonly audit: AuditService,
    @Optional()
    @Inject(BATCH_INVENTORY_SESSION_FAULT_INJECTOR)
    private readonly faultInjector?: BatchInventorySessionFaultInjector,
  ) {}

  async startSession(batchId: string, planId: string, tx?: DbTx, actualActorId?: string): Promise<SessionRow> {
    return this.dbService.run(async (trx) => {
      let [plan] = await trx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, planId))
        .limit(1);
      if (!plan) throw new NotFoundException(`Picking plan ${planId} not found`);
      if (plan.batchId !== batchId)
        throw this.conflict('SESSION_PLAN_BATCH_MISMATCH', 'Picking plan belongs to another batch');

      const [historicalStart] = await trx
        .select({ sessionId: wmsTables.batchInventorySessionEvents.sessionId })
        .from(wmsTables.batchInventorySessionEvents)
        .innerJoin(
          wmsTables.batchInventorySessions,
          eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionEvents.sessionId),
        )
        .where(
          and(
            eq(wmsTables.batchInventorySessions.batchId, batchId),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
            sql`${wmsTables.batchInventorySessionEvents.payload}->>'planId' = ${planId}`,
          ),
        )
        .limit(1);
      if (historicalStart) {
        [plan] = await trx
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.id, planId))
          .limit(1)
          .for('update');
        if (!plan) throw this.conflict('SESSION_PLAN_MISSING', `Session plan ${planId} no longer exists`);
        const [historicalSession] = await trx
          .select()
          .from(wmsTables.batchInventorySessions)
          .where(eq(wmsTables.batchInventorySessions.id, historicalStart.sessionId))
          .limit(1)
          .for('update');
        if (!historicalSession) throw this.conflict('SESSION_HISTORY_BROKEN', 'Start event has no session header');
        await this.assertExistingSessionPlan(historicalSession.id, planId, trx);
        return historicalSession;
      }

      const [existing] = await trx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(
          and(
            eq(wmsTables.batchInventorySessions.batchId, batchId),
            inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
          ),
        )
        .limit(1);
      if (existing) {
        throw this.conflict('SESSION_ALREADY_STARTED_FOR_OTHER_PLAN', 'Batch already has another active session');
      }
      if (plan.status !== 'draft') {
        throw this.conflict('PICKING_PLAN_NOT_STARTABLE', `Picking plan ${planId} is ${plan.status}`);
      }

      let [batch] = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          warehouseId: wmsTables.outboundBatches.warehouseId,
          status: wmsTables.outboundBatches.status,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1);
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      if (!['created', 'picking'].includes(batch.status)) {
        throw this.conflict('OUTBOUND_BATCH_NOT_STARTABLE', `Outbound batch ${batchId} is ${batch.status}`);
      }
      const members = await trx
        .select()
        .from(wmsTables.pickingPlanMembers)
        .where(eq(wmsTables.pickingPlanMembers.planId, planId))
        .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId));
      if (members.length === 0) throw this.conflict('PICKING_PLAN_EMPTY', `Picking plan ${planId} has no members`);

      const lineIdentities = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
        })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.shipmentId, members.map((member) => member.shipmentId).sort()));
      if (lineIdentities.length === 0) throw this.conflict('PICKING_PLAN_EMPTY', `Picking plan ${planId} has no lines`);

      await trx
        .select({ id: wmsTables.fulfillmentOrderItems.id })
        .from(wmsTables.fulfillmentOrderItems)
        .where(
          inArray(
            wmsTables.fulfillmentOrderItems.id,
            [...new Set(lineIdentities.map((line) => line.fulfillmentOrderItemId))].sort(),
          ),
        )
        .orderBy(asc(wmsTables.fulfillmentOrderItems.id))
        .for('update');
      await trx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, members.map((member) => member.shipmentId).sort()))
        .orderBy(asc(wmsTables.shipments.id))
        .for('update');
      await trx
        .select({ id: wmsTables.shipmentLines.id })
        .from(wmsTables.shipmentLines)
        .where(inArray(wmsTables.shipmentLines.id, lineIdentities.map((line) => line.id).sort()))
        .orderBy(asc(wmsTables.shipmentLines.id))
        .for('update');
      await trx
        .select({ id: wmsTables.stockReservations.id })
        .from(wmsTables.stockReservations)
        .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIdentities.map((line) => line.id).sort()))
        .orderBy(asc(wmsTables.stockReservations.createdAt), asc(wmsTables.stockReservations.id))
        .for('update');
      [batch] = await trx
        .select({
          id: wmsTables.outboundBatches.id,
          warehouseId: wmsTables.outboundBatches.warehouseId,
          status: wmsTables.outboundBatches.status,
        })
        .from(wmsTables.outboundBatches)
        .where(eq(wmsTables.outboundBatches.id, batchId))
        .limit(1)
        .for('update');
      if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
      await trx
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId))
        .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
        .for('update');
      [plan] = await trx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, planId))
        .limit(1)
        .for('update');
      if (!plan || plan.batchId !== batchId) {
        throw this.conflict('PICKING_PLAN_STALE', `Picking plan ${planId} changed while starting`);
      }
      if (plan.status !== 'draft') {
        const [samePlanStart] = await trx
          .select({ sessionId: wmsTables.batchInventorySessionEvents.sessionId })
          .from(wmsTables.batchInventorySessionEvents)
          .innerJoin(
            wmsTables.batchInventorySessions,
            eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionEvents.sessionId),
          )
          .where(
            and(
              eq(wmsTables.batchInventorySessions.batchId, batchId),
              eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
              sql`${wmsTables.batchInventorySessionEvents.payload}->>'planId' = ${planId}`,
            ),
          )
          .limit(1);
        if (samePlanStart) {
          const replay = await this.lockSession(samePlanStart.sessionId, trx);
          await this.assertExistingSessionPlan(replay.id, planId, trx);
          return replay;
        }
        throw this.conflict('PICKING_PLAN_STALE', `Picking plan ${planId} changed while starting`);
      }
      const lockedMembers = await trx
        .select()
        .from(wmsTables.pickingPlanMembers)
        .where(eq(wmsTables.pickingPlanMembers.planId, planId))
        .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
        .for('update');
      if (JSON.stringify(lockedMembers) !== JSON.stringify(members)) {
        throw this.conflict('PICKING_PLAN_STALE', `Picking plan ${planId} membership changed while starting`);
      }
      const [racedSession] = await trx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(
          and(
            eq(wmsTables.batchInventorySessions.batchId, batchId),
            inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
          ),
        )
        .limit(1)
        .for('update');
      if (racedSession) {
        await this.assertExistingSessionPlan(racedSession.id, planId, trx);
        return racedSession;
      }
      const allocations = await trx
        .select({
          id: wmsTables.pickingSourceAllocations.id,
          shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
          sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
          quantity: wmsTables.pickingSourceAllocations.qty,
          sourceStockVersion: wmsTables.pickingSourceAllocations.sourceStockVersion,
          skuId: wmsTables.shipmentLines.skuId,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          lineQty: wmsTables.shipmentLines.qty,
          shipmentWarehouseId: wmsTables.shipments.warehouseId,
          manifestVersion: wmsTables.shipments.manifestVersion,
          reservationVersion: wmsTables.shipments.reservationVersion,
          shipmentStatus: wmsTables.shipments.status,
          sourceWarehouseId: wmsTables.locations.warehouseId,
        })
        .from(wmsTables.pickingSourceAllocations)
        .innerJoin(
          wmsTables.shipmentLines,
          eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
        )
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
        .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
        .where(eq(wmsTables.pickingSourceAllocations.planId, planId))
        .orderBy(
          asc(wmsTables.pickingSourceAllocations.sourceLocationId),
          asc(wmsTables.pickingSourceAllocations.shipmentLineId),
          asc(wmsTables.pickingSourceAllocations.id),
        )
        .for('update');
      if (members.length === 0 || allocations.length === 0) {
        throw this.conflict('PICKING_PLAN_EMPTY', `Picking plan ${planId} has no members or allocations`);
      }

      const memberLines = await trx
        .select({
          id: wmsTables.shipmentLines.id,
          skuId: wmsTables.shipmentLines.skuId,
          qty: wmsTables.shipmentLines.qty,
          shipmentId: wmsTables.shipmentLines.shipmentId,
          warehouseId: wmsTables.shipments.warehouseId,
          status: wmsTables.shipments.status,
          manifestVersion: wmsTables.shipments.manifestVersion,
          reservationVersion: wmsTables.shipments.reservationVersion,
        })
        .from(wmsTables.shipmentLines)
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
        .where(inArray(wmsTables.shipmentLines.shipmentId, members.map((member) => member.shipmentId).sort()))
        .orderBy(asc(wmsTables.shipmentLines.id))
        .for('update');
      if (memberLines.length === 0) throw this.conflict('PICKING_PLAN_EMPTY', `Picking plan ${planId} has no lines`);

      const memberByShipment = new Map(members.map((member) => [member.shipmentId, member]));
      const allocationByLine = new Map<string, number>();
      const sourceGroups = new Map<
        string,
        { skuId: string; sourceLocationId: string; sourceStockVersion: number; quantity: number }
      >();
      for (const allocation of allocations) {
        const member = memberByShipment.get(allocation.shipmentId);
        if (!member)
          throw this.conflict('PICKING_PLAN_FOREIGN_LINE', `Allocation ${allocation.id} is not a plan member`);
        if (
          member.manifestVersion !== allocation.manifestVersion ||
          member.reservationVersion !== allocation.reservationVersion
        ) {
          throw this.conflict('PICKING_PLAN_STALE', `Shipment ${allocation.shipmentId} changed after planning`);
        }
        if (allocation.shipmentStatus !== 'planned') {
          throw this.conflict('PICKING_PLAN_SHIPMENT_NOT_PLANNED', `Shipment ${allocation.shipmentId} is not planned`);
        }
        if (
          allocation.shipmentWarehouseId !== batch.warehouseId ||
          allocation.sourceWarehouseId !== batch.warehouseId
        ) {
          throw this.conflict('PICKING_PLAN_WAREHOUSE_MISMATCH', `Allocation ${allocation.id} crosses warehouse scope`);
        }
        allocationByLine.set(
          allocation.shipmentLineId,
          (allocationByLine.get(allocation.shipmentLineId) ?? 0) + allocation.quantity,
        );
        const sourceKey = `${allocation.skuId}|${allocation.sourceLocationId}`;
        const source = sourceGroups.get(sourceKey);
        if (source && source.sourceStockVersion !== allocation.sourceStockVersion) {
          throw this.conflict(
            'PICKING_PLAN_STOCK_VERSION_MISMATCH',
            `Allocation source versions disagree for ${sourceKey}`,
          );
        }
        sourceGroups.set(sourceKey, {
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          sourceStockVersion: allocation.sourceStockVersion,
          quantity: (source?.quantity ?? 0) + allocation.quantity,
        });
      }

      const activeItems = await trx
        .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
        .from(wmsTables.outboundBatchWorkItems)
        .where(
          and(
            eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
            inArray(wmsTables.outboundBatchWorkItems.status, ['queued', 'picking']),
          ),
        )
        .for('update');
      const activeShipmentIds = new Set(activeItems.map((item) => item.shipmentId));
      const memberShipmentIds = new Set(members.map((member) => member.shipmentId));
      if (
        members.some((member) => !activeShipmentIds.has(member.shipmentId)) ||
        activeItems.some((item) => !memberShipmentIds.has(item.shipmentId))
      ) {
        throw this.conflict(
          'PICKING_PLAN_WORK_ITEM_MISMATCH',
          'Plan membership must exactly match queued/picking batch work items',
        );
      }

      for (const line of memberLines) {
        const member = memberByShipment.get(line.shipmentId)!;
        if (
          line.warehouseId !== batch.warehouseId ||
          line.status !== 'planned' ||
          line.manifestVersion !== member.manifestVersion ||
          line.reservationVersion !== member.reservationVersion
        ) {
          throw this.conflict('PICKING_PLAN_STALE', `Member shipment ${line.shipmentId} changed after planning`);
        }
        const allocatedQty = allocationByLine.get(line.id) ?? 0;
        const reservationRows = await trx
          .select({
            qty: wmsTables.stockReservations.quantity,
            skuId: wmsTables.stockReservations.skuId,
            warehouseId: wmsTables.stockReservations.warehouseId,
          })
          .from(wmsTables.stockReservations)
          .where(
            and(
              eq(wmsTables.stockReservations.shipmentLineId, line.id),
              eq(wmsTables.stockReservations.status, 'confirmed'),
              isNull(wmsTables.stockReservations.invalidatedAt),
            ),
          )
          .for('update');
        const reservedQty = reservationRows.reduce((total, row) => total + row.qty, 0);
        if (
          allocatedQty !== line.qty ||
          reservedQty !== line.qty ||
          reservationRows.some((row) => row.skuId !== line.skuId || row.warehouseId !== batch.warehouseId)
        ) {
          throw this.conflict(
            'PICKING_PLAN_RESERVATION_MISMATCH',
            `Line ${line.id} is not fully reserved and allocated`,
          );
        }
      }

      for (const source of [...sourceGroups.values()].sort((left, right) => {
        return `${left.skuId}|${left.sourceLocationId}`.localeCompare(`${right.skuId}|${right.sourceLocationId}`);
      })) {
        await acquireStockAvailabilityLock(trx, source.skuId, batch.warehouseId);
        const availability = await this.controlledStock.getAvailability(
          { skuId: source.skuId, warehouseId: batch.warehouseId, sourceLocationId: source.sourceLocationId },
          trx,
          { lock: true },
        );
        if (
          availability.stockVersion !== source.sourceStockVersion ||
          availability.generallyAvailableQty < source.quantity
        ) {
          throw this.conflict(
            'PICKING_PLAN_SOURCE_STALE',
            `Source ${source.skuId}/${source.sourceLocationId} no longer satisfies the plan`,
          );
        }
      }

      const [session] = await trx.insert(wmsTables.batchInventorySessions).values({ batchId }).returning();
      let sequence = session.version;
      for (const allocation of allocations) {
        await trx.insert(wmsTables.batchInventorySessionEvents).values({
          sessionId: session.id,
          idempotencyKey: `start:${planId}:${allocation.id}`,
          eventType: 'HAND_IN',
          skuId: allocation.skuId,
          quantity: allocation.quantity,
          toCustodyType: 'AT_SOURCE',
          toSourceLocationId: allocation.sourceLocationId,
          payload: {
            sequence,
            planId,
            allocationId: allocation.id,
            shipmentLineId: allocation.shipmentLineId,
            sourceStockVersion: allocation.sourceStockVersion,
            requestHash: canonicalBatchSessionRequestHash({
              eventType: 'HAND_IN',
              planId,
              allocationId: allocation.id,
              skuId: allocation.skuId,
              sourceLocationId: allocation.sourceLocationId,
              shipmentLineId: allocation.shipmentLineId,
              quantity: allocation.quantity,
              sourceStockVersion: allocation.sourceStockVersion,
            }),
          },
        });
        await trx
          .insert(wmsTables.batchInventorySessionBalances)
          .values({
            sessionId: session.id,
            skuId: allocation.skuId,
            sourceLocationId: allocation.sourceLocationId,
            custodyType: 'AT_SOURCE',
            qty: allocation.quantity,
          })
          .onConflictDoUpdate({
            target: [
              wmsTables.batchInventorySessionBalances.sessionId,
              wmsTables.batchInventorySessionBalances.skuId,
              wmsTables.batchInventorySessionBalances.sourceLocationId,
              wmsTables.batchInventorySessionBalances.custodyType,
              wmsTables.batchInventorySessionBalances.custodyRef,
              wmsTables.batchInventorySessionBalances.shipmentLineId,
            ],
            set: {
              qty: sql`${wmsTables.batchInventorySessionBalances.qty} + ${allocation.quantity}`,
              version: sql`${wmsTables.batchInventorySessionBalances.version} + 1`,
              updatedAt: sql`now()`,
            },
          });
        sequence += 1;
      }
      const handedInQty = allocations.reduce((total, allocation) => total + allocation.quantity, 0);
      const [started] = await trx
        .update(wmsTables.batchInventorySessions)
        .set({ handedInQty, version: sequence, updatedAt: sql`now()` })
        .where(
          and(
            eq(wmsTables.batchInventorySessions.id, session.id),
            eq(wmsTables.batchInventorySessions.version, session.version),
          ),
        )
        .returning();
      if (!started) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed while starting`);
      await trx
        .update(wmsTables.pickingPlans)
        .set({ status: 'active', updatedAt: sql`now()` })
        .where(and(eq(wmsTables.pickingPlans.id, planId), eq(wmsTables.pickingPlans.status, 'draft')));
      await this.assertConservation(started, trx);
      await this.audit.logUserActionRequired(
        'batch_inventory_session.start',
        'fulfillment',
        `Started inventory session ${session.id}`,
        { userId: actualActorId?.trim() || plan.createdBy },
        { batchId, planId, handedInQty, allocationIds: allocations.map((allocation) => allocation.id) },
        trx,
      );
      return started;
    }, tx);
  }

  async moveCustody(input: MoveBatchCustodyInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    const to = normalizedBucket(input.to);
    if (input.from.skuId !== input.to.skuId || from.sourceLocationId !== to.sourceLocationId) {
      throw new BadRequestException('Custody movement must preserve SKU and source location');
    }
    if (bucketKey(from) === bucketKey(to)) throw new BadRequestException('Source and target custody must differ');
    if (to.custodyType === 'SETTLED') {
      throw new BadRequestException('Use settleForDispatch for SETTLED custody');
    }
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'MOVE_CUSTODY',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to,
        context: input.context,
      },
      tx,
    );
  }

  async returnToSource(input: ReturnBatchCustodyInput, tx?: DbTx) {
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'RETURN_TO_SOURCE',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from: normalizedBucket(input.from),
        to: null,
      },
      tx,
    );
  }

  async settleForDispatch(input: SettleBatchCustodyInput, tx: DbTx) {
    if (!tx) throw new Error('settleForDispatch requires the caller dispatch transaction');
    const from = normalizedBucket(input.from);
    if (!from.shipmentLineId) throw new BadRequestException('Dispatch settlement requires shipment-line custody');
    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'SETTLE_FOR_DISPATCH',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: { ...from, custodyType: 'SETTLED', custodyRef: null },
        context: { dispatchAttemptSourceId: input.dispatchAttemptSourceId },
      },
      tx,
    );
  }

  async approveShortage(input: ApproveBatchShortageInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    if (!input.shortPickOperationId.trim()) throw new BadRequestException('shortPickOperationId is required');
    if (!input.shipmentLineId.trim()) throw new BadRequestException('shipmentLineId is required');
    if (!isApprovedShortageReasonCode(input.reasonCode)) {
      throw new BadRequestException('reasonCode must be one of MISSING, DAMAGED, DEFECTIVE');
    }
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    if (!input.approverId.trim()) throw new BadRequestException('approverId is required');
    if (from.shipmentLineId && from.shipmentLineId !== input.shipmentLineId) {
      throw new BadRequestException('Shortage attribution must match the source custody shipment line');
    }

    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'APPROVE_SHORTAGE',
        actorId: input.approverId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: null,
        context: {
          shortPickOperationId: input.shortPickOperationId,
          shipmentLineId: input.shipmentLineId,
          sourceLocationId: from.sourceLocationId,
          reasonCode: input.reasonCode,
          reason: input.reason.trim(),
          approverId: input.approverId,
        },
      },
      tx,
    );
  }

  async returnShortPickCustody(input: ReturnShortPickCustodyInput, tx?: DbTx) {
    const from = normalizedBucket(input.from);
    if (!input.shortPickOperationId.trim()) throw new BadRequestException('shortPickOperationId is required');
    if (!input.shipmentLineId.trim()) throw new BadRequestException('shipmentLineId is required');
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    if (!input.actorId.trim()) throw new BadRequestException('actorId is required');
    if (from.shipmentLineId && from.shipmentLineId !== input.shipmentLineId) {
      throw new BadRequestException('Short-pick return attribution must match the source custody shipment line');
    }

    return this.mutate(
      {
        sessionId: input.sessionId,
        idempotencyKey: input.idempotencyKey,
        eventType: 'RETURN_TO_SOURCE',
        actorId: input.actorId,
        skuId: input.from.skuId,
        quantity: input.quantity,
        from,
        to: null,
        context: {
          shortPickOperationId: input.shortPickOperationId,
          shipmentLineId: input.shipmentLineId,
          sourceLocationId: from.sourceLocationId,
          reason: input.reason.trim(),
        },
      },
      tx,
    );
  }

  private async mutate(
    input: {
      sessionId: string;
      idempotencyKey: string;
      eventType: 'MOVE_CUSTODY' | 'RETURN_TO_SOURCE' | 'SETTLE_FOR_DISPATCH' | 'APPROVE_SHORTAGE';
      actorId: string;
      skuId: string;
      quantity: number;
      from: SessionEventSide;
      to: SessionEventSide | null;
      context?: Record<string, unknown>;
    },
    tx?: DbTx,
  ) {
    if (!input.idempotencyKey.trim()) throw new BadRequestException('idempotencyKey is required');
    if (!input.actorId.trim()) throw new BadRequestException('actorId is required');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    this.assertBucket(input.from);
    if (input.from.custodyType === 'SETTLED') throw new BadRequestException('SETTLED custody is terminal');
    if (input.to) this.assertBucket(input.to);
    const fingerprint = canonicalBatchSessionRequestHash(input);

    return this.dbService.run(async (trx) => {
      const shortPickOperation =
        typeof input.context?.shortPickOperationId === 'string'
          ? await this.lockShortPickOperation(input.context.shortPickOperationId, trx)
          : null;
      // Short-pick commands already own their durable operation, then all session
      // lifecycle paths continue in plan -> session order. HAND_IN identity is
      // read optimistically and revalidated after those locks.
      const planId = await this.sessionPlanId(input.sessionId, trx);
      const [plan] = await trx
        .select({ id: wmsTables.pickingPlans.id })
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, planId))
        .limit(1)
        .for('update');
      if (!plan) throw this.conflict('SESSION_PLAN_MISSING', `Session plan ${planId} no longer exists`);
      const session = await this.lockSession(input.sessionId, trx);
      await this.assertExistingSessionPlan(input.sessionId, planId, trx);
      const [replay] = await trx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
            eq(wmsTables.batchInventorySessionEvents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) {
        const payload = this.eventPayload(replay.payload);
        if (payload.requestHash !== fingerprint) {
          throw this.conflict(
            'SESSION_IDEMPOTENCY_MISMATCH',
            'Idempotency key was used for a different custody mutation',
          );
        }
        return { session, event: replay, replayed: true };
      }
      if (shortPickOperation && shortPickOperation.status !== 'pending') {
        throw this.conflict(
          shortPickOperation.status === 'completed'
            ? 'SESSION_SHORTAGE_OPERATION_COMPLETED'
            : 'SESSION_SHORTAGE_OPERATION_RECOVERY_ONLY',
          `A ${shortPickOperation.status} short-pick operation permits only exact existing event replay`,
        );
      }
      if (session.status !== 'active') {
        throw this.conflict('SESSION_NOT_MUTABLE', `Batch inventory session ${input.sessionId} is ${session.status}`);
      }

      if (input.eventType === 'SETTLE_FOR_DISPATCH') {
        const dispatchAttemptSourceId = input.context?.dispatchAttemptSourceId;
        if (typeof dispatchAttemptSourceId !== 'string') {
          throw new BadRequestException('dispatchAttemptSourceId is required');
        }
        await this.assertDispatchSettlementProof(
          {
            sessionId: input.sessionId,
            dispatchAttemptSourceId,
            quantity: input.quantity,
            skuId: input.skuId,
            from: input.from,
          },
          trx,
        );
      }
      if (input.eventType === 'APPROVE_SHORTAGE') {
        await this.assertShortageAllocation(input, planId, shortPickOperation?.intent ?? null, trx);
      }
      if (input.eventType === 'RETURN_TO_SOURCE' && typeof input.context?.shortPickOperationId === 'string') {
        await this.assertShortageAllocation(input, planId, shortPickOperation?.intent ?? null, trx);
      }

      await this.assertLineAssignment(input.sessionId, input.skuId, input.from, trx);
      if (input.to) await this.assertLineAssignment(input.sessionId, input.skuId, input.to, trx);
      const balances = await trx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId))
        .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
        .for('update');
      const source = balances.find((balance) => this.sameBucket(balance, input.skuId, input.from));
      if (!source || source.qty < input.quantity) {
        throw this.conflict('SESSION_CUSTODY_SHORT', 'Source custody does not contain the requested quantity');
      }

      const [event] = await trx
        .insert(wmsTables.batchInventorySessionEvents)
        .values({
          sessionId: input.sessionId,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          skuId: input.skuId,
          quantity: input.quantity,
          fromCustodyType: input.from.custodyType,
          fromCustodyRef: input.from.custodyRef,
          fromSourceLocationId: input.from.sourceLocationId,
          fromShipmentLineId: input.from.shipmentLineId,
          toCustodyType: input.to?.custodyType,
          toCustodyRef: input.to?.custodyRef,
          toSourceLocationId: input.to?.sourceLocationId,
          toShipmentLineId: input.to?.shipmentLineId,
          payload: { ...input.context, sequence: session.version, requestHash: fingerprint, actorId: input.actorId },
        })
        .returning();
      await this.faultInjector?.afterEventAppended?.(input.eventType, input.sessionId, trx);

      const [decremented] = await trx
        .update(wmsTables.batchInventorySessionBalances)
        .set({
          qty: source.qty - input.quantity,
          version: source.version + 1,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.id, source.id),
            eq(wmsTables.batchInventorySessionBalances.version, source.version),
          ),
        )
        .returning();
      if (!decremented) throw this.conflict('SESSION_BALANCE_STALE', `Source balance ${source.id} changed`);

      if (input.to) {
        const target = balances.find((balance) => this.sameBucket(balance, input.skuId, input.to!));
        if (target) {
          const [incremented] = await trx
            .update(wmsTables.batchInventorySessionBalances)
            .set({ qty: target.qty + input.quantity, version: target.version + 1, updatedAt: sql`now()` })
            .where(
              and(
                eq(wmsTables.batchInventorySessionBalances.id, target.id),
                eq(wmsTables.batchInventorySessionBalances.version, target.version),
              ),
            )
            .returning();
          if (!incremented) throw this.conflict('SESSION_BALANCE_STALE', `Target balance ${target.id} changed`);
        } else {
          await trx.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: input.sessionId,
            skuId: input.skuId,
            sourceLocationId: input.to.sourceLocationId,
            custodyType: input.to.custodyType,
            custodyRef: input.to.custodyRef,
            shipmentLineId: input.to.shipmentLineId,
            qty: input.quantity,
          });
        }
      }

      if (input.to?.shipmentLineId) {
        await this.assertAttributedQuantity(input.sessionId, input.to, trx);
      }
      const [remainingAfterMutation] = await trx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
            ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
          ),
        );
      const isTerminal = Number(remainingAfterMutation?.qty ?? 0) === 0;
      const [updated] = await trx
        .update(wmsTables.batchInventorySessions)
        .set({
          version: session.version + 1,
          status: isTerminal ? 'settled' : 'active',
          completedAt: isTerminal ? sql`now()` : null,
          returnedQty:
            input.eventType === 'RETURN_TO_SOURCE' ? session.returnedQty + input.quantity : session.returnedQty,
          settledQty:
            input.eventType === 'SETTLE_FOR_DISPATCH' ? session.settledQty + input.quantity : session.settledQty,
          shortageQty:
            input.eventType === 'APPROVE_SHORTAGE' ? session.shortageQty + input.quantity : session.shortageQty,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(wmsTables.batchInventorySessions.id, session.id),
            eq(wmsTables.batchInventorySessions.version, session.version),
          ),
        )
        .returning();
      if (!updated) throw this.conflict('SESSION_STALE_VERSION', `Session ${session.id} changed`);
      if (isTerminal) {
        const planId = await this.sessionPlanId(input.sessionId, trx);
        await trx
          .update(wmsTables.pickingPlans)
          .set({ status: 'completed', completedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(wmsTables.pickingPlans.id, planId), eq(wmsTables.pickingPlans.status, 'active')));
      }
      await this.assertConservation(updated, trx);
      await this.audit.logUserActionRequired(
        `batch_inventory_session.${input.eventType.toLowerCase()}`,
        'fulfillment',
        `${input.eventType} ${input.quantity} in session ${input.sessionId}`,
        { userId: input.actorId },
        {
          eventId: event.id,
          idempotencyKey: input.idempotencyKey,
          sessionId: input.sessionId,
          sequence: session.version,
          ...(typeof input.context?.shortPickOperationId === 'string' ? input.context : {}),
        },
        trx,
      );
      return { session: updated, event, replayed: false };
    }, tx);
  }

  private async assertShortageAllocation(
    input: {
      sessionId: string;
      idempotencyKey: string;
      eventType: 'MOVE_CUSTODY' | 'RETURN_TO_SOURCE' | 'SETTLE_FOR_DISPATCH' | 'APPROVE_SHORTAGE';
      actorId: string;
      skuId: string;
      quantity: number;
      from: SessionEventSide;
      to: SessionEventSide | null;
      context?: Record<string, unknown>;
    },
    planId: string,
    intent: ShortPickOperationIntentProof | null,
    tx: DbTx,
  ): Promise<void> {
    const shortPickOperationId = input.context?.shortPickOperationId;
    const shipmentLineId = input.context?.shipmentLineId;
    const sourceLocationId = input.context?.sourceLocationId;
    if (
      typeof shortPickOperationId !== 'string' ||
      typeof shipmentLineId !== 'string' ||
      sourceLocationId !== input.from.sourceLocationId
    ) {
      throw new BadRequestException('Approved shortage requires exact operation, line, and source attribution');
    }
    const intentLine = intent?.lines.find(
      (line) => line.shipmentLineId === shipmentLineId && line.sourceLocationId === sourceLocationId,
    );
    if (
      !intent ||
      intent.operationId !== shortPickOperationId ||
      intent.sessionId !== input.sessionId ||
      intent.actorId !== input.actorId ||
      input.context?.reason !== intent.reason ||
      !intentLine
    ) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_INTENT_MISMATCH',
        'Custody reconciliation is outside the immutable short-pick operation intent',
      );
    }

    const [operationLine] = await tx
      .select({ shipmentId: wmsTables.shipmentLines.shipmentId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.shipmentOperationMembers,
        and(
          eq(wmsTables.shipmentOperationMembers.shipmentId, wmsTables.shipmentLines.shipmentId),
          eq(wmsTables.shipmentOperationMembers.operationId, shortPickOperationId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
        ),
      )
      .where(eq(wmsTables.shipmentLines.id, shipmentLineId))
      .limit(1)
      .for('update');
    if (!operationLine) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_OWNERSHIP_MISMATCH',
        'Short-pick operation does not own the attributed shipment line as a source member',
      );
    }

    const [duplicateOperation] = await tx
      .select({ idempotencyKey: wmsTables.batchInventorySessionEvents.idempotencyKey })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, input.eventType),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'shortPickOperationId' = ${shortPickOperationId}`,
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'shipmentLineId' = ${shipmentLineId}`,
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'sourceLocationId' = ${sourceLocationId}`,
          eq(wmsTables.batchInventorySessionEvents.fromCustodyType, input.from.custodyType),
          sql`${wmsTables.batchInventorySessionEvents.fromCustodyRef} IS NOT DISTINCT FROM ${input.from.custodyRef}`,
          sql`${wmsTables.batchInventorySessionEvents.fromShipmentLineId} IS NOT DISTINCT FROM ${input.from.shipmentLineId}::uuid`,
        ),
      )
      .limit(1);
    if (duplicateOperation) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_DUPLICATE',
        'Short-pick operation already recorded this line/source custody outcome',
      );
    }

    const [allocation] = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, planId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, shipmentLineId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, sourceLocationId),
        ),
      )
      .limit(1)
      .for('update');
    if (!allocation || allocation.skuId !== input.skuId) {
      throw this.conflict(
        'SESSION_SHORTAGE_NOT_ALLOCATED',
        'Approved shortage does not match an exact persisted picking allocation',
      );
    }

    const [terminal] = await tx.execute<{
      returnedQty: number;
      settledQty: number;
      shortageQty: number;
      operationReturnedQty: number;
      operationShortageQty: number;
    }>(sql`
      SELECT
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'RETURN_TO_SOURCE'
            AND (from_shipment_line_id = ${shipmentLineId}::uuid OR payload->>'shipmentLineId' = ${shipmentLineId})
        ), 0)::int AS "returnedQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'SETTLE_FOR_DISPATCH' AND from_shipment_line_id = ${shipmentLineId}::uuid
        ), 0)::int AS "settledQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'APPROVE_SHORTAGE' AND payload->>'shipmentLineId' = ${shipmentLineId}
        ), 0)::int AS "shortageQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'RETURN_TO_SOURCE'
            AND payload->>'shortPickOperationId' = ${shortPickOperationId}
            AND payload->>'shipmentLineId' = ${shipmentLineId}
            AND payload->>'sourceLocationId' = ${sourceLocationId}
        ), 0)::int AS "operationReturnedQty",
        coalesce(sum(quantity) FILTER (
          WHERE event_type = 'APPROVE_SHORTAGE'
            AND payload->>'shortPickOperationId' = ${shortPickOperationId}
            AND payload->>'shipmentLineId' = ${shipmentLineId}
            AND payload->>'sourceLocationId' = ${sourceLocationId}
        ), 0)::int AS "operationShortageQty"
      FROM batch_inventory_session_events
      WHERE session_id = ${input.sessionId}::uuid
        AND (
          from_source_location_id = ${sourceLocationId}::uuid
          OR payload->>'sourceLocationId' = ${sourceLocationId}
        )
    `);
    const operationReturnedQty = Number(terminal?.operationReturnedQty ?? 0);
    const operationShortageQty = Number(terminal?.operationShortageQty ?? 0);
    if (input.eventType === 'APPROVE_SHORTAGE' && operationShortageQty + input.quantity > intentLine.shortQty) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_OPERATION_INTENT',
        `Approved shortage exceeds immutable intent quantity ${intentLine.shortQty}`,
      );
    }
    const intendedReturnQty = intentLine.allocationQty - intentLine.shortQty;
    if (input.eventType === 'RETURN_TO_SOURCE' && operationReturnedQty + input.quantity > intendedReturnQty) {
      throw this.conflict(
        'SESSION_RETURN_EXCEEDS_OPERATION_INTENT',
        `Terminal return exceeds immutable intent quantity ${intendedReturnQty}`,
      );
    }
    const [activeAttributed] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    const allocationRemaining = remainingShortPickAllocation({
      allocatedQty: allocation.qty,
      activeAttributedQty: Number(activeAttributed?.qty ?? 0),
      returnedQty: Number(terminal?.returnedQty ?? 0),
      settledQty: Number(terminal?.settledQty ?? 0),
      shortageQty: Number(terminal?.shortageQty ?? 0),
    });
    const newlyAttributedQty = input.from.shipmentLineId ? 0 : input.quantity;
    if (newlyAttributedQty > allocationRemaining) {
      throw this.conflict(
        'SESSION_SHORTAGE_EXCEEDS_ALLOCATION',
        `Short-pick custody outcome exceeds allocation ${allocation.id}: remaining=${allocationRemaining}`,
      );
    }
  }

  private async lockShortPickOperation(
    shortPickOperationId: string,
    tx: DbTx,
  ): Promise<{ status: 'pending' | 'recovery_required' | 'completed'; intent: ShortPickOperationIntentProof }> {
    const [operation] = await tx
      .select({
        type: wmsTables.shipmentOperations.type,
        status: wmsTables.shipmentOperations.status,
        snapshot: wmsTables.shipmentOperations.beforeManifestSnapshot,
      })
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, shortPickOperationId))
      .limit(1)
      .for('update');
    const intent = shortPickOperationIntentOf(operation?.snapshot);
    if (
      !operation ||
      operation.type !== 'short_pick' ||
      !['pending', 'recovery_required', 'completed'].includes(operation.status) ||
      !intent ||
      intent.operationId !== shortPickOperationId
    ) {
      throw this.conflict(
        'SESSION_SHORTAGE_OPERATION_INVALID',
        'Custody reconciliation requires an exact short-pick operation with immutable intent',
      );
    }
    return {
      status: operation.status as 'pending' | 'recovery_required' | 'completed',
      intent,
    };
  }

  private async lockSession(sessionId: string, tx: DbTx): Promise<SessionRow> {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session) throw new NotFoundException(`Batch inventory session ${sessionId} not found`);
    return session;
  }

  private assertBucket(bucket: SessionEventSide): void {
    if (!bucket.sourceLocationId) throw new BadRequestException('sourceLocationId is required');
    const assigned = ['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED'] as BatchInventoryCustodyType[];
    if (bucket.custodyType === 'AT_SOURCE' && (bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('AT_SOURCE custody cannot have a ref or shipment line');
    }
    if (bucket.custodyType === 'BULK_CART' && (!bucket.custodyRef || bucket.shipmentLineId)) {
      throw new BadRequestException('BULK_CART custody requires a ref and cannot have a shipment line');
    }
    if (assigned.includes(bucket.custodyType) && (!bucket.custodyRef || !bucket.shipmentLineId)) {
      throw new BadRequestException(`${bucket.custodyType} custody requires a ref and shipment line`);
    }
    if (['RETURN_PENDING', 'SETTLED'].includes(bucket.custodyType) && !bucket.shipmentLineId) {
      throw new BadRequestException(`${bucket.custodyType} custody requires a shipment line`);
    }
    if (['RETURN_PENDING', 'SETTLED'].includes(bucket.custodyType) && bucket.custodyRef) {
      throw new BadRequestException(`${bucket.custodyType} custody cannot have a custody ref`);
    }
  }

  private async assertLineAssignment(
    sessionId: string,
    skuId: string,
    bucket: SessionEventSide,
    tx: DbTx,
  ): Promise<void> {
    if (!bucket.shipmentLineId) return;
    const planId = await this.sessionPlanId(sessionId, tx);
    const [allocation] = await tx
      .select({ id: wmsTables.pickingSourceAllocations.id })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, planId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
          eq(wmsTables.shipmentLines.skuId, skuId),
        ),
      )
      .limit(1);
    if (!allocation) {
      throw this.conflict('SESSION_LINE_NOT_ALLOCATED', 'Custody shipment line is not allocated by the session plan');
    }
  }

  private async assertDispatchSettlementProof(
    input: {
      sessionId: string;
      dispatchAttemptSourceId: string;
      quantity: number;
      skuId: string;
      from: SessionEventSide;
    },
    tx: DbTx,
  ): Promise<void> {
    const [sourceIdentity] = await tx
      .select({ dispatchAttemptId: wmsTables.dispatchAttemptSources.dispatchAttemptId })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1);
    if (!sourceIdentity) {
      throw this.conflict('SESSION_SETTLEMENT_WITHOUT_DISPATCH', 'Dispatch source does not exist');
    }
    await tx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, sourceIdentity.dispatchAttemptId))
      .limit(1)
      .for('update');
    await tx
      .select({ id: wmsTables.dispatchAttemptSources.id })
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1)
      .for('update');
    const [source] = await tx
      .select({
        qty: wmsTables.dispatchAttemptSources.qty,
        sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
        shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
        stockEventId: wmsTables.dispatchAttemptSources.stockEventId,
        attemptStatus: wmsTables.dispatchAttempts.status,
        lineSkuId: wmsTables.shipmentLines.skuId,
        lineShipmentId: wmsTables.shipmentLines.shipmentId,
        attemptShipmentId: wmsTables.dispatchAttempts.shipmentId,
        warehouseId: wmsTables.shipments.warehouseId,
        eventSkuId: wmsTables.stockEvents.skuId,
        eventWarehouseId: wmsTables.stockEvents.fromWarehouseId,
        eventLocationId: wmsTables.stockEvents.fromLocationId,
        eventState: wmsTables.stockEvents.fromState,
        eventToWarehouseId: wmsTables.stockEvents.toWarehouseId,
        eventToState: wmsTables.stockEvents.toState,
        eventTransition: wmsTables.stockEvents.transitionType,
        eventQty: wmsTables.stockEvents.quantity,
      })
      .from(wmsTables.dispatchAttemptSources)
      .innerJoin(
        wmsTables.dispatchAttempts,
        eq(wmsTables.dispatchAttempts.id, wmsTables.dispatchAttemptSources.dispatchAttemptId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.dispatchAttemptSources.shipmentLineId),
      )
      .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.dispatchAttempts.shipmentId))
      .innerJoin(wmsTables.stockEvents, eq(wmsTables.stockEvents.id, wmsTables.dispatchAttemptSources.stockEventId))
      .where(eq(wmsTables.dispatchAttemptSources.id, input.dispatchAttemptSourceId))
      .limit(1);
    if (
      !source ||
      !source.stockEventId ||
      source.attemptStatus !== 'pending' ||
      source.shipmentLineId !== input.from.shipmentLineId ||
      source.sourceLocationId !== input.from.sourceLocationId ||
      source.lineShipmentId !== source.attemptShipmentId ||
      source.lineSkuId !== input.skuId ||
      source.lineSkuId !== source.eventSkuId ||
      source.warehouseId !== source.eventWarehouseId ||
      source.sourceLocationId !== source.eventLocationId ||
      source.eventState !== 'ON_HAND' ||
      source.eventToWarehouseId !== null ||
      source.eventToState !== null ||
      source.eventTransition !== 'SHIP' ||
      source.eventQty !== source.qty ||
      input.quantity > source.qty
    ) {
      throw this.conflict(
        'SESSION_SETTLEMENT_WITHOUT_DISPATCH',
        'Custody can settle only after its exact dispatch source stock event in the caller transaction',
      );
    }
    const [alreadySettled] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionEvents.quantity}), 0)::int` })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, input.sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'SETTLE_FOR_DISPATCH'),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'dispatchAttemptSourceId' = ${input.dispatchAttemptSourceId}`,
        ),
      );
    if (Number(alreadySettled?.qty ?? 0) + input.quantity > source.qty) {
      throw this.conflict('SESSION_SETTLEMENT_EXCEEDS_DISPATCH', 'Session settlement exceeds dispatch source quantity');
    }
  }

  private async assertAttributedQuantity(sessionId: string, bucket: SessionEventSide, tx: DbTx): Promise<void> {
    const planId = await this.sessionPlanId(sessionId, tx);
    const [allocated] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
      .from(wmsTables.pickingSourceAllocations)
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, planId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, bucket.shipmentLineId!),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, bucket.sourceLocationId),
        ),
      );
    const [attributed] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, bucket.shipmentLineId!),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, bucket.sourceLocationId),
        ),
      );
    if (Number(attributed?.qty ?? 0) > Number(allocated?.qty ?? 0)) {
      throw this.conflict('SESSION_LINE_OVER_ALLOCATED', 'Custody quantity exceeds the picking source allocation');
    }
  }

  private async assertConservation(session: SessionRow, tx: DbTx): Promise<void> {
    const [remaining] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    const accounted = Number(remaining?.qty ?? 0) + session.settledQty + session.returnedQty + session.shortageQty;
    if (accounted !== session.handedInQty) {
      throw this.conflict(
        'SESSION_CONSERVATION_FAILED',
        `Session ${session.id} handedIn=${session.handedInQty}, accounted=${accounted}`,
      );
    }
  }

  private sameBucket(
    balance: typeof wmsTables.batchInventorySessionBalances.$inferSelect,
    skuId: string,
    bucket: SessionEventSide,
  ): boolean {
    return (
      balance.skuId === skuId &&
      balance.sourceLocationId === bucket.sourceLocationId &&
      balance.custodyType === bucket.custodyType &&
      balance.custodyRef === bucket.custodyRef &&
      balance.shipmentLineId === bucket.shipmentLineId
    );
  }

  private eventPayload(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  }

  private async sessionPlanId(sessionId: string, tx: DbTx): Promise<string> {
    const [event] = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        ),
      )
      .limit(1);
    const planId = this.eventPayload(event?.payload).planId;
    if (typeof planId !== 'string') {
      throw this.conflict('SESSION_PLAN_ID_MISSING', `Session ${sessionId} has no immutable start plan identity`);
    }
    return planId;
  }

  private async assertExistingSessionPlan(sessionId: string, planId: string, tx: DbTx): Promise<void> {
    const startEvents = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
        ),
      );
    if (startEvents.length === 0 || startEvents.some((event) => this.eventPayload(event.payload).planId !== planId)) {
      throw this.conflict('SESSION_ALREADY_STARTED_FOR_OTHER_PLAN', `Batch has an active session for another plan`);
    }
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
