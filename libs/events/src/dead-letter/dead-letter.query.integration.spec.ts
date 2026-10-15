/** 실행: `DATABASE_URL=…/core_sdd_1016 npx jest --runInBand --runTestsByPath libs/events/src/dead-letter/dead-letter.query.integration.spec.ts` */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DeadLetterQueryService } from './dead-letter.query';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';
import { dead_letters } from './dead-letter.schema';
import { outbox_events } from '../outbox/outbox.schema';
import type { DeadLetterMessage } from './dead-letter.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Db = PostgresJsDatabase<Record<string, never>>;

/** 롤백용 — 트랜잭션을 되돌리려고 일부러 던진다. */
class RollbackSentinel extends Error {}

describeIfDb('DeadLetterQueryService (PostgreSQL 통합)', () => {
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

  async function inRollbackTx(
    run: (ctx: { tx: Db; store: DeadLetterStore; query: DeadLetterQueryService }) => Promise<void>,
  ) {
    const sentinel = new RollbackSentinel();
    try {
      await db.transaction(async (tx) => {
        await tx.delete(dead_letters);
        await tx.delete(outbox_events);
        const dbService = { db: tx } as never;
        await run({
          tx: tx as never,
          store: new DeadLetterStore(dbService),
          query: new DeadLetterQueryService(dbService, new FailureActionLog(dbService)),
        });
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  const msg = (messageId: string, key: string | null): DeadLetterMessage => ({
    consumerGroup: 'g',
    handler: 'C.on',
    topic: 'orders.events.v1',
    sequenceKey: key,
    messageId,
    eventType: 'OrderCreated',
    envelope: { messageId },
    kafkaPartition: 0,
    kafkaOffset: '0',
  });

  it('순서마다 머리 한 행과 뒤 held 수, 키 없는 행은 각자', async () => {
    await inRollbackTx(async ({ store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      await store.holdIfBlocked(msg('a3', 'order-A'));
      await store.recordFailure(msg('n1', null), new Error('y'));
      const page = await query.listSequences();
      expect(page.items.map((i) => [i.sequenceKey, i.heldBehind])).toEqual([
        ['order-A', 2],
        [null, 0],
      ]);
    });
  });

  it('요약은 failed·held 수와 가장 오래된 시각, outbox FAILED 수', async () => {
    await inRollbackTx(async ({ tx, store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      await tx.insert(outbox_events).values({
        topic: 't',
        aggregateType: 'X',
        aggregateId: 'x',
        eventType: 'E',
        payload: {},
        status: 'FAILED',
        failedAt: new Date(),
      });
      const summary = await query.summary();
      expect(summary.deadLetters).toMatchObject({ failed: 1, held: 1 });
      expect(summary.deadLetters.oldestFailedAt).not.toBeNull();
      expect(summary.outbox.failed).toBe(1);
    });
  });

  it('상세는 같은 순서의 행 전부를 id 순으로', async () => {
    await inRollbackTx(async ({ store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      const { items } = await query.listSequences();
      const detail = await query.detail(items[0].id);
      expect(detail.sequence.map((r) => r.messageId)).toEqual(['a1', 'a2']);
    });
  });

  it('heldBehind 는 자기 순서의 뒤만 센다 — 순서마다 다른 값', async () => {
    await inRollbackTx(async ({ store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      await store.holdIfBlocked(msg('a3', 'order-A'));
      await store.holdIfBlocked(msg('a4', 'order-A'));
      await store.recordFailure(msg('b1', 'order-B'), new Error('y'));
      await store.holdIfBlocked(msg('b2', 'order-B'));
      const page = await query.listSequences();
      expect(page.items.map((i) => [i.sequenceKey, i.heldBehind])).toEqual([
        ['order-A', 3],
        ['order-B', 1],
      ]);
    });
  });
});
