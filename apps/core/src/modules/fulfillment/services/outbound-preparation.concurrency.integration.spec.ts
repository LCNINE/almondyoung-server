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
      const result = await overlap(
        (tx) => start(f, key, tx),
        (tx) => start(f, sameKey ? key : randomUUID(), tx),
      );
      expect(result.first).toMatchObject({ status: 'in_progress' });
      expect(result.second).toEqual({ ok: true, value: result.first });
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
});
