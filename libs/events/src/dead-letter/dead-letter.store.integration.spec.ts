/**
 * DeadLetterStore — 실제 Postgres (#1016 8번, 스펙 §6.2·§6.3)
 * 실행: DATABASE_URL=… npx jest --runInBand --runTestsByPath libs/events/src/dead-letter/dead-letter.store.integration.spec.ts
 */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DeadLetterStore } from './dead-letter.store';
import { dead_letters } from './dead-letter.schema';
import type { DeadLetterMessage } from './dead-letter.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Db = PostgresJsDatabase<Record<string, never>>;

describeIfDb('DeadLetterStore (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: Db;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client);
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollbackTx(run: (store: DeadLetterStore, tx: Db) => Promise<void>) {
    const sentinel = Symbol('rollback');
    try {
      await db.transaction(async (tx) => {
        await tx.delete(dead_letters);
        await run(new DeadLetterStore({ db: tx } as never), tx as never);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  const message = (
    messageId: string,
    sequenceKey: string | null = 'order-A',
    handler = 'C.onCreated',
  ): DeadLetterMessage => ({
    consumerGroup: 'spec-group',
    handler,
    topic: 'orders.events.v1',
    sequenceKey,
    messageId,
    eventType: 'OrderCreated',
    envelope: { messageId },
    kafkaPartition: 0,
    kafkaOffset: '7',
  });

  it('안 푼 행이 없으면 보류하지 않는다', async () => {
    await inRollbackTx(async (store) => {
      expect(await store.holdIfBlocked(message('m1'))).toBe(false);
    });
  });

  it('최종 실패를 failed 로 적고, 같은 순서의 다음 메시지는 held 로 적는다', async () => {
    await inRollbackTx(async (store, tx) => {
      await store.recordFailure(message('m1'), new Error('boom'));
      expect(await store.holdIfBlocked(message('m2'))).toBe(true);

      const rows = await tx.select().from(dead_letters).orderBy(dead_letters.id);
      expect(rows.map((r) => [r.messageId, r.status])).toEqual([
        ['m1', 'failed'],
        ['m2', 'held'],
      ]);
      expect(rows[0].errorMessage).toBe('boom');
    });
  });

  it('다른 순서 키·다른 토픽은 막지 않는다', async () => {
    await inRollbackTx(async (store) => {
      await store.recordFailure(message('m1'), new Error('boom'));
      expect(await store.holdIfBlocked(message('m2', 'order-B'))).toBe(false);
      expect(await store.holdIfBlocked({ ...message('m3'), topic: 'other.v1' })).toBe(false);
    });
  });

  it('재전달 — 이미 failed 인 메시지가 다시 와도 행이 늘지 않고 막혀 있다', async () => {
    await inRollbackTx(async (store, tx) => {
      await store.recordFailure(message('m1'), new Error('boom'));
      expect(await store.holdIfBlocked(message('m1'))).toBe(true);
      expect(await tx.select().from(dead_letters)).toHaveLength(1);
    });
  });

  it('같은 메시지의 최종 실패가 두 번 오면 한 행을 갱신한다', async () => {
    await inRollbackTx(async (store, tx) => {
      await store.recordFailure(message('m1'), new Error('first'));
      await store.recordFailure(message('m1'), new Error('second'));
      const rows = await tx.select().from(dead_letters);
      expect(rows).toHaveLength(1);
      expect(rows[0].errorMessage).toBe('second');
    });
  });

  it('순서 키가 없는 행은 아무것도 막지 않는다', async () => {
    await inRollbackTx(async (store) => {
      await store.recordFailure(message('m1', null), new Error('boom'));
      expect(await store.holdIfBlocked(message('m2', null))).toBe(false);
    });
  });

  it('markRedriven 은 redriven 으로, recordRedriveFailure 는 failed 로 바꾸고 횟수를 센다', async () => {
    await inRollbackTx(async (store, tx) => {
      await store.recordFailure(message('m1'), new Error('boom'));
      await store.holdIfBlocked(message('m2'));
      const [first, second] = await tx.select().from(dead_letters).orderBy(dead_letters.id);

      await store.markRedriven(first.id);
      await store.recordRedriveFailure(second.id, new Error('again'));

      const [a] = await tx.select().from(dead_letters).where(eq(dead_letters.id, first.id));
      const [b] = await tx.select().from(dead_letters).where(eq(dead_letters.id, second.id));
      expect([a.status, a.redriveCount, a.resolvedAt !== null]).toEqual(['redriven', 1, true]);
      expect([b.status, b.redriveCount, b.errorMessage]).toEqual(['failed', 1, 'again']);
    });
  });
});
