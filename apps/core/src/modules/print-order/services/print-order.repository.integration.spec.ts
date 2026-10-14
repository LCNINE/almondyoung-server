import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService } from '../../fulfillment/services/__support__';
import { PrintOrderRepository } from './print-order.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('PrintOrderRepository.claimDue (concurrent)', () => {
  type Db = ReturnType<typeof makeDb>;
  let seed: Db;
  let a: Db;
  let b: Db;
  const ids = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    const url = DATABASE_URL ?? '';
    seed = makeDb(url);
    a = makeDb(url);
    b = makeDb(url);
    await seed.db.insert(wmsTables.printOrders).values(
      ids.map((id, i) => ({
        id,
        salesOrderId: randomUUID(),
        salesOrderLineId: randomUUID(),
        almondDesignId: randomUUID(),
        status: 'pending' as const,
        nextAttemptAt: new Date('1970-01-01T00:00:00Z'),
        createdAt: new Date(Date.UTC(1970, 0, 1, 0, i)),
      })),
    );
  });

  afterAll(async () => {
    await seed.db.delete(wmsTables.printOrders).where(inArray(wmsTables.printOrders.id, ids));
    await Promise.all([seed.sql.end(), a.sql.end(), b.sql.end()]);
  });

  async function inRollback<T>(db: Db['db'], fn: (tx: DbTx) => Promise<T>, hold?: Promise<void>): Promise<T> {
    let value!: T;
    await db
      .transaction(async (tx) => {
        value = await fn(tx);
        await hold;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    return value;
  }

  it('never hands the same row to two overlapping claims', async () => {
    const repoA = new PrintOrderRepository(makeDbService(a.db));
    const repoB = new PrintOrderRepository(makeDbService(b.db));
    const now = new Date();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let claimedA!: () => void;
    const aClaimed = new Promise<void>((resolve) => {
      claimedA = resolve;
    });

    const runA = inRollback(
      a.db,
      async (tx) => {
        const rows = await repoA.claimDue(2, now, tx);
        claimedA();
        return rows;
      },
      hold,
    );
    await aClaimed;
    const rowsB = await inRollback(b.db, (tx) => repoB.claimDue(2, now, tx));
    release();
    const rowsA = await runA;

    const idsA = rowsA.map((r) => r.id);
    const idsB = rowsB.map((r) => r.id);
    expect(idsA).toEqual([ids[0], ids[1]]);
    expect(rowsA.every((r) => r.status === 'submitting' && r.submittingAt !== null)).toBe(true);
    expect(idsB).toContain(ids[2]);
    expect(idsB.filter((id) => idsA.includes(id))).toEqual([]);
  });
});

