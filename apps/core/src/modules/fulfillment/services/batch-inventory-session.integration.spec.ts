import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { LocationService } from '../../inventory/core/services/location.service';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { BatchInventorySessionFaultInjector, BatchInventorySessionService } from './batch-inventory-session.service';
import { BatchSessionRecoveryService } from './batch-session-recovery.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Database = PostgresJsDatabase<typeof wmsSchema>;

class Rollback extends Error {}

describeIfDb('BatchInventorySessionService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const actorId = randomUUID();

  let client: postgres.Sql;
  let db: Database;
  let concurrentClient: postgres.Sql;
  let concurrentDb: Database;
  let services: ReturnType<typeof makeServices>;
  let concurrentServices: ReturnType<typeof makeServices>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    concurrentClient = postgres(DATABASE_URL as string, { max: 2 });
    concurrentDb = drizzle(concurrentClient, { schema: wmsSchema });
    services = makeServices(db);
    concurrentServices = makeServices(concurrentDb);
  });

  afterAll(async () => {
    await Promise.all([client.end(), concurrentClient.end()]);
  });

  function dbServiceFor(database: Database): DbService<typeof wmsSchema> {
    return {
      db: database,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function makeServices(database: Database, faultInjector?: BatchInventorySessionFaultInjector) {
    const dbService = dbServiceFor(database);
    const guard = new BatchControlledStockGuard();
    const audit = new AuditService(dbService);
    const sessions = new BatchInventorySessionService(dbService, guard, audit, faultInjector);
    const recovery = new BatchSessionRecoveryService(dbService, audit, guard);
    const outbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable, guard);
    const command = new InventoryCommandService(dbService, eventStore, outbox, new LocationService(dbService), guard);
    return { dbService, guard, audit, sessions, recovery, command };
  }

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (trx) => {
        await fn(trx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function expectConflict(action: Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
      await action;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { code } });
  }

  async function seedPlan(
    tx: DbTx,
    options: {
      quantity?: number;
      source?: { warehouseId: string; locationId: string; skuId: string; stockVersion: number };
    } = {},
  ) {
    const suffix = randomUUID();
    const quantity = options.quantity ?? 4;
    let source = options.source;
    if (!source) {
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `session-wh-${suffix}` })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `session-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'session sku', code: `SESSION-${suffix}`, holderId: holder.id })
        .returning();
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `SESSION-ZONE-${suffix}`, locationType: 'zone' })
        .returning();
      const [ledger] = await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: sku.id,
          warehouseId: warehouse.id,
          locationId: location.id,
          stockState: 'ON_HAND',
          qty: 10,
        })
        .returning();
      source = {
        warehouseId: warehouse.id,
        locationId: location.id,
        skuId: sku.id,
        stockVersion: ledger.version,
      };
    }

    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `session-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: source.warehouseId })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: source.skuId, qty: quantity })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: source.warehouseId,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'planned',
        recipientSnapshot: { name: 'Session fixture' },
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: source.skuId,
        qty: quantity,
      })
      .returning();
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'FULFILLMENT_ORDER',
      targetId: fulfillmentOrder.id,
      fulfillmentOrderItemId: item.id,
      shipmentLineId: line.id,
      skuId: source.skuId,
      warehouseId: source.warehouseId,
      quantity,
      status: 'confirmed',
      requestedAt: new Date(),
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `SESSION-BATCH-${suffix}`,
        warehouseId: source.warehouseId,
        pickingMethod: 'individual',
      })
      .returning();
    await tx.insert(wmsTables.outboundBatchWorkItems).values({
      batchId: batch.id,
      shipmentId: shipment.id,
      status: 'queued',
    });
    const createdBy = randomUUID();
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'discrete', createdBy })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values({
      planId: plan.id,
      shipmentId: shipment.id,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
    });
    const [allocation] = await tx
      .insert(wmsTables.pickingSourceAllocations)
      .values({
        planId: plan.id,
        shipmentLineId: line.id,
        sourceLocationId: source.locationId,
        qty: quantity,
        sourceStockVersion: source.stockVersion,
      })
      .returning();
    return { source, salesOrder, fulfillmentOrder, item, shipment, line, batch, plan, allocation, quantity };
  }

  it('hands in plan allocations without stock-ledger writes and replays the exact start', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedPlan(tx);
      const beforeStockEvents = await tx.select({ count: sql<number>`count(*)::int` }).from(wmsTables.stockEvents);
      const started = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      const replayed = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);

      expect(replayed.id).toBe(started.id);
      expect(started).toMatchObject({ handedInQty: fixture.quantity, settledQty: 0, returnedQty: 0, version: 2 });
      const events = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, started.id));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        idempotencyKey: `start:${fixture.plan.id}:${fixture.allocation.id}`,
        eventType: 'HAND_IN',
        quantity: fixture.quantity,
      });
      expect(events[0].payload).toEqual(
        expect.objectContaining({ sequence: 1, planId: fixture.plan.id, allocationId: fixture.allocation.id }),
      );
      const availability = await services.guard.getAvailability(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          sourceLocationId: fixture.source.locationId,
        },
        tx,
      );
      expect(availability).toMatchObject({ onHandQty: 10, batchControlledQty: 4, generallyAvailableQty: 6 });
      const afterStockEvents = await tx.select({ count: sql<number>`count(*)::int` }).from(wmsTables.stockEvents);
      expect(afterStockEvents).toEqual(beforeStockEvents);
    });
  });

  it('moves custody idempotently, rejects payload reuse, returns it, and replays after terminal settlement', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedPlan(tx);
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      const handoff = {
        sessionId: session.id,
        idempotencyKey: `handoff-${randomUUID()}`,
        actorId,
        quantity: fixture.quantity,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE' as const,
        },
        to: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'WORKER' as const,
          custodyRef: randomUUID(),
          shipmentLineId: fixture.line.id,
        },
      };
      const moved = await services.sessions.moveCustody(handoff, tx);
      const replayedMove = await services.sessions.moveCustody(handoff, tx);
      expect(moved.replayed).toBe(false);
      expect(replayedMove).toMatchObject({ replayed: true, event: { id: moved.event.id } });
      await expectConflict(
        services.sessions.moveCustody({ ...handoff, quantity: fixture.quantity - 1 }, tx),
        'SESSION_IDEMPOTENCY_MISMATCH',
      );

      const returned = await services.sessions.returnToSource(
        {
          sessionId: session.id,
          idempotencyKey: `return-${randomUUID()}`,
          actorId,
          quantity: fixture.quantity,
          from: handoff.to,
        },
        tx,
      );
      expect(returned.session).toMatchObject({ status: 'settled', returnedQty: fixture.quantity });
      const terminalReplay = await services.sessions.returnToSource(
        {
          sessionId: session.id,
          idempotencyKey: returned.event.idempotencyKey,
          actorId,
          quantity: fixture.quantity,
          from: handoff.to,
        },
        tx,
      );
      expect(terminalReplay).toMatchObject({ replayed: true, event: { id: returned.event.id } });
      expect(await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx)).toMatchObject({
        id: session.id,
        status: 'settled',
      });
      const [plan] = await tx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, fixture.plan.id));
      expect(plan.status).toBe('completed');
    });
  });

  it('rolls event and balance back together when the process crashes between the stages', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedPlan(tx);
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      const crashing = makeServices(db, {
        afterEventAppended: () => {
          throw new Error('simulated process crash after event append');
        },
      });
      const idempotencyKey = `crash-${randomUUID()}`;
      await expect(
        tx.transaction((savepoint) =>
          crashing.sessions.moveCustody(
            {
              sessionId: session.id,
              idempotencyKey,
              actorId,
              quantity: 1,
              from: {
                skuId: fixture.source.skuId,
                sourceLocationId: fixture.source.locationId,
                custodyType: 'AT_SOURCE',
              },
              to: {
                skuId: fixture.source.skuId,
                sourceLocationId: fixture.source.locationId,
                custodyType: 'WORKER',
                custodyRef: randomUUID(),
                shipmentLineId: fixture.line.id,
              },
            },
            savepoint as unknown as DbTx,
          ),
        ),
      ).rejects.toThrow('simulated process crash');

      const [eventCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
            eq(wmsTables.batchInventorySessionEvents.idempotencyKey, idempotencyKey),
          ),
        );
      const [source] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );
      expect(eventCount.count).toBe(0);
      expect(source.qty).toBe(fixture.quantity);
    });
  });

  it('rejects another batch plan and general stock movement against controlled quantity', async () => {
    await inRollbackTx(async (tx) => {
      const first = await seedPlan(tx, { quantity: 7 });
      const second = await seedPlan(tx, { quantity: 4, source: first.source });
      const [targetLocation] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId: first.source.warehouseId,
          code: `SESSION-MOVE-${randomUUID()}`,
          locationType: 'zone',
        })
        .returning();
      await services.sessions.startSession(first.batch.id, first.plan.id, tx);
      await expectConflict(
        services.sessions.startSession(second.batch.id, second.plan.id, tx),
        'PICKING_PLAN_SOURCE_STALE',
      );
      await expectConflict(
        services.command.moveInternal(
          {
            skuId: first.source.skuId,
            warehouseId: first.source.warehouseId,
            fromLocationId: first.source.locationId,
            toLocationId: targetLocation.id,
            quantity: 4,
          },
          tx,
        ),
        'BATCH_CONTROLLED_STOCK',
      );
    });
  });

  it('marks balance drift for recovery, rebuilds only from events, and rejects corrupted event identity', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedPlan(tx);
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      const custodyRef = randomUUID();
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `recovery-move-${randomUUID()}`,
          actorId,
          quantity: 2,
          from: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'AT_SOURCE',
          },
          to: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'WORKER',
            custodyRef,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 1 })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({
        healthy: false,
        recoveryRequired: true,
      });
      expect(
        await services.guard.getAvailability(
          {
            skuId: fixture.source.skuId,
            warehouseId: fixture.source.warehouseId,
            sourceLocationId: fixture.source.locationId,
          },
          tx,
        ),
      ).toMatchObject({ batchControlledQty: 3, generallyAvailableQty: 7 });
      expect(await services.recovery.rebuildFromEvents(session.id, tx)).toMatchObject({
        healthy: true,
        recoveryRequired: false,
      });
      const [worker] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(worker.qty).toBe(2);

      const [startEvent] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({ payload: { ...(startEvent.payload as object), requestHash: '0'.repeat(64) } })
        .where(eq(wmsTables.batchInventorySessionEvents.id, startEvent.id));
      const rejected = await services.recovery.rebuildFromEvents(session.id, tx);
      expect(rejected).toMatchObject({ healthy: false, recoveryRequired: true });
      expect(rejected.issues.join(' ')).toContain('canonical request hash differs');
      const [unchangedWorker] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.id, worker.id));
      expect(unchangedWorker.qty).toBe(2);
    });
  });

  it('links an exact SHIP before settlement and rolls the ledger, link, event and balance back together on failure', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedPlan(tx);
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      const packing = {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'PACKING' as const,
        custodyRef: randomUUID(),
        shipmentLineId: fixture.line.id,
      };
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `packing-${randomUUID()}`,
          actorId,
          quantity: fixture.quantity,
          from: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'AT_SOURCE',
          },
          to: packing,
        },
        tx,
      );
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'SHIPMENT_DISPATCH_ATTEMPT' })
        .returning();
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: fixture.shipment.id,
          attemptNo: 1,
          idempotencyKey: `dispatch-${randomUUID()}`,
          status: 'pending',
          stockJournalId: journal.id,
        })
        .returning();
      const [dispatchSource] = await tx
        .insert(wmsTables.dispatchAttemptSources)
        .values({
          dispatchAttemptId: attempt.id,
          shipmentLineId: fixture.line.id,
          sourceLocationId: fixture.source.locationId,
          qty: fixture.quantity,
        })
        .returning();
      const shipKey = `session-ship-${randomUUID()}`;
      const settleKey = `session-settle-${randomUUID()}`;
      const crashing = makeServices(db, {
        afterEventAppended: (eventType) => {
          if (eventType === 'SETTLE_FOR_DISPATCH') throw new Error('crash after settlement event');
        },
      });
      await expect(
        tx.transaction(async (savepoint) => {
          const trx = savepoint as unknown as DbTx;
          await services.command.ship(
            {
              skuId: fixture.source.skuId,
              warehouseId: fixture.source.warehouseId,
              locationId: fixture.source.locationId,
              quantity: fixture.quantity,
              journalId: journal.id,
              idempotencyKey: shipKey,
              batchSessionDispatch: { sessionId: session.id, dispatchAttemptSourceId: dispatchSource.id },
            },
            trx,
          );
          await crashing.sessions.settleForDispatch(
            {
              sessionId: session.id,
              idempotencyKey: settleKey,
              actorId,
              quantity: fixture.quantity,
              from: packing,
              dispatchAttemptSourceId: dispatchSource.id,
            },
            trx,
          );
        }),
      ).rejects.toThrow('crash after settlement event');
      const [rolledBackSource] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, dispatchSource.id));
      const [rolledBackLedger] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.source.skuId),
            eq(wmsTables.stockLedgers.locationId, fixture.source.locationId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      expect(rolledBackSource.stockEventId).toBeNull();
      expect(rolledBackLedger.qty).toBe(10);

      const shipped = await services.command.ship(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          locationId: fixture.source.locationId,
          quantity: fixture.quantity,
          journalId: journal.id,
          idempotencyKey: shipKey,
          batchSessionDispatch: { sessionId: session.id, dispatchAttemptSourceId: dispatchSource.id },
        },
        tx,
      );
      const settled = await services.sessions.settleForDispatch(
        {
          sessionId: session.id,
          idempotencyKey: settleKey,
          actorId,
          quantity: fixture.quantity,
          from: packing,
          dispatchAttemptSourceId: dispatchSource.id,
        },
        tx,
      );
      const [linkedSource] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, dispatchSource.id));
      expect(linkedSource.stockEventId).toBe(shipped.eventId);
      expect(settled.session).toMatchObject({ status: 'settled', settledQty: fixture.quantity });
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({ healthy: true });
    });
  });

  it('fails a rebuild closed when a general move consumes corrupt undercounted custody first', async () => {
    const fixture = await db.transaction((trx) => seedPlan(trx as unknown as DbTx, { quantity: 10 }));
    const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id);
    const [targetLocation] = await db
      .insert(wmsTables.locations)
      .values({
        warehouseId: fixture.source.warehouseId,
        code: `SESSION-RECOVERY-MOVE-${randomUUID()}`,
        locationType: 'zone',
      })
      .returning();
    await db
      .update(wmsTables.batchInventorySessionBalances)
      .set({ qty: 0 })
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
        ),
      );
    expect(await services.recovery.reconcile(session.id)).toMatchObject({
      healthy: false,
      recoveryRequired: true,
    });

    let releaseMove!: () => void;
    let moveHasStockLock!: () => void;
    const moveGate = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const stockLockReady = new Promise<void>((resolve) => {
      moveHasStockLock = resolve;
    });
    const movePromise = concurrentDb.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      await acquireStockAvailabilityLock(tx, fixture.source.skuId, fixture.source.warehouseId);
      moveHasStockLock();
      await moveGate;
      return concurrentServices.command.moveInternal(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          fromLocationId: fixture.source.locationId,
          toLocationId: targetLocation.id,
          quantity: fixture.quantity,
          idempotencyKey: `recovery-race-move-${randomUUID()}`,
        },
        tx,
      );
    });
    await stockLockReady;
    const rebuildPromise = services.recovery.rebuildFromEvents(session.id);
    releaseMove();
    const [moveResult, rebuildResult] = await Promise.all([movePromise, rebuildPromise]);

    expect(moveResult.eventId).not.toBeNull();
    expect(rebuildResult).toMatchObject({ healthy: false, recoveryRequired: true });
    expect(rebuildResult.issues.join(' ')).toContain('cannot restore controlled=10');
    const availability = await db.transaction((trx) =>
      services.guard.getAvailability(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          sourceLocationId: fixture.source.locationId,
        },
        trx as unknown as DbTx,
      ),
    );
    expect(availability.onHandQty).toBe(0);
    expect(availability.batchControlledQty).toBe(0);
    expect(availability.onHandQty).toBeGreaterThanOrEqual(availability.batchControlledQty);
    const [recoverySession] = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, session.id));
    expect(recoverySession.status).toBe('recovery_required');
  });

  it('rebuilds from the post-lock event stream when a concurrent return settles first', async () => {
    const fixture = await db.transaction((trx) => seedPlan(trx as unknown as DbTx));
    const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id);
    const worker = {
      skuId: fixture.source.skuId,
      sourceLocationId: fixture.source.locationId,
      custodyType: 'WORKER' as const,
      custodyRef: randomUUID(),
      shipmentLineId: fixture.line.id,
    };
    await services.sessions.moveCustody({
      sessionId: session.id,
      idempotencyKey: `recovery-return-move-${randomUUID()}`,
      actorId,
      quantity: fixture.quantity,
      from: {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'AT_SOURCE',
      },
      to: worker,
    });

    let rebuildPromise!: ReturnType<BatchSessionRecoveryService['rebuildFromEvents']>;
    await concurrentDb.transaction(async (trx) => {
      const returned = await concurrentServices.sessions.returnToSource(
        {
          sessionId: session.id,
          idempotencyKey: `recovery-concurrent-return-${randomUUID()}`,
          actorId,
          quantity: fixture.quantity,
          from: worker,
        },
        trx as unknown as DbTx,
      );
      expect(returned.session.status).toBe('settled');

      // The uncommitted return holds plan/session. Recovery must wait there
      // without taking the stock advisory lock, then replay the committed
      // terminal event before it acquires and revalidates stock.
      rebuildPromise = services.recovery.rebuildFromEvents(session.id);
      const stockLockKey = `${fixture.source.skuId}:${fixture.source.warehouseId}`;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [lockState] = await concurrentClient<{ locked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND granted
            AND pid <> pg_backend_pid()
            AND classid::bigint = ((hashtext(${stockLockKey})::bigint >> 32) & 4294967295)
            AND objid::bigint = (hashtext(${stockLockKey})::bigint & 4294967295)
            AND objsubid = 1
        ) AS locked
      `;
      expect(lockState.locked).toBe(false);
    });

    expect(await rebuildPromise).toMatchObject({ healthy: true, recoveryRequired: false });
    const [rebuiltSession] = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, session.id));
    expect(rebuiltSession).toMatchObject({ status: 'settled', recoveryReason: null });
    const liveBalances = await db
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          sql`${wmsTables.batchInventorySessionBalances.qty} > 0`,
        ),
      );
    expect(liveBalances).toHaveLength(0);
  });

  it('uses plan-before-session locks for concurrent final return and exact start replay', async () => {
    const fixture = await db.transaction((trx) => seedPlan(trx as unknown as DbTx));
    const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id);
    const worker = {
      skuId: fixture.source.skuId,
      sourceLocationId: fixture.source.locationId,
      custodyType: 'WORKER' as const,
      custodyRef: randomUUID(),
      shipmentLineId: fixture.line.id,
    };
    await services.sessions.moveCustody({
      sessionId: session.id,
      idempotencyKey: `concurrent-move-${randomUUID()}`,
      actorId,
      quantity: fixture.quantity,
      from: {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'AT_SOURCE',
      },
      to: worker,
    });
    const returnKey = `concurrent-return-${randomUUID()}`;
    const [returned, replayedStart] = await Promise.all([
      services.sessions.returnToSource({
        sessionId: session.id,
        idempotencyKey: returnKey,
        actorId,
        quantity: fixture.quantity,
        from: worker,
      }),
      concurrentServices.sessions.startSession(fixture.batch.id, fixture.plan.id),
    ]);
    expect(returned.session.status).toBe('settled');
    expect(replayedStart.id).toBe(session.id);
    expect(await services.sessions.startSession(fixture.batch.id, fixture.plan.id)).toMatchObject({
      id: session.id,
      status: 'settled',
    });
  });

  it('serializes concurrent overdrawn custody moves so exactly one succeeds', async () => {
    const fixture = await db.transaction((trx) => seedPlan(trx as unknown as DbTx));
    const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id);
    const move = (service: BatchInventorySessionService, suffix: string) =>
      service.moveCustody({
        sessionId: session.id,
        idempotencyKey: `concurrent-custody-${suffix}-${randomUUID()}`,
        actorId,
        quantity: 3,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE',
        },
        to: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'WORKER',
          custodyRef: randomUUID(),
          shipmentLineId: fixture.line.id,
        },
      });
    const outcomes = await Promise.allSettled([move(services.sessions, 'a'), move(concurrentServices.sessions, 'b')]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const balances = await db
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
    expect(balances.find((balance) => balance.custodyType === 'AT_SOURCE')?.qty).toBe(1);
    expect(
      balances.filter((balance) => balance.custodyType === 'WORKER').reduce((total, balance) => total + balance.qty, 0),
    ).toBe(3);
  });

  it('replays one exact session for two concurrent starts of the same plan', async () => {
    const fixture = await db.transaction((trx) => seedPlan(trx as unknown as DbTx));
    const [first, second] = await Promise.all([
      services.sessions.startSession(fixture.batch.id, fixture.plan.id),
      concurrentServices.sessions.startSession(fixture.batch.id, fixture.plan.id),
    ]);
    expect(second.id).toBe(first.id);
    const sessions = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.batchId, fixture.batch.id));
    expect(sessions).toHaveLength(1);
  });

  it('serializes two batches starting against the same source so only one controls it', async () => {
    const first = await db.transaction((trx) => seedPlan(trx as unknown as DbTx, { quantity: 6 }));
    const second = await db.transaction((trx) =>
      seedPlan(trx as unknown as DbTx, { quantity: 6, source: first.source }),
    );
    const outcomes = await Promise.allSettled([
      services.sessions.startSession(first.batch.id, first.plan.id),
      concurrentServices.sessions.startSession(second.batch.id, second.plan.id),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const sessions = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(sql`${wmsTables.batchInventorySessions.batchId} IN (${first.batch.id}::uuid, ${second.batch.id}::uuid)`);
    expect(sessions).toHaveLength(1);
  });
});
