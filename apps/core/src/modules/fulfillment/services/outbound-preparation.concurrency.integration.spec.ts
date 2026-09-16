import * as preparationLocks from './outbound-preparation.locks';
import { SimpleOutboundService } from './simple-outbound.service';
import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import * as planLocks from '../picking/plan/picking-plan.locks';
import { randomUUID } from 'crypto';
import { eq, sql as sqlQuery } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, seedPickableShipment, receiveStock, wireLogistics } from './__support__';
import { assembleOutbound, ambientDbService } from './__support__/simple-outbound-wiring';
import { cleanupPreparationFixture } from './__support__/outbound-preparation-cleanup';
import { unwrapPreparedOutbound } from '../controllers/outbound-preparation-http';
import { isPreparationBlocked } from './outbound-preparation-result';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_WAREHOUSE_DEMO_DB === '1' && !DATABASE_URL) throw new Error('DATABASE_URL is required');
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('outbound preparation committed concurrency', () => {
  const observer = makeDb(DATABASE_URL!);
  afterAll(() => observer.sql.end());

  async function overlap<T, U>(first: (tx: DbTx) => Promise<T>, second: (tx: DbTx) => Promise<U>) {
    const a = makeDb(DATABASE_URL!);
    const b = makeDb(DATABASE_URL!);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atBarrier = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let runA: Promise<T> | undefined;
    let runB: Promise<U> | undefined;
    try {
      const [{ pid: pidA }] = await a.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      const [{ pid: pidB }] = await b.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      expect(pidA).not.toBe(pidB);
      runA = a.db.transaction(async (tx) => {
        await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
        const value = await first(tx);
        entered();
        await barrier;
        return value;
      });
      // Attach rejection handlers immediately, so failed transactions cannot leak unhandled rejections.
      const resultA = runA.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
      await Promise.race([
        atBarrier,
        resultA.then((result) => {
          throw result.ok ? new Error('missed barrier') : result.error;
        }),
      ]);
      let completed = false;
      runB = b.db.transaction(async (tx) => {
        await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
        return second(tx);
      });
      const resultB = runB
        .then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        )
        .finally(() => {
          completed = true;
        });
      let blocked = false;
      const deadline = Date.now() + 5000;
      while (!completed && Date.now() < deadline) {
        const [{ waiting }] = await observer.sql<
          { waiting: boolean }[]
        >`select ${pidA}::int = any(pg_blocking_pids(${pidB}::int)) as waiting`;
        if (waiting) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(completed).toBe(false);
      release();
      const firstResult = await resultA;
      if (!firstResult.ok) throw firstResult.error;
      return { first: firstResult.value, second: await resultB };
    } finally {
      release();
      await Promise.allSettled([runA, runB].filter((value) => value !== undefined));
      await Promise.all([a.sql.end(), b.sql.end()]);
    }
  }

  async function fixture(stale = false) {
    return observer.db.transaction(async (tx) => {
      const f = await seedPickableShipment(tx, 3);
      await assembleOutbound(tx).picking.plan(
        { batchId: f.batchId, shipmentIds: [f.shipmentId], actorId: f.actorId, idempotencyKey: randomUUID() },
        tx,
      );
      if (stale)
        await receiveStock(wireLogistics(ambientDbService(tx)).command, tx, {
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          locationId: f.locationId,
          quantity: 1,
        });
      return f;
    });
  }
  function start(f: Awaited<ReturnType<typeof fixture>>, key: string, tx: DbTx) {
    return assembleOutbound(tx).location.start(
      f.shipmentId,
      { warehouseId: f.warehouseId },
      { id: f.actorId, roles: ['logistics_worker'] },
      key,
      tx,
    );
  }
  async function assertSingleSession(f: Awaited<ReturnType<typeof fixture>>, expectedPlans: number) {
    const plans = await observer.db
      .select()
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
    expect(plans).toHaveLength(expectedPlans);
    expect(plans.filter((p) => p.status === 'active')).toHaveLength(1);
    const sessions = await observer.db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
    expect(sessions).toHaveLength(1);
    const custody = await observer.db
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId));
    expect(custody.reduce((sum, row) => sum + row.qty, 0)).toBe(3);
  }
  it.each([true, false])('serializes concurrent starts across real commits (same key=%s)', async (sameKey) => {
    const f = await fixture(true);
    try {
      const key = randomUUID();
      const secondKey = sameKey ? key : randomUUID();
      const result = await overlap(
        (tx) => start(f, key, tx),
        (tx) => start(f, secondKey, tx),
      );
      expect(result.first).toMatchObject({ status: 'in_progress' });
      if (sameKey) expect(result.second).toEqual({ ok: true, value: result.first });
      else {
        expect(result.second).toMatchObject({
          ok: false,
          error: {
            response: { code: 'PICKING_COMPONENT_CHANGED_RETRY' },
          },
        });
        expect(await observer.db.transaction((tx) => start(f, secondKey, tx))).toEqual(result.first);
      }
      await assertSingleSession(f, 2);
    } finally {
      await observer.db.transaction((tx) => cleanupPreparationFixture(tx, f));
    }
  });
  it.each(['stock', 'start'] as const)(
    'serializes stock move and preparation with %s committing first',
    async (first) => {
      const f = await fixture();
      const [destination] = await observer.db
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouseId, code: randomUUID(), locationType: 'zone' })
        .returning();
      const move = (tx: DbTx) =>
        wireLogistics(ambientDbService(tx)).command.moveInternal(
          {
            skuId: f.skuId,
            warehouseId: f.warehouseId,
            fromLocationId: f.locationId,
            toLocationId: destination.id,
            quantity: 3,
            idempotencyKey: randomUUID(),
          },
          tx,
        );
      try {
        if (first === 'stock') {
          const result = await overlap(move, (tx) => start(f, randomUUID(), tx));
          expect(result.second).toMatchObject({
            ok: true,
            value: { status: 'in_progress', sources: [{ sourceLocationId: destination.id, allocatedQty: 3 }] },
          });
          await assertSingleSession(f, 2);
        } else {
          const result = await overlap((tx) => start(f, randomUUID(), tx), move);
          expect(result.first).toMatchObject({ status: 'in_progress' });
          expect(result.second).toMatchObject({ ok: false });
          if (result.second.ok) throw new Error('Expected custody-protected move rejection');
          expect(result.second.error).toMatchObject({ response: { code: 'BATCH_CONTROLLED_STOCK' } });
          await assertSingleSession(f, 1);
        }
        const ledgers = await observer.db
          .select()
          .from(wmsTables.stockLedgers)
          .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
        expect(ledgers.reduce((sum, row) => sum + row.qty, 0)).toBe(3);
        const custody = await observer.db
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId));
        for (const balance of custody)
          expect(balance.qty).toBeLessThanOrEqual(
            ledgers.find((l) => l.locationId === balance.sourceLocationId)?.qty ?? 0,
          );
      } finally {
        await observer.db.transaction((tx) => cleanupPreparationFixture(tx, f));
      }
    },
  );
  it('persists a rejected preparation across commit and HTTP mapping on another connection', async () => {
    const f = await fixture();
    const key = randomUUID();
    try {
      await observer.db
        .update(wmsTables.stockLedgers)
        .set({ qty: 0, version: 2 })
        .where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      const rejected = await observer.db.transaction((tx) => start(f, key, tx));
      expect(isPreparationBlocked(rejected)).toBe(true);
      expect(() => unwrapPreparedOutbound(rejected)).toThrow();
      const other = makeDb(DATABASE_URL!);
      try {
        const replay = await other.db.transaction((tx) => start(f, key, tx));
        expect(replay).toEqual(rejected);
        const [saved] = await other.db
          .select()
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key));
        expect(saved).toMatchObject({ status: 'completed', responseSnapshot: rejected });
        const plans = await other.db
          .select()
          .from(wmsTables.pickingPlans)
          .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
        expect(plans.map((p) => p.status)).toEqual(['invalidated']);
        expect(
          await other.db
            .select()
            .from(wmsTables.batchInventorySessions)
            .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId)),
        ).toHaveLength(0);
      } finally {
        await other.sql.end();
      }
    } finally {
      await observer.db.transaction((tx) => cleanupPreparationFixture(tx, f));
    }
  });
  it.each([
    ['start', 'start'],
    ['scan', 'start'],
    ['force', 'start'],
    ['scan', 'scan'],
  ] as const)('finishes active %s with a direct %s paused at real mid-command locks', async (operation, competitor) => {
    const f = await fixture();
    await observer.db.transaction((tx) => start(f, randomUUID(), tx));
    const [plan] = await observer.db
      .select()
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.batchId, f.batchId));
    const direct = makeDb(DATABASE_URL!);
    const resume = makeDb(DATABASE_URL!);
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepared = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const prepare = SimpleOutboundService.prototype.prepare;
    const spy = jest.spyOn(SimpleOutboundService.prototype, 'prepare').mockImplementation(async function (...args) {
      const result = await prepare.apply(this, args);
      entered();
      await barrier;
      return result;
    });
    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    try {
      const [{ pid: directPid }] = await direct.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      const [{ pid: resumePid }] = await resume.sql<{ pid: number }[]>`select pg_backend_pid()::int as pid`;
      expect(directPid).not.toBe(resumePid);
      a = resume.db.transaction(async (tx) => {
        await tx.execute(sqlQuery`SET LOCAL statement_timeout = '5s'`);
        const { location } = assembleOutbound(tx);
        const actor = { id: f.actorId, roles: ['logistics_worker'] };
        if (operation === 'start') return start(f, randomUUID(), tx);
        if (operation === 'scan')
          return location.scan(
            f.shipmentId,
            {
              warehouseId: f.warehouseId,
              sourceLocationId: f.locationId,
              barcode: f.barcode,
              quantity: 1,
            },
            actor,
            randomUUID(),
            tx,
          );
        return location.force(
          f.shipmentId,
          {
            warehouseId: f.warehouseId,
            reason: 'concurrent active force',
            items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 3 }],
          },
          actor,
          randomUUID(),
          {
            scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
            granted: true,
            [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
          },
          tx,
        );
      });
      const resultA = a.then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      );
      await Promise.race([
        prepared,
        resultA.then((result) => {
          throw new Error(JSON.stringify(result));
        }),
      ]);
      let completed = false;
      b = direct.db.transaction(async (tx) => {
        await tx.execute(sqlQuery`SET LOCAL statement_timeout = '5s'`);
        if (competitor === 'scan') {
          const [session] = await tx
            .select()
            .from(wmsTables.batchInventorySessions)
            .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
          const [work] = await tx
            .select()
            .from(wmsTables.outboundBatchWorkItems)
            .where(eq(wmsTables.outboundBatchWorkItems.id, f.workItemId));
          return assembleOutbound(tx).picking.scan(
            {
              strategy: 'discrete',
              stage: 'source',
              batchId: f.batchId,
              planId: plan.id,
              sessionId: session.id,
              workItemId: f.workItemId,
              shipmentId: f.shipmentId,
              shipmentLineId: f.shipmentLineId,
              skuId: f.skuId,
              sourceLocationId: f.locationId,
              quantity: 1,
              actor: { id: f.actorId, roles: ['logistics_worker'] },
              expectedLeaseVersion: work.leaseVersion,
              idempotencyKey: randomUUID(),
            },
            tx,
          );
        }
        return assembleOutbound(tx).picking.start(
          {
            batchId: f.batchId,
            planId: plan.id,
            actorId: f.actorId,
            idempotencyKey: randomUUID(),
          },
          tx,
        );
      });
      const resultB = b
        .then(
          (value) => ({ ok: true as const, value }),
          (error) => ({ ok: false as const, error }),
        )
        .finally(() => {
          completed = true;
        });
      // Observe the real direct command either commit or wait on preparation before
      // allowing scan/force to execute. No synthetic plan/session locks are taken.
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (!waiting && !completed && Date.now() < deadline) {
        const [row] = await observer.sql<{ waiting: boolean }[]>`
            select ${resumePid}::int = any(pg_blocking_pids(${directPid}::int)) as waiting`;
        waiting = row.waiting;
        if (!waiting && !completed) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting || completed).toBe(true);
      release();
      const outcomeA = await resultA;
      const outcomeB = await resultB;
      if (!outcomeA.ok) throw outcomeA.error;
      if (!outcomeB.ok) throw outcomeB.error;
      expect(outcomeA.value).toMatchObject({ status: operation === 'force' ? 'shipped' : 'in_progress' });
      if (competitor === 'start')
        expect(outcomeB.value).toMatchObject({ state: 'started', sessionId: expect.any(String) });
      else expect(outcomeB.value).toBeDefined();
      const sessions = await observer.db
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
      expect(sessions).toHaveLength(1);
    } finally {
      release();
      spy.mockRestore();
      await Promise.allSettled([a, b].filter((value) => value !== undefined));
      await Promise.all([direct.sql.end(), resume.sql.end()]);
      await observer.db.transaction((tx) => cleanupPreparationFixture(tx, f));
    }
  });

  it.each(['draft-to-active', 'active-to-completed'] as const)(
    'retries %s after optimistic selection without switching lock order',
    async (transition) => {
      const f = await fixture();
      if (transition === 'active-to-completed') await observer.db.transaction((tx) => start(f, randomUUID(), tx));
      const prep = makeDb(DATABASE_URL!);
      const other = makeDb(DATABASE_URL!);
      let release!: () => void;
      let entered!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      const selected = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const read = preparationLocks.readPreparationPlan;
      let first = true;
      const spy = jest.spyOn(preparationLocks, 'readPreparationPlan').mockImplementation(async (...args) => {
        const plan = await read(...args);
        if (first) {
          first = false;
          entered();
          await barrier;
        }
        return plan;
      });
      let run: Promise<unknown> | undefined;
      const key = randomUUID();
      try {
        run = prep.db.transaction((tx) => start(f, key, tx));
        const outcome = run.then(
          (value) => ({ ok: true, value }),
          (error) => ({ ok: false, error }),
        );
        await Promise.race([
          selected,
          outcome.then((result) => {
            throw new Error(JSON.stringify(result));
          }),
        ]);
        await other.db.transaction(async (tx) => {
          const services = assembleOutbound(tx);
          if (transition === 'draft-to-active') {
            const plan = await read(f.batchId, tx);
            return services.picking.start(
              { batchId: f.batchId, planId: plan.id, actorId: f.actorId, idempotencyKey: randomUUID() },
              tx,
            );
          }
          return services.location.force(
            f.shipmentId,
            {
              warehouseId: f.warehouseId,
              reason: 'complete between active selection and work lock',
              items: [{ shipmentLineId: f.shipmentLineId, sourceLocationId: f.locationId, quantity: 3 }],
            },
            { id: f.actorId, roles: ['logistics_worker'] },
            randomUUID(),
            {
              scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
              granted: true,
              [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
            },
            tx,
          );
        });
        release();
        expect(await outcome).toMatchObject({
          ok: false,
          error: {
            response: { code: 'PICKING_COMPONENT_CHANGED_RETRY' },
          },
        });
        expect(
          await observer.db
            .select()
            .from(wmsTables.fulfillmentCommandRequests)
            .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key)),
        ).toHaveLength(0);
      } finally {
        release();
        spy.mockRestore();
        await Promise.allSettled([run]);
        await Promise.all([prep.sql.end(), other.sql.end()]);
        await observer.db.transaction((tx) => cleanupPreparationFixture(tx, f));
      }
    },
  );

  it('rejects a member added after optimistic discovery before acquiring its new fulfillment component', async () => {
    const f = await observer.db.transaction((tx) => seedPickableShipment(tx, 3));
    const other = await observer.db.transaction(async (tx) => {
      const seeded = await seedPickableShipment(tx, 3);
      await tx
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, seeded.workItemId));
      await tx
        .update(wmsTables.shipments)
        .set({ warehouseId: f.warehouseId })
        .where(eq(wmsTables.shipments.id, seeded.shipmentId));
      await tx
        .update(wmsTables.stockReservations)
        .set({ warehouseId: f.warehouseId })
        .where(eq(wmsTables.stockReservations.shipmentLineId, seeded.shipmentLineId));
      return seeded;
    });
    const prep = makeDb(DATABASE_URL!);
    const member = makeDb(DATABASE_URL!);
    let continuePreparation!: () => void;
    let discovered!: () => void;
    let releaseComponent!: () => void;
    let componentLocked!: () => void;
    const pausePreparation = new Promise<void>((resolve) => {
      continuePreparation = resolve;
    });
    const optimisticRead = new Promise<void>((resolve) => {
      discovered = resolve;
    });
    const holdComponent = new Promise<void>((resolve) => {
      releaseComponent = resolve;
    });
    const atComponent = new Promise<void>((resolve) => {
      componentLocked = resolve;
    });
    const lockAggregate = planLocks.lockAggregate;
    const spy = jest.spyOn(planLocks, 'lockAggregate').mockImplementation(async (...args) => {
      discovered();
      await pausePreparation;
      return lockAggregate(...args);
    });
    let run: Promise<unknown> | undefined;
    let blocker: Promise<unknown> | undefined;
    let addedWorkItemId: string | undefined;
    const key = randomUUID();
    try {
      run = prep.db.transaction(async (tx) => {
        await tx.execute(sqlQuery`SET LOCAL statement_timeout = '1500ms'`);
        return start(f, key, tx);
      });
      const result = run.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );
      await Promise.race([
        optimisticRead,
        result.then((value) => {
          throw new Error(JSON.stringify(value));
        }),
      ]);
      const added = await member.db.transaction((tx) =>
        assembleOutbound(tx).batches.addShipment(
          f.batchId,
          other.shipmentId,
          randomUUID(),
          { id: other.actorId, roles: ['logistics_worker'] },
          tx,
        ),
      );
      addedWorkItemId = added.workItem.id;
      // A newly joined worker may hold this FOI while waiting for its work item. Preparation
      // must reject its stale lock scope, not reacquire this earlier-order lock under the batch.
      blocker = member.db.transaction(async (tx) => {
        await tx
          .select()
          .from(wmsTables.fulfillmentOrderItems)
          .where(eq(wmsTables.fulfillmentOrderItems.skuId, other.skuId))
          .for('update');
        componentLocked();
        await holdComponent;
      });
      await atComponent;
      continuePreparation();
      expect(await result).toMatchObject({
        ok: false,
        error: { response: { code: 'PICKING_COMPONENT_CHANGED_RETRY' } },
      });
      expect(
        await observer.db
          .select()
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, key)),
      ).toHaveLength(0);
      expect(
        await observer.db.select().from(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.batchId, f.batchId)),
      ).toHaveLength(0);
    } finally {
      continuePreparation();
      releaseComponent();
      spy.mockRestore();
      await Promise.allSettled([run, blocker].filter((value) => value !== undefined));
      await Promise.all([prep.sql.end(), member.sql.end()]);
      await observer.db.transaction(async (tx) => {
        if (addedWorkItemId)
          await tx
            .update(wmsTables.outboundBatchWorkItems)
            .set({ batchId: other.batchId })
            .where(eq(wmsTables.outboundBatchWorkItems.id, addedWorkItemId));
        await cleanupPreparationFixture(tx, { ...other, workItemId: addedWorkItemId ?? other.workItemId });
        await cleanupPreparationFixture(tx, f);
      });
    }
  });
});
