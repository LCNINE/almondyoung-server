import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { acquireStockAvailabilityLocks } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchInventoryCustodyType, canonicalBatchSessionRequestHash } from './batch-inventory-session.service';

type SessionRow = typeof wmsTables.batchInventorySessions.$inferSelect;
type EventRow = typeof wmsTables.batchInventorySessionEvents.$inferSelect;
type BalanceRow = typeof wmsTables.batchInventorySessionBalances.$inferSelect;

interface ReplayBucket {
  skuId: string;
  sourceLocationId: string;
  custodyType: BatchInventoryCustodyType;
  custodyRef: string | null;
  shipmentLineId: string | null;
}

interface ExpectedBalance extends ReplayBucket {
  qty: number;
}

interface ReplayResult {
  valid: boolean;
  issues: string[];
  balances: ExpectedBalance[];
  handedInQty: number;
  settledQty: number;
  returnedQty: number;
  shortageQty: number;
  nextSequence: number;
  planId: string | null;
  status: 'active' | 'settled';
}

interface ReplaySourceLock {
  skuId: string;
  sourceLocationId: string;
  warehouseId: string;
}

export interface BatchSessionReconciliationResult {
  sessionId: string;
  healthy: boolean;
  recoveryRequired: boolean;
  issues: string[];
}

