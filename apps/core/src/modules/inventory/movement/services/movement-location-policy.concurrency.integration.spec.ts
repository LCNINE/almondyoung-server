import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import { SYSTEM_LOCATION_DEFAULTS } from '../../core/constants/warehouse.constants';
import { SystemLocationRole } from '../../core/types';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';
import { makeDb, seedSku, receiveStock } from '../../../fulfillment/services/__support__';
import {
  DATABASE_URL,
  describeIfDb,
  wiringFor,
  seed,
  snapshot,
  request,
} from './__support__/movement-location-policy-fixtures';

// The blocker connection can observe its peer: no sleeps used as evidence of a lock.
async function waitForLocationBlock(tx: DbTx, waiterPid: number, blockerPid: number) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    // pg_stat_activity is cached per transaction unless explicitly refreshed.
    await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
    const rows = await tx.execute<{ blocked: boolean; query: string }>(sql`
      SELECT ${blockerPid} = ANY(pg_blocking_pids(pid)) AS blocked, query
      FROM pg_stat_activity WHERE pid = ${waiterPid}`);
    if (rows[0]?.blocked && rows[0].query.includes('locations')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('peer did not block on the location row');
}

describeIfDb('movement / putaway location concurrency (two PostgreSQL connections)', () => {
  let first: ReturnType<typeof makeDb>;
  let second: ReturnType<typeof makeDb>;
  beforeAll(() => {
    first = makeDb(DATABASE_URL!);
    second = makeDb(DATABASE_URL!);
  });
  afterAll(async () => {
    await first.sql.end();
    await second.sql.end();
  });

  async function committedFixture(purpose: 'movement' | 'putaway') {
    return first.db.transaction(async (tx) => {
      const f = await seed(tx);
      await tx.update(wmsTables.locations).set({ isActive: true }).where(eq(wmsTables.locations.id, f.dest.id));
      const arrival =
        purpose === 'putaway'
          ? await f.wiring.kernel.recordArrival(
              {
                source: 'direct',
                method: 'simple',
                warehouseId: f.warehouseId,
                reason: 'race',
                lines: [{ skuId: f.skuId, quantity: 3, eventKey: randomUUID() }],
              },
              tx,
            )
          : null;
      return { ...f, receiptLineId: arrival?.lines[0].id, dto: request(f, 2) };
    });
  }
  type Fixture = Awaited<ReturnType<typeof committedFixture>>;

  async function cleanup(f: Fixture) {
    await first.db.transaction(async (tx) => {
      const skus = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.holderId, f.holderId));
      const skuIds = skus.map((s) => s.id);
      const events = await tx.select().from(wmsTables.stockEvents).where(inArray(wmsTables.stockEvents.skuId, skuIds));
      const journals = events.flatMap((e) => (e.journalId ? [e.journalId] : []));
      const jobs = await tx
        .select()
        .from(wmsTables.movementJobs)
        .where(eq(wmsTables.movementJobs.warehouseId, f.warehouseId));
      await tx.delete(wmsTables.movementWorkLogs).where(eq(wmsTables.movementWorkLogs.warehouseId, f.warehouseId));
      if (jobs.length)
        await tx.delete(wmsTables.movementJobLines).where(
          inArray(
            wmsTables.movementJobLines.jobId,
            jobs.map((j) => j.id),
          ),
        );
      await tx.delete(wmsTables.movementJobs).where(eq(wmsTables.movementJobs.warehouseId, f.warehouseId));
      const receipts = await tx
        .select()
        .from(wmsTables.inboundReceipts)
        .where(eq(wmsTables.inboundReceipts.warehouseId, f.warehouseId));
      await tx.delete(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouseId));
      if (receipts.length)
        await tx.delete(wmsTables.inboundReceiptLines).where(
          inArray(
            wmsTables.inboundReceiptLines.receiptId,
            receipts.map((r) => r.id),
          ),
        );
      await tx.delete(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.warehouseId, f.warehouseId));
      await tx.delete(wmsTables.stockLedgers).where(inArray(wmsTables.stockLedgers.skuId, skuIds));
      await tx.delete(wmsTables.stockEvents).where(inArray(wmsTables.stockEvents.skuId, skuIds));
      if (journals.length)
        await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journals));
      await tx
        .delete(wmsTables.inventoryIdempotencyRequests)
        .where(eq(wmsTables.inventoryIdempotencyRequests.key, f.dto.idempotencyKey));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, f.warehouseId));
      await tx.delete(wmsTables.skus).where(inArray(wmsTables.skus.id, skuIds));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, f.holderId));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, f.warehouseId));
    });
  }

  async function operate(tx: DbTx, f: Fixture, purpose: 'movement' | 'putaway') {
    const w = wiringFor(tx);
    if (purpose === 'movement') return w.movement.moveImmediately(f.dto);
    return w.kernel.putaway(
      { receiptLineId: f.receiptLineId!, toLocationId: f.dest.id, quantity: 2, eventKey: f.dto.idempotencyKey },
      tx,
    );
  }

  it.each(['movement', 'putaway'] as const)(
    '%s waits for an earlier deactivation commit and rejects without writes',
    async (purpose) => {
      const f = await committedFixture(purpose);
      const [peer] = await second.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      let work: Promise<unknown> | undefined;
      try {
        const before = await first.db.transaction((tx) => snapshot(tx, f));
        await first.db.transaction(async (tx) => {
          const [holder] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
          await tx.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.dest.id));
          // Attach rejection immediately, while keeping its value for assertions after commit.
          work = second.db
            .transaction((other) => operate(other, f, purpose))
            .then(
              () => ({ succeeded: true }),
              (error: unknown) => error,
            );
          await waitForLocationBlock(tx, peer.pid, holder.pid);
        });
        expect(await work).toMatchObject(
          purpose === 'movement'
            ? { status: 409, response: { code: 'MOVEMENT_DESTINATION_INACTIVE' } }
            : { status: 400, message: 'destination location is inactive' },
        );
        await first.db.transaction(async (tx) => {
          expect(await snapshot(tx, f)).toEqual(before);
          if (f.receiptLineId) {
            const [line] = await tx
              .select()
              .from(wmsTables.inboundReceiptLines)
              .where(eq(wmsTables.inboundReceiptLines.id, f.receiptLineId));
            expect(line.putawayFromOriginQty).toBe(0);
            const logs = await tx
              .select()
              .from(wmsTables.inboundWorkLogs)
              .where(eq(wmsTables.inboundWorkLogs.lineId, f.receiptLineId));
            expect(logs).toHaveLength(0);
          }
        });
      } finally {
        await work;
        await cleanup(f);
      }
    },
  );

  it.each(['movement', 'putaway'] as const)(
    '%s holds the destination through commit and makes deactivation wait',
    async (purpose) => {
      const f = await committedFixture(purpose);
      const [peer] = await second.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      let update: Promise<unknown> | undefined;
      try {
        await first.db.transaction(async (tx) => {
          const [holder] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
          await operate(tx, f, purpose);
          update = second.db.transaction((other) =>
            other.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.dest.id)),
          );
          await waitForLocationBlock(tx, peer.pid, holder.pid);
        });
        await update;
        await first.db.transaction(async (tx) => {
          const state = await snapshot(tx, f);
          expect(state.ledgers.find((l) => l.locationId === f.dest.id)?.qty).toBe(2);
          expect(state.events.filter((e) => e.transitionType === 'MOVE')).toHaveLength(1);
          const [destination] = await tx
            .select()
            .from(wmsTables.locations)
            .where(eq(wmsTables.locations.id, f.dest.id));
          expect(destination.isActive).toBe(false);
          if (f.receiptLineId) {
            const [line] = await tx
              .select()
              .from(wmsTables.inboundReceiptLines)
              .where(eq(wmsTables.inboundReceiptLines.id, f.receiptLineId));
            expect(line.putawayFromOriginQty).toBe(2);
          }
        });
      } finally {
        await update;
        await cleanup(f);
      }
    },
  );

  it('recordArrival and movement on different SKUs acquire shared system locations in UUID order', async () => {
    const f = await committedFixture('movement');
    const low = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`;
    const high = `ffffffff-ffff-4fff-8fff-${randomUUID().slice(-12)}`;
    let arrival: Promise<unknown> | undefined;
    try {
      const otherSku = await first.db.transaction(async (tx) => {
        // Force the historical role order (inbound then return) to oppose UUID order.
        for (const role of Object.keys(SYSTEM_LOCATION_DEFAULTS) as SystemLocationRole[]) {
          const def = SYSTEM_LOCATION_DEFAULTS[role];
          await tx.insert(wmsTables.locations).values({
            id: role === 'inbound_default' ? high : role === 'return_default' ? low : randomUUID(),
            warehouseId: f.warehouseId,
            code: def.code,
            displayName: def.displayName,
            locationType: 'zone',
            isSystem: true,
            systemRole: role,
          });
        }
        const other = await seedSku(tx, f.holderId);
        await receiveStock(wiringFor(tx).command, tx, {
          warehouseId: f.warehouseId,
          locationId: low,
          skuId: f.skuId,
          quantity: 2,
        });
        return other;
      });
      const [peer] = await second.sql<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await first.db.transaction(async (tx) => {
        const [holder] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        await acquireStockAvailabilityLocks(tx, [{ skuId: f.skuId, warehouseId: f.warehouseId }]);
        // Pause at the first row of a movement's ordered location lock acquisition.
        await tx.select().from(wmsTables.locations).where(eq(wmsTables.locations.id, low)).for('share');
        arrival = second.db
          .transaction((other) =>
            wiringFor(other).kernel.recordArrival(
              {
                source: 'direct',
                method: 'simple',
                warehouseId: f.warehouseId,
                reason: 'lock-order',
                lines: [{ skuId: otherSku.skuId, quantity: 1, eventKey: randomUUID() }],
              },
              other,
            ),
          )
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error, cause: error instanceof Error ? error.cause : undefined }),
          );
        await waitForLocationBlock(tx, peer.pid, holder.pid);
        await wiringFor(tx).movement.moveImmediately({
          ...f.dto,
          lines: [{ ...f.dto.lines[0], fromLocationId: low, toLocationId: high }],
        });
      });
      expect(await arrival).toMatchObject({ value: { receipt: { totalQuantity: 1 } } });
      const state = await first.db.transaction((tx) => snapshot(tx, f));
      expect(state.ledgers.find((l) => l.locationId === high)?.qty).toBe(2);
      expect(state.events.filter((e) => e.transitionType === 'MOVE')).toHaveLength(1);
    } finally {
      await arrival;
      await cleanup(f);
    }
  });
});