describeIfDb('PrintOrderRepository ownership writes', () => {
  it('matches the claimed submitting_at exactly and refuses a stale lease', async () => {
    const conn = makeDb(DATABASE_URL ?? '');
    const repo = new PrintOrderRepository(makeDbService(conn.db));
    const id = randomUUID();
    try {
      await conn.db
        .transaction(async (tx) => {
          await tx.insert(wmsTables.printOrders).values({
            id,
            salesOrderId: randomUUID(),
            salesOrderLineId: randomUUID(),
            almondDesignId: randomUUID(),
            nextAttemptAt: new Date('1970-01-01T00:00:00Z'),
            createdAt: new Date('1969-12-31T00:00:00Z'),
          });
          const [claimed] = await repo.claimDue(1, new Date(), tx);
          expect(claimed?.id).toBe(id);
          const claimedAt = claimed?.submittingAt ?? new Date(0);
          await expect(repo.updateOwned(id, new Date(claimedAt.getTime() - 1), { lastError: 'x' }, tx)).resolves.toBe(
            false,
          );
          await expect(repo.takeOrderRight(id, claimedAt, { testMemo: true }, tx)).resolves.toBe(true);
          await expect(repo.takeOrderRight(id, claimedAt, { testMemo: true }, tx)).resolves.toBe(false);
          await expect(repo.saveVendorOrderNumber(id, 'W-1', tx)).resolves.toBe(true);
          await expect(repo.saveVendorOrderNumber(id, 'W-2', tx)).resolves.toBe(false);
          await expect(repo.findVendorOrderNumber(id, tx)).resolves.toBe('W-1');
          const duplicate = 'duplicate wowpress order suspected: W-1 / W-2';
          const lastErrorOf = async () =>
            (
              await tx
                .select({ e: wmsTables.printOrders.lastError })
                .from(wmsTables.printOrders)
                .where(eq(wmsTables.printOrders.id, id))
            )[0]?.e;
          await repo.update(id, { lastError: duplicate }, tx);
          await repo.updateOwned(id, claimedAt, { lastError: 'upload down' }, tx);
          await expect(lastErrorOf()).resolves.toBe(duplicate);
          await repo.update(id, { lastError: 'order sent, ordnum W-3 not saved — verify on WowPress' }, tx);
          await expect(lastErrorOf()).resolves.toBe(
            `${duplicate} | order sent, ordnum W-3 not saved — verify on WowPress`,
          );
          await repo.update(id, { lastError: null }, tx);
          await expect(lastErrorOf()).resolves.toBe(
            `${duplicate} | order sent, ordnum W-3 not saved — verify on WowPress`,
          );
          await expect(repo.updateOwned(id, claimedAt, { status: 'submitted' }, tx)).resolves.toBe(true);
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await conn.sql.end();
    }
  });
});

describeIfDb('PrintOrderRepository cancellation writes', () => {
  it('never hands a cancelled row to the submit worker, and loses the race to a claim', async () => {
    const conn = makeDb(DATABASE_URL ?? '');
    const repo = new PrintOrderRepository(makeDbService(conn.db));
    const cancelledId = randomUUID();
    const claimedId = randomUUID();
    const base = () => ({
      salesOrderId: randomUUID(),
      salesOrderLineId: randomUUID(),
      almondDesignId: randomUUID(),
      nextAttemptAt: new Date('1970-01-01T00:00:00Z'),
    });
    try {
      await conn.db
        .transaction(async (tx) => {
          await tx.insert(wmsTables.printOrders).values([
            { id: cancelledId, ...base(), createdAt: new Date('1969-12-30T00:00:00Z') },
            { id: claimedId, ...base(), createdAt: new Date('1969-12-30T00:01:00Z') },
          ]);
          const read = async (id: string) => {
            const row = await repo.findById(id, tx);
            if (!row) throw new Error(`missing ${id}`);
            return row;
          };
          const pendingSnapshot = await read(cancelledId);
          await expect(repo.compareAndSet(pendingSnapshot, { status: 'cancelled' }, tx)).resolves.toBe(true);
          await expect(repo.compareAndSet(pendingSnapshot, { status: 'cancel_refused' }, tx)).resolves.toBe(false);

          const staleSnapshot = await read(claimedId);
          const claimed = await repo.claimDue(5, new Date(), tx);
          const claimedIds = claimed.map((r) => r.id);
          expect(claimedIds).not.toContain(cancelledId);
          expect(claimedIds).toContain(claimedId);
          await expect(repo.compareAndSet(staleSnapshot, { status: 'cancelled' }, tx)).resolves.toBe(false);
          await expect(read(claimedId)).resolves.toMatchObject({ status: 'submitting' });
          await expect(read(cancelledId)).resolves.toMatchObject({ status: 'cancelled' });

          await expect(repo.updateTracked(cancelledId, { status: 'shipped', trackingNumber: '1' }, tx)).resolves.toBe(
            false,
          );
          await repo.touch(cancelledId, tx);
          await expect(read(cancelledId)).resolves.toMatchObject({ status: 'cancelled', trackingNumber: null });

          const submitted = await read(claimedId);
          await expect(
            repo.compareAndSet(submitted, { status: 'cancelling', vendorOrderNumber: null }, tx),
          ).resolves.toBe(true);
          const cancelling = await read(claimedId);
          await expect(repo.reclaimCancelling(cancelling, tx)).resolves.toBe(true);
          await expect(repo.reclaimCancelling(cancelling, tx)).resolves.toBe(false);

          const duplicate = 'duplicate wowpress order suspected: W-1 / W-2';
          await repo.recordFailure(claimedId, duplicate, tx);
          await expect(read(claimedId)).resolves.toMatchObject({ status: 'cancelling', lastError: duplicate });
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await conn.sql.end();
    }
  });
});

describeIfDb('PrintOrderRepository protected records (operator actions)', () => {
  it('refuses the order right and the retry reset on a protected row, and drops a stale operator resolution on new evidence', async () => {
    const conn = makeDb(DATABASE_URL ?? '');
    const repo = new PrintOrderRepository(makeDbService(conn.db));
    const unsaved = 'order sent, ordnum W-7 not saved — verify on WowPress';
    try {
      await conn.db
        .transaction(async (tx) => {
          const base = {
            salesOrderId: randomUUID(),
            almondDesignId: randomUUID(),
            nextAttemptAt: new Date('1970-01-01T00:00:00Z'),
          };
          const claimedAt = new Date();
          const [submitting] = await tx
            .insert(wmsTables.printOrders)
            .values({
              ...base,
              salesOrderLineId: randomUUID(),
              status: 'submitting',
              submittingAt: claimedAt,
              lastError: unsaved,
            })
            .returning();
          await expect(repo.takeOrderRight(submitting?.id ?? '', claimedAt, {}, tx)).resolves.toBe(false);

          const [failed] = await tx
            .insert(wmsTables.printOrders)
            .values({ ...base, salesOrderLineId: randomUUID(), status: 'failed', orderAttemptedAt: new Date() })
            .returning();
          if (!failed) throw new Error('seed failed');
          await repo.recordFailure(failed.id, unsaved, tx);
          await expect(
            repo.compareAndSetUnprotected(failed, { status: 'pending', orderAttemptedAt: null }, tx),
          ).resolves.toBe(false);
          await expect(repo.findById(failed.id, tx)).resolves.toMatchObject({ status: 'failed', lastError: unsaved });

          const [resolved] = await tx
            .insert(wmsTables.printOrders)
            .values({
              ...base,
              salesOrderLineId: randomUUID(),
              status: 'cancelled',
              lastError: unsaved,
              cancelResolvedAt: new Date(),
              cancelResolvedBy: randomUUID(),
            })
            .returning();
          if (!resolved) throw new Error('seed failed');
          await repo.recordFailure(resolved.id, unsaved, tx);
          await expect(repo.findById(resolved.id, tx)).resolves.toMatchObject({ status: 'cancelled' });
          expect((await repo.findById(resolved.id, tx))?.cancelResolvedAt).not.toBeNull();
          const duplicate = 'duplicate wowpress order suspected: W-7 / W-8';
          await repo.recordFailure(resolved.id, duplicate, tx);
          // 다른 와우프레스 주문이 살아 있을 수 있다는 새 증거다. 운영자 마무리를 지우고 보드(취소 확인 필요)로 다시 연다
          await expect(repo.findById(resolved.id, tx)).resolves.toMatchObject({
            status: 'cancel_refused',
            cancelResolvedAt: null,
            cancelResolvedBy: null,
          });
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await conn.sql.end();
    }
  });
});