function payloadOf(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

function bucketKey(bucket: ReplayBucket): string {
  return [
    bucket.skuId,
    bucket.sourceLocationId,
    bucket.custodyType,
    bucket.custodyRef ?? '',
    bucket.shipmentLineId ?? '',
  ].join('|');
}

@Injectable()
export class BatchSessionRecoveryService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly audit: AuditService,
    private readonly controlledStock: BatchControlledStockGuard,
  ) {}

  async reconcile(sessionId: string, tx?: DbTx): Promise<BatchSessionReconciliationResult> {
    return this.dbService.run(async (trx) => {
      const session = await this.lockPlanThenSession(sessionId, trx);
      const events = await this.loadEvents(sessionId, trx);
      const replay = this.replay(session, events);
      replay.issues.push(...(await this.validatePersistedPlan(session, events, replay, trx)));
      replay.issues = [...new Set(replay.issues)];
      replay.valid = replay.issues.length === 0;
      const actualBalances = await this.loadBalances(sessionId, trx);
      const issues = [...replay.issues, ...this.compare(session, actualBalances, replay)];
      if (issues.length === 0) {
        return { sessionId, healthy: true, recoveryRequired: false, issues: [] };
      }
      await this.markRecoveryRequired(session, issues, trx, 'reconcile');
      return { sessionId, healthy: false, recoveryRequired: true, issues: [...new Set(issues)] };
    }, tx);
  }

  async rebuildFromEvents(sessionId: string, tx?: DbTx): Promise<BatchSessionReconciliationResult> {
    return this.dbService.run(async (trx) => {
      // Stock-control locks must precede plan/session locks. Dispatch removes
      // controlled stock under attempt/source -> stock locks and settles the
      // session afterwards, so taking them in the opposite order can deadlock.
      const preparedSources = await this.prepareReplayStockLocks(sessionId, trx);
      const session = await this.lockPlanThenSession(sessionId, trx);
      const events = await this.loadEvents(sessionId, trx);
      const replay = this.replay(session, events);
      replay.issues.push(...(await this.validatePersistedPlan(session, events, replay, trx)));
      replay.issues = [...new Set(replay.issues)];
      replay.valid = replay.issues.length === 0;
      if (!replay.valid) {
        await this.markRecoveryRequired(session, replay.issues, trx, 'rebuild_rejected');
        return { sessionId, healthy: false, recoveryRequired: true, issues: replay.issues };
      }

      const stockIssues = await this.validateReplayStockControl(session, replay, preparedSources, trx);
      if (stockIssues.length > 0) {
        await this.markRecoveryRequired(session, stockIssues, trx, 'rebuild_stock_rejected');
        return { sessionId, healthy: false, recoveryRequired: true, issues: stockIssues };
      }

      await trx
        .delete(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId));
      const nonZero = replay.balances.filter((balance) => balance.qty > 0);
      if (nonZero.length > 0) {
        await trx.insert(wmsTables.batchInventorySessionBalances).values(
          nonZero.map((balance) => ({
            sessionId,
            skuId: balance.skuId,
            sourceLocationId: balance.sourceLocationId,
            custodyType: balance.custodyType,
            custodyRef: balance.custodyRef,
            shipmentLineId: balance.shipmentLineId,
            qty: balance.qty,
          })),
        );
      }
      const completedAt = replay.status === 'settled' ? (session.completedAt ?? new Date()) : null;
      await trx
        .update(wmsTables.batchInventorySessions)
        .set({
          status: replay.status,
          version: replay.nextSequence,
          handedInQty: replay.handedInQty,
          settledQty: replay.settledQty,
          returnedQty: replay.returnedQty,
          shortageQty: replay.shortageQty,
          recoveryReason: null,
          completedAt,
          updatedAt: sql`now()`,
        })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      if (replay.planId) {
        await trx
          .update(wmsTables.pickingPlans)
          .set(
            replay.status === 'settled'
              ? { status: 'completed', completedAt, updatedAt: sql`now()` }
              : { status: 'active', completedAt: null, updatedAt: sql`now()` },
          )
          .where(eq(wmsTables.pickingPlans.id, replay.planId));
      }
      await this.audit.logRequired(
        {
          eventType: 'SYSTEM_WARNING',
          severity: 'WARN',
          action: 'batch_inventory_session.rebuild_from_events',
          module: 'fulfillment',
          description: `Rebuilt session ${sessionId} only from its append-only events`,
          resourceType: 'batch_inventory_session',
          resourceId: sessionId,
          metadata: {
            eventCount: events.length,
            balanceCount: nonZero.length,
            planId: replay.planId,
            nextSequence: replay.nextSequence,
          },
        },
        undefined,
        trx,
      );
      return { sessionId, healthy: true, recoveryRequired: false, issues: [] };
    }, tx);
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

  private async lockPlanThenSession(sessionId: string, tx: DbTx): Promise<SessionRow> {
    const [startIdentity] = await tx
      .select({ payload: wmsTables.batchInventorySessionEvents.payload })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        sql`${wmsTables.batchInventorySessionEvents.sessionId} = ${sessionId}::uuid AND ${wmsTables.batchInventorySessionEvents.eventType} = 'HAND_IN'`,
      )
      .limit(1);
    const planId = payloadOf(startIdentity?.payload).planId;
    if (typeof planId === 'string') {
      await tx
        .select({ id: wmsTables.pickingPlans.id })
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, planId))
        .limit(1)
        .for('update');
    }
    return this.lockSession(sessionId, tx);
  }

  private async prepareReplayStockLocks(sessionId: string, tx: DbTx): Promise<ReplaySourceLock[]> {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1);
    if (!session) throw new NotFoundException(`Batch inventory session ${sessionId} not found`);
    const events = await this.loadEvents(sessionId, tx);
    // HAND_IN identities form the immutable source-key universe. A concurrent
    // return or dispatch settlement may reduce/remove a live replay balance
    // before the later session lock, but it cannot introduce a new source key.
    const unresolved = this.handInSourceKeys(events);
    if (unresolved.length === 0) return [];

    const locationIds = [...new Set(unresolved.map((source) => source.sourceLocationId))].sort();
    const locations = await tx
      .select({ id: wmsTables.locations.id, warehouseId: wmsTables.locations.warehouseId })
      .from(wmsTables.locations)
      .where(inArray(wmsTables.locations.id, locationIds));
    const warehouseByLocation = new Map(locations.map((location) => [location.id, location.warehouseId]));
    const sources = unresolved
      .flatMap((source): ReplaySourceLock[] => {
        const warehouseId = warehouseByLocation.get(source.sourceLocationId);
        return warehouseId ? [{ ...source, warehouseId }] : [];
      })
      .sort((left, right) =>
        `${left.skuId}|${left.warehouseId}|${left.sourceLocationId}`.localeCompare(
          `${right.skuId}|${right.warehouseId}|${right.sourceLocationId}`,
        ),
      );
    if (sources.length !== unresolved.length) return [];

    await acquireStockAvailabilityLocks(
      tx,
      sources.map((source) => ({ skuId: source.skuId, warehouseId: source.warehouseId })),
    );
    // Advisory locks are pair-grained; exact ON_HAND rows are then locked in a
    // deterministic SKU/warehouse/location order before any session row lock.
    for (const source of sources) {
      await this.controlledStock.getAvailability(
        {
          skuId: source.skuId,
          warehouseId: source.warehouseId,
          sourceLocationId: source.sourceLocationId,
        },
        tx,
        { lock: true, excludingSessionId: sessionId },
      );
    }
    return sources;
  }

  private async validateReplayStockControl(
    session: SessionRow,
    replay: ReplayResult,
    preparedSources: ReplaySourceLock[],
    tx: DbTx,
  ): Promise<string[]> {
    const unresolved = this.groupReplayControlledSources(replay);
    const locationIds = [...new Set(unresolved.map((source) => source.sourceLocationId))].sort();
    const locations =
      locationIds.length === 0
        ? []
        : await tx
            .select({ id: wmsTables.locations.id, warehouseId: wmsTables.locations.warehouseId })
            .from(wmsTables.locations)
            .where(inArray(wmsTables.locations.id, locationIds));
    const warehouseByLocation = new Map(locations.map((location) => [location.id, location.warehouseId]));
    const actualSources = unresolved
      .flatMap((source): Array<ReplaySourceLock & { qty: number }> => {
        const warehouseId = warehouseByLocation.get(source.sourceLocationId);
        return warehouseId ? [{ ...source, warehouseId }] : [];
      })
      .sort((left, right) =>
        `${left.skuId}|${left.warehouseId}|${left.sourceLocationId}`.localeCompare(
          `${right.skuId}|${right.warehouseId}|${right.sourceLocationId}`,
        ),
      );
    const preparedKeys = new Set(
      preparedSources.map((source) => `${source.skuId}|${source.warehouseId}|${source.sourceLocationId}`),
    );
    if (
      actualSources.length !== unresolved.length ||
      actualSources.some(
        (source) => !preparedKeys.has(`${source.skuId}|${source.warehouseId}|${source.sourceLocationId}`),
      )
    ) {
      return ['replayed controlled sources changed before recovery locks were established'];
    }

    const issues: string[] = [];
    for (const source of actualSources) {
      const availability = await this.controlledStock.getAvailability(
        {
          skuId: source.skuId,
          warehouseId: source.warehouseId,
          sourceLocationId: source.sourceLocationId,
        },
        tx,
        { lock: true, excludingSessionId: session.id },
      );
      if (availability.onHandQty < availability.batchControlledQty + source.qty) {
        issues.push(
          `source ${source.skuId}/${source.sourceLocationId} cannot restore controlled=${source.qty}; ` +
            `onHand=${availability.onHandQty}, otherControlled=${availability.batchControlledQty}`,
        );
      }
    }
    return issues;
  }

  private handInSourceKeys(events: EventRow[]): Array<{ skuId: string; sourceLocationId: string }> {
    const sources = new Map<string, { skuId: string; sourceLocationId: string }>();
    for (const event of events) {
      if (event.eventType !== 'HAND_IN' || !event.toSourceLocationId) continue;
      const key = `${event.skuId}|${event.toSourceLocationId}`;
      sources.set(key, { skuId: event.skuId, sourceLocationId: event.toSourceLocationId });
    }
    return [...sources.values()].sort((left, right) =>
      `${left.skuId}|${left.sourceLocationId}`.localeCompare(`${right.skuId}|${right.sourceLocationId}`),
    );
  }

  private groupReplayControlledSources(
    replay: ReplayResult,
  ): Array<{ skuId: string; sourceLocationId: string; qty: number }> {
    const grouped = new Map<string, { skuId: string; sourceLocationId: string; qty: number }>();
    for (const balance of replay.balances) {
      if (balance.qty <= 0 || balance.custodyType === 'SETTLED') continue;
      const key = `${balance.skuId}|${balance.sourceLocationId}`;
      const current = grouped.get(key);
      grouped.set(key, {
        skuId: balance.skuId,
        sourceLocationId: balance.sourceLocationId,
        qty: (current?.qty ?? 0) + balance.qty,
      });
    }
    return [...grouped.values()].sort((left, right) =>
      `${left.skuId}|${left.sourceLocationId}`.localeCompare(`${right.skuId}|${right.sourceLocationId}`),
    );
  }

  private async loadEvents(sessionId: string, tx: DbTx): Promise<EventRow[]> {
    // Deliberately do not use createdAt/UUID as a recovery order. replay() accepts
    // only the monotonic payload sequence written under the session header lock.
    return tx
      .select()
      .from(wmsTables.batchInventorySessionEvents)
      .where(eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId));
  }

  private async loadBalances(sessionId: string, tx: DbTx): Promise<BalanceRow[]> {
    return tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId))
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
      .for('update');
  }

  private replay(session: SessionRow, events: EventRow[]): ReplayResult {
    const issues: string[] = [];
    const sequenced = events.map((event) => {
      const payload = payloadOf(event.payload);
      const sequence = payload.sequence;
      if (!Number.isSafeInteger(sequence) || Number(sequence) <= 0) {
        issues.push(`event ${event.id} has an invalid sequence`);
      }
      if (typeof payload.requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.requestHash)) {
        issues.push(`event ${event.id} has no canonical request hash`);
      }
      return { event, payload, sequence: Number(sequence) };
    });
    sequenced.sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < sequenced.length; index += 1) {
      if (sequenced[index].sequence !== index + 1) {
        issues.push(`event sequence is not contiguous at ${index + 1}`);
      }
    }
    const sequenceSet = new Set(sequenced.map((entry) => entry.sequence));
    if (sequenceSet.size !== sequenced.length) issues.push('event sequence contains duplicates');
    const nextSequence = sequenced.length + 1;
    if (session.version !== nextSequence) {
      issues.push(`session version ${session.version} does not equal next event sequence ${nextSequence}`);
    }
    if (events.length === 0) issues.push('session has no append-only events');

    const balances = new Map<string, ExpectedBalance>();
    let handedInQty = 0;
    let settledQty = 0;
    let returnedQty = 0;
    let shortageQty = 0;
    let planId: string | null = null;
    const apply = (side: ReplayBucket, delta: number, eventId: string) => {
      const key = bucketKey(side);
      const current = balances.get(key) ?? { ...side, qty: 0 };
      const qty = current.qty + delta;
      if (qty < 0) issues.push(`event ${eventId} removes custody that was never recorded`);
      balances.set(key, { ...current, qty });
    };

    for (const { event, payload } of sequenced) {
      const from = this.side(event, 'from');
      const to = this.side(event, 'to');
      if (event.eventType === 'HAND_IN') {
        if (from || !to || to.custodyType !== 'AT_SOURCE') issues.push(`HAND_IN event ${event.id} has invalid sides`);
        if (typeof payload.planId !== 'string' || typeof payload.allocationId !== 'string') {
          issues.push(`HAND_IN event ${event.id} has no immutable plan/allocation identity`);
        } else if (planId && payload.planId !== planId) {
          issues.push(`HAND_IN event ${event.id} switches the session plan`);
        } else {
          planId = payload.planId;
        }
        handedInQty += event.quantity;
      } else if (event.eventType === 'MOVE_CUSTODY') {
        if (!from || !to || to.custodyType === 'SETTLED')
          issues.push(`MOVE_CUSTODY event ${event.id} has invalid sides`);
      } else if (event.eventType === 'RETURN_TO_SOURCE') {
        if (!from || to) issues.push(`RETURN_TO_SOURCE event ${event.id} has invalid sides`);
        returnedQty += event.quantity;
      } else if (event.eventType === 'SETTLE_FOR_DISPATCH') {
        if (!from || !to || to.custodyType !== 'SETTLED') {
          issues.push(`SETTLE_FOR_DISPATCH event ${event.id} has invalid sides`);
        }
        settledQty += event.quantity;
      } else if (event.eventType === 'APPROVE_SHORTAGE') {
        if (!from || to) issues.push(`APPROVE_SHORTAGE event ${event.id} has invalid sides`);
        shortageQty += event.quantity;
      } else {
        issues.push(`event ${event.id} has unsupported type ${event.eventType}`);
      }
      if (from) apply(from, -event.quantity, event.id);
      if (to) apply(to, event.quantity, event.id);
    }

    const expectedBalances = [...balances.values()];
    const remainingQty = expectedBalances
      .filter((balance) => balance.custodyType !== 'SETTLED')
      .reduce((total, balance) => total + Math.max(0, balance.qty), 0);
    if (handedInQty !== remainingQty + settledQty + returnedQty + shortageQty) {
      issues.push('event stream violates session quantity conservation');
    }
    if (session.shortageQty > 0 && shortageQty === 0) {
      issues.push('session header has shortage quantity without an append-only shortage event');
    }
    return {
      valid: issues.length === 0,
      issues: [...new Set(issues)],
      balances: expectedBalances,
      handedInQty,
      settledQty,
      returnedQty,
      shortageQty,
      nextSequence,
      planId,
      status: remainingQty === 0 ? 'settled' : 'active',
    };
  }

  private async validatePersistedPlan(
    session: SessionRow,
    events: EventRow[],
    replay: ReplayResult,
    tx: DbTx,
  ): Promise<string[]> {
    const issues: string[] = [];
    if (!replay.planId) return ['session event stream has no immutable plan identity'];
    const [plan] = await tx
      .select({ id: wmsTables.pickingPlans.id, batchId: wmsTables.pickingPlans.batchId })
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, replay.planId))
      .limit(1);
    if (!plan || plan.batchId !== session.batchId) return ['session plan is missing or belongs to another batch'];

    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        quantity: wmsTables.pickingSourceAllocations.qty,
        sourceStockVersion: wmsTables.pickingSourceAllocations.sourceStockVersion,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(eq(wmsTables.pickingSourceAllocations.planId, replay.planId));
    const allocationById = new Map(allocations.map((allocation) => [allocation.id, allocation]));
    const startEvents = events.filter((event) => event.eventType === 'HAND_IN');
    const seenAllocationIds = new Set<string>();
    for (const event of events) {
      const payload = payloadOf(event.payload);
      const from = this.side(event, 'from');
      const to = this.side(event, 'to');
      const canonicalFrom = from ? this.requestSide(from) : null;
      const canonicalTo = to ? this.requestSide(to) : null;
      let expectedHash: string;
      if (event.eventType === 'HAND_IN') {
        const allocationId = payload.allocationId;
        if (typeof allocationId !== 'string' || seenAllocationIds.has(allocationId)) {
          issues.push(`HAND_IN event ${event.id} has a missing or duplicate allocationId`);
          continue;
        }
        seenAllocationIds.add(allocationId);
        const allocation = allocationById.get(allocationId);
        if (
          !allocation ||
          payload.planId !== replay.planId ||
          payload.shipmentLineId !== allocation.shipmentLineId ||
          payload.sourceStockVersion !== allocation.sourceStockVersion ||
          event.skuId !== allocation.skuId ||
          event.quantity !== allocation.quantity ||
          event.toCustodyType !== 'AT_SOURCE' ||
          event.toSourceLocationId !== allocation.sourceLocationId ||
          event.toShipmentLineId !== null ||
          event.toCustodyRef !== null
        ) {
          issues.push(`HAND_IN event ${event.id} differs from persisted allocation ${String(allocationId)}`);
          continue;
        }
        expectedHash = canonicalBatchSessionRequestHash({
          eventType: 'HAND_IN',
          planId: replay.planId,
          allocationId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          shipmentLineId: allocation.shipmentLineId,
          quantity: allocation.quantity,
          sourceStockVersion: allocation.sourceStockVersion,
        });
      } else {
        const canonicalRequest: Record<string, unknown> = {
          sessionId: event.sessionId,
          idempotencyKey: event.idempotencyKey,
          eventType: event.eventType,
          actorId: payload.actorId,
          skuId: event.skuId,
          quantity: event.quantity,
          from: canonicalFrom,
          to: canonicalTo,
        };
        if (typeof payload.actorId !== 'string' || !payload.actorId.trim()) {
          issues.push(`event ${event.id} has no actor identity`);
        }
        if (event.eventType === 'SETTLE_FOR_DISPATCH') {
          canonicalRequest.context = { dispatchAttemptSourceId: payload.dispatchAttemptSourceId };
          if (typeof payload.dispatchAttemptSourceId !== 'string') {
            issues.push(`SETTLE_FOR_DISPATCH event ${event.id} has no dispatch source identity`);
          } else {
            const [dispatchProof] = await tx
              .select({
                qty: wmsTables.dispatchAttemptSources.qty,
                sourceLocationId: wmsTables.dispatchAttemptSources.sourceLocationId,
                shipmentLineId: wmsTables.dispatchAttemptSources.shipmentLineId,
                eventSkuId: wmsTables.stockEvents.skuId,
                eventLocationId: wmsTables.stockEvents.fromLocationId,
                eventState: wmsTables.stockEvents.fromState,
                eventTransition: wmsTables.stockEvents.transitionType,
                eventQty: wmsTables.stockEvents.quantity,
              })
              .from(wmsTables.dispatchAttemptSources)
              .innerJoin(
                wmsTables.stockEvents,
                eq(wmsTables.stockEvents.id, wmsTables.dispatchAttemptSources.stockEventId),
              )
              .where(eq(wmsTables.dispatchAttemptSources.id, payload.dispatchAttemptSourceId))
              .limit(1);
            if (
              !dispatchProof ||
              !from ||
              dispatchProof.qty !== event.quantity ||
              dispatchProof.sourceLocationId !== from.sourceLocationId ||
              dispatchProof.shipmentLineId !== from.shipmentLineId ||
              dispatchProof.eventSkuId !== event.skuId ||
              dispatchProof.eventLocationId !== from.sourceLocationId ||
              dispatchProof.eventState !== 'ON_HAND' ||
              dispatchProof.eventTransition !== 'SHIP' ||
              dispatchProof.eventQty !== event.quantity
            ) {
              issues.push(`SETTLE_FOR_DISPATCH event ${event.id} no longer owns its exact SHIP source`);
            }
          }
        }
        expectedHash = canonicalBatchSessionRequestHash(canonicalRequest);
      }
      if (payload.requestHash !== expectedHash) issues.push(`event ${event.id} canonical request hash differs`);

      for (const side of [from, to]) {
        if (!side) continue;
        if (!this.validBucket(side)) issues.push(`event ${event.id} contains an invalid custody grain`);
        const matchingAllocation = allocations.find(
          (allocation) =>
            allocation.skuId === side.skuId &&
            allocation.sourceLocationId === side.sourceLocationId &&
            (!side.shipmentLineId || allocation.shipmentLineId === side.shipmentLineId),
        );
        if (!matchingAllocation) issues.push(`event ${event.id} custody is outside the session plan`);
      }
      if (from && to && from.sourceLocationId !== to.sourceLocationId) {
        issues.push(`event ${event.id} changes the original source location`);
      }
    }
    if (startEvents.length !== allocations.length || seenAllocationIds.size !== allocations.length) {
      issues.push('HAND_IN event set does not exactly cover persisted plan allocations');
    }
    return issues;
  }

  private requestSide(side: ReplayBucket) {
    return {
      custodyType: side.custodyType,
      custodyRef: side.custodyRef,
      sourceLocationId: side.sourceLocationId,
      shipmentLineId: side.shipmentLineId,
    };
  }

  private validBucket(bucket: ReplayBucket): boolean {
    if (bucket.custodyType === 'AT_SOURCE') return bucket.custodyRef === null && bucket.shipmentLineId === null;
    if (bucket.custodyType === 'BULK_CART') return bucket.custodyRef !== null && bucket.shipmentLineId === null;
    if (['WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED'].includes(bucket.custodyType)) {
      return bucket.custodyRef !== null && bucket.shipmentLineId !== null;
    }
    if (['RETURN_PENDING', 'SETTLED'].includes(bucket.custodyType)) {
      return bucket.custodyRef === null && bucket.shipmentLineId !== null;
    }
    return false;
  }

  private side(event: EventRow, side: 'from' | 'to'): ReplayBucket | null {
    const custodyType = side === 'from' ? event.fromCustodyType : event.toCustodyType;
    if (!custodyType) return null;
    const sourceLocationId = side === 'from' ? event.fromSourceLocationId : event.toSourceLocationId;
    if (!sourceLocationId) return null;
    return {
      skuId: event.skuId,
      sourceLocationId,
      custodyType,
      custodyRef: side === 'from' ? event.fromCustodyRef : event.toCustodyRef,
      shipmentLineId: side === 'from' ? event.fromShipmentLineId : event.toShipmentLineId,
    };
  }

  private compare(session: SessionRow, actual: BalanceRow[], replay: ReplayResult): string[] {
    const issues: string[] = [];
    if (!replay.valid) return [];
    const actualMap = new Map(
      actual.filter((balance) => balance.qty > 0).map((balance) => [bucketKey(balance as ReplayBucket), balance.qty]),
    );
    const expectedMap = new Map(
      replay.balances.filter((balance) => balance.qty > 0).map((balance) => [bucketKey(balance), balance.qty]),
    );
    const keys = new Set([...actualMap.keys(), ...expectedMap.keys()]);
    for (const key of keys) {
      if ((actualMap.get(key) ?? 0) !== (expectedMap.get(key) ?? 0)) issues.push(`balance drift at ${key}`);
    }
    if (
      session.handedInQty !== replay.handedInQty ||
      session.settledQty !== replay.settledQty ||
      session.returnedQty !== replay.returnedQty ||
      session.shortageQty !== replay.shortageQty
    ) {
      issues.push('session header totals differ from append-only events');
    }
    if (session.status !== replay.status) issues.push(`session status ${session.status} should be ${replay.status}`);
    return issues;
  }

  private async markRecoveryRequired(session: SessionRow, issues: string[], tx: DbTx, action: string): Promise<void> {
    const uniqueIssues = [...new Set(issues)];
    const reason = uniqueIssues.join('; ').slice(0, 4_000) || 'unknown session drift';
    await tx
      .update(wmsTables.batchInventorySessions)
      .set({ status: 'recovery_required', recoveryReason: reason, updatedAt: sql`now()` })
      .where(eq(wmsTables.batchInventorySessions.id, session.id));
    await this.audit.logRequired(
      {
        eventType: 'SYSTEM_WARNING',
        severity: 'WARN',
        action: `batch_inventory_session.${action}`,
        module: 'fulfillment',
        description: `Session ${session.id} requires deterministic event recovery`,
        resourceType: 'batch_inventory_session',
        resourceId: session.id,
        metadata: { issues: uniqueIssues },
      },
      undefined,
      tx,
    );
  }
}
