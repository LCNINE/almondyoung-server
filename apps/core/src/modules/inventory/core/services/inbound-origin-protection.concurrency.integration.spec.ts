import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { acquireStockAvailabilityLocks } from '../../shared/locks/stock-availability-lock';
import {
  Database,
  buildWiring,
  makeInboundReceiptKernel,
  makeMovementService,
} from '../../inbound/services/__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describeIfDb('Inbound origin stock concurrency (independent PostgreSQL connections)', () => {
  jest.setTimeout(20_000);
  it.each([
    ['move', 'putaway'],
    ['putaway', 'move'],
    ['move', 'arrival'],
    ['arrival', 'move'],
    ['cancel', 'reverse'],
    ['reverse', 'cancel'],
  ] as const)('%s then %s serializes without consuming pending stock', async (first, second) => {
    const observer = postgres(DATABASE_URL as string, { max: 1 });
    const workerA = postgres(DATABASE_URL as string, { max: 1 });
    const workerB = postgres(DATABASE_URL as string, { max: 1 });
    const db = drizzle(observer, { schema: wmsSchema });
    const dbA = drizzle(workerA, { schema: wmsSchema });
    const dbB = drizzle(workerB, { schema: wmsSchema });
    const ready = deferred();
    const release = deferred();
    let a: Promise<unknown> | undefined;
    let b: Promise<unknown> | undefined;
    let fixture:
      | {
          warehouseId: string;
          holderId: string;
          skuId: string;
          origin: string;
          shelfId: string;
          lineId: string;
          eventId: string;
        }
      | undefined;
    try {
      fixture = await db.transaction(async (tx) => {
        const [warehouse] = await tx
          .insert(wmsTables.warehouses)
          .values({ name: `race-${randomUUID()}` })
          .returning();
        const [holder] = await tx
          .insert(wmsTables.holders)
          .values({ name: `race-${randomUUID()}` })
          .returning();
        const [sku] = await tx
          .insert(wmsTables.skus)
          .values({ name: 'race', code: randomUUID(), holderId: holder.id })
          .returning();
        const [shelf] = await tx
          .insert(wmsTables.locations)
          .values({ warehouseId: warehouse.id, code: 'SHELF', locationType: 'zone' })
          .returning();
        const arrival = await makeInboundReceiptKernel(db).recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId: warehouse.id,
            reason: 'race',
            lines: [{ skuId: sku.id, quantity: 10, eventKey: randomUUID() }],
          },
          tx,
        );
        return {
          warehouseId: warehouse.id,
          holderId: holder.id,
          skuId: sku.id,
          origin: arrival.lines[0].originLocationId!,
          shelfId: shelf.id,
          lineId: arrival.lines[0].id,
          eventId: arrival.lines[0].eventId!,
        };
      });
      const f = fixture;
      const [{ pid: pidA }] = await workerA<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      const [{ pid: pidB }] = await workerB<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      const run = async (action: typeof first | typeof second, tx: DbTx, database: Database) => {
        const kernel = makeInboundReceiptKernel(database);
        if (action === 'move') {
          await expect(
            makeMovementService(tx as unknown as Database).moveImmediately({
              warehouseId: f.warehouseId,
              idempotencyKey: randomUUID(),
              lines: [{ skuId: f.skuId, fromLocationId: f.origin, toLocationId: f.shelfId, quantity: 1 }],
            }),
          ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
        } else if (action === 'putaway') {
          await kernel.putaway(
            { receiptLineId: f.lineId, toLocationId: f.shelfId, quantity: 6, eventKey: randomUUID() },
            tx,
          );
        } else if (action === 'arrival') {
          await kernel.recordArrival(
            {
              source: 'purchase_order',
              warehouseId: f.warehouseId,
              reason: 'concurrent arrival',
              lines: [{ skuId: f.skuId, quantity: 1, eventKey: randomUUID() }],
            },
            tx,
          );
        } else if (action === 'cancel') {
          await kernel.cancelLine({ receiptLineId: f.lineId, expected: { source: 'direct' } }, tx);
        } else {
          await expect(
            tx.transaction((sp) => buildWiring(database).eventStore.reverseEvent(f.eventId, 'general reversal', sp)),
          ).rejects.toMatchObject({
            response: { code: first === 'cancel' ? 'STOCK_EVENT_ALREADY_REVERSED' : 'INBOUND_ORIGIN_STOCK_PROTECTED' },
          });
        }
      };
      a = dbA.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
        // Retain the first rejected operation's coordination lock after its savepoint rolls back.
        if (first === 'move') await acquireStockAvailabilityLocks(tx, [{ skuId: f.skuId, warehouseId: f.warehouseId }]);
        if (first === 'reverse') {
          await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.id, f.eventId)).for('update');
          // Pause before reverseEvent's stock lock. Cancellation must wait on this
          // event without holding stock, or resuming reversal creates a deadlock.
          ready.resolve();
          await release.promise;
          await run(first, tx, dbA);
        } else {
          await run(first, tx, dbA);
          ready.resolve();
          await release.promise;
        }
      });
      // Attach rejection handling immediately so a failed worker cannot become unhandled while waiting.
      const outcomeA = a.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await Promise.race([
        ready.promise,
        outcomeA.then((outcome) => {
          if (!outcome.ok) throw outcome.error;
          throw new Error('first worker missed barrier');
        }),
      ]);
      let completedB = false;
      b = dbB.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
        await run(second, tx, dbB);
      });
      const outcomeB = b.then(
        () => {
          completedB = true;
          return { ok: true as const };
        },
        (error: unknown) => {
          completedB = true;
          return { ok: false as const, error };
        },
      );
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const [{ waiting }] = await observer<
          { waiting: boolean }[]
        >`SELECT ${pidA}::int = ANY(pg_blocking_pids(${pidB}::int)) AS waiting`;
        if (waiting) {
          blocked = true;
          break;
        }
        if (completedB) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(completedB).toBe(false);
      release.resolve();
      const outcomes = await Promise.all([outcomeA, outcomeB]);
      for (const outcome of outcomes) if (!outcome.ok) throw outcome.error;

      const kind =
        first === 'cancel' || first === 'reverse'
          ? 'cancel'
          : first === 'arrival' || second === 'arrival'
            ? 'arrival'
            : 'putaway';
      const [line] = await db
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      const logs = await db
        .select()
        .from(wmsTables.inboundWorkLogs)
        .where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouseId));
      const events = await db.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
      const ledger = await db.select().from(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      expect(line).toMatchObject({
        putawayFromOriginQty: kind === 'putaway' ? 6 : 0,
        canceledQty: kind === 'cancel' ? 10 : 0,
        returnedQty: 0,
      });
      expect(ledger.find((row) => row.locationId === f.origin)?.qty).toBe(
        kind === 'putaway' ? 4 : kind === 'arrival' ? 11 : 0,
      );
      expect(ledger.find((row) => row.locationId === f.shelfId)?.qty ?? 0).toBe(kind === 'putaway' ? 6 : 0);
      expect(events).toHaveLength(2);
      expect(logs.map((row) => row.type).sort()).toEqual(
        kind === 'putaway'
          ? ['INBOUND', 'PUTAWAY']
          : kind === 'arrival'
            ? ['INBOUND', 'INBOUND']
            : ['CANCEL', 'INBOUND'],
      );
      expect(
        await db.select().from(wmsTables.movementJobs).where(eq(wmsTables.movementJobs.warehouseId, f.warehouseId)),
      ).toHaveLength(0);
      const availability = await db.transaction((tx) =>
        buildWiring(db).guard.getAvailability(
          { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.origin },
          tx,
        ),
      );
      expect(availability.inboundPendingQty).toBe(kind === 'putaway' ? 4 : kind === 'arrival' ? 11 : 0);
    } finally {
      release.resolve();
      await Promise.allSettled([a, b].filter((p): p is Promise<unknown> => Boolean(p)));
      try {
        if (fixture) {
          const f = fixture;
          await db.transaction(async (tx) => {
            const receipts = await tx
              .select()
              .from(wmsTables.inboundReceipts)
              .where(eq(wmsTables.inboundReceipts.warehouseId, f.warehouseId));
            await tx.delete(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouseId));
            for (const receipt of receipts)
              await tx
                .delete(wmsTables.inboundReceiptLines)
                .where(eq(wmsTables.inboundReceiptLines.receiptId, receipt.id));
            await tx.delete(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.warehouseId, f.warehouseId));
            await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
            await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
            for (const receipt of receipts)
              if (receipt.journalId)
                await tx.delete(wmsTables.stockJournals).where(eq(wmsTables.stockJournals.id, receipt.journalId));
            await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, f.warehouseId));
            await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuId));
            await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, f.holderId));
            await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, f.warehouseId));
          });
        }
      } finally {
        await Promise.all([workerA.end(), workerB.end(), observer.end()]);
      }
    }
  });
});
