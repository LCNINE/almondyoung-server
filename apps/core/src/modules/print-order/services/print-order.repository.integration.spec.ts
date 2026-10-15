import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService } from '../../fulfillment/services/__support__';
import { PrintOrderRepository, SHIPPED_TRACKING_WINDOW_MS } from './print-order.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

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
          const [claimed] = await repo.claimDueBatch(new Date(), tx);
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
          const claimed = await repo.claimDueBatch(new Date(), tx);
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

describeIfDb('PrintOrderRepository.claimDueBatch', () => {
  const past = new Date('1970-01-01T00:00:00Z');
  const rowOf = (
    salesOrderId: string,
    createdAt: Date,
    extra: Partial<typeof wmsTables.printOrders.$inferInsert> = {},
  ) => ({
    id: randomUUID(),
    salesOrderId,
    salesOrderLineId: randomUUID(),
    almondDesignId: randomUUID(),
    nextAttemptAt: past,
    createdAt,
    ...extra,
  });

  async function inRollbackConn(fn: (tx: DbTx, repo: PrintOrderRepository) => Promise<void>) {
    const conn = makeDb(DATABASE_URL ?? '');
    const repo = new PrintOrderRepository(makeDbService(conn.db));
    try {
      await conn.db
        .transaction(async (tx) => {
          await fn(tx, repo);
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
    } finally {
      await conn.sql.end();
    }
  }

  it('claimDueBatch claims all due pending rows of the oldest due sales order only', async () => {
    await inRollbackConn(async (tx, repo) => {
      const a = randomUUID();
      const b = randomUUID();
      const rows = [
        rowOf(a, new Date('1960-01-01T00:00:00Z')),
        rowOf(a, new Date('1960-01-01T00:01:00Z')),
        rowOf(b, new Date('1960-01-01T00:02:00Z')),
      ];
      await tx.insert(wmsTables.printOrders).values(rows);

      const now = new Date();
      const claimed = await repo.claimDueBatch(now, tx);

      expect(claimed.map((r) => r.id).sort()).toEqual([rows[0].id, rows[1].id].sort());
      expect(claimed.every((r) => r.salesOrderId === a && r.status === 'submitting')).toBe(true);
      expect(new Set(claimed.map((r) => r.submittingAt?.getTime())).size).toBe(1);
      expect(claimed[0].submittingAt?.getTime()).toBe(now.getTime());

      const [other] = await tx.select().from(wmsTables.printOrders).where(eq(wmsTables.printOrders.id, rows[2].id));
      expect(other.status).toBe('pending');
    });
  });

  it('claimDueBatch skips rows locked by another transaction', async () => {
    const seed = makeDb(DATABASE_URL ?? '');
    const holder = makeDb(DATABASE_URL ?? '');
    const a = randomUUID();
    const rows = [rowOf(a, new Date('1950-01-01T00:00:00Z')), rowOf(a, new Date('1950-01-01T00:01:00Z'))];
    await seed.db.insert(wmsTables.printOrders).values(rows);

    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const holding = holder.db
      .transaction(async (tx) => {
        await tx
          .select({ id: wmsTables.printOrders.id })
          .from(wmsTables.printOrders)
          .where(eq(wmsTables.printOrders.id, rows[0].id))
          .for('update');
        locked();
        await hold;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    try {
      await isLocked;
      await inRollbackConn(async (tx, repo) => {
        const claimed = await repo.claimDueBatch(new Date(), tx);

        expect(claimed.map((r) => r.id)).toEqual([rows[1].id]);
      });
    } finally {
      release();
      await holding;
      await seed.db.delete(wmsTables.printOrders).where(
        inArray(
          wmsTables.printOrders.id,
          rows.map((r) => r.id),
        ),
      );
      await Promise.all([seed.sql.end(), holder.sql.end()]);
    }
  });

  it('claimDueBatch returns nothing while another connection holds the sales order advisory lock', async () => {
    const seed = makeDb(DATABASE_URL ?? '');
    const holder = makeDb(DATABASE_URL ?? '');
    const a = randomUUID();
    const rows = [rowOf(a, new Date('1940-01-01T00:00:00Z')), rowOf(a, new Date('1940-01-01T00:01:00Z'))];
    await seed.db.insert(wmsTables.printOrders).values(rows);

    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });

    const holding = holder.db
      .transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('print-order-claim'), hashtext(${a}))`);
        locked();
        await hold;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    try {
      await isLocked;
      await inRollbackConn(async (tx, repo) => {
        await expect(repo.claimDueBatch(new Date(), tx)).resolves.toEqual([]);
      });

      const after = await seed.db
        .select({ status: wmsTables.printOrders.status })
        .from(wmsTables.printOrders)
        .where(
          inArray(
            wmsTables.printOrders.id,
            rows.map((r) => r.id),
          ),
        );

      expect(after.map((r) => r.status)).toEqual(['pending', 'pending']);
    } finally {
      release();
      await holding;
      await seed.db.delete(wmsTables.printOrders).where(
        inArray(
          wmsTables.printOrders.id,
          rows.map((r) => r.id),
        ),
      );
      await Promise.all([seed.sql.end(), holder.sql.end()]);
    }
  });

  it('claimDueBatch ignores rows whose next_attempt_at is in the future', async () => {
    await inRollbackConn(async (tx, repo) => {
      const a = randomUUID();
      const future = new Date(Date.now() + 3_600_000);
      const rows = [
        rowOf(a, new Date('1960-01-01T00:00:00Z'), { nextAttemptAt: future }),
        rowOf(a, new Date('1960-01-01T00:01:00Z')),
      ];
      await tx.insert(wmsTables.printOrders).values(rows);

      const claimed = await repo.claimDueBatch(new Date(), tx);

      expect(claimed.map((r) => r.id)).toEqual([rows[1].id]);
    });
  });

  it('saveVendorBox does not overwrite with null', async () => {
    await inRollbackConn(async (tx, repo) => {
      const row = rowOf(randomUUID(), new Date('1960-01-01T00:00:00Z'));
      await tx.insert(wmsTables.printOrders).values(row);

      await repo.saveVendorBox(row.id, { vendorBoxNumber: 'BOX-1', vendorShippingFee: 3000 }, tx);
      await repo.saveVendorBox(row.id, { vendorBoxNumber: null, vendorShippingFee: null }, tx);

      const found = await repo.findById(row.id, tx);

      expect(found).toMatchObject({ vendorBoxNumber: 'BOX-1', vendorShippingFee: 3000 });
    });
  });

  it('trackable stops polling shipped rows once the tracking window has passed', async () => {
    await inRollbackConn(async (tx, repo) => {
      const longAgo = new Date(Date.now() - SHIPPED_TRACKING_WINDOW_MS - 60_000);
      const rows = [
        rowOf(randomUUID(), new Date('1960-01-01T00:00:00Z'), { status: 'submitted', vendorOrderNumber: 'W-1' }),
        rowOf(randomUUID(), new Date('1960-01-01T00:00:00Z'), {
          status: 'shipped',
          vendorOrderNumber: 'W-2',
          shippedAt: new Date(),
        }),
        rowOf(randomUUID(), new Date('1960-01-01T00:00:00Z'), {
          status: 'shipped',
          vendorOrderNumber: 'W-3',
          shippedAt: longAgo,
        }),
      ];
      await tx.insert(wmsTables.printOrders).values(rows);

      const ids = (await repo.trackable(10_000, tx)).map((r) => r.id);

      expect(ids).toEqual(expect.arrayContaining([rows[0].id, rows[1].id]));
      expect(ids).not.toContain(rows[2].id);
    });
  });
});
