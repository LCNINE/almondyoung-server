/** 실행: `DATABASE_URL=…/core_sdd_1016 npx jest --runInBand --runTestsByPath libs/events/src/dead-letter/dead-letter.query.integration.spec.ts` */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { DeadLetterQueryService } from './dead-letter.query';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';
import { dead_letters } from './dead-letter.schema';
import { outbox_events } from '../outbox/outbox.schema';
import type { DeadLetterMessage } from './dead-letter.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Db = PostgresJsDatabase<Record<string, never>>;
/**
 * 이 스펙의 토픽. 롤백 트랜잭션 안이지만 이 토픽의 행만 지우고(WHERE 없는 DELETE 금지, CLAUDE.md) 목록은 토픽으로 좁혀 읽는다 —
 * 같은 DB 에 남은 다른 행이 단언을 흔들지 않게.
 */
const TOPIC = 'dead-letter-query-spec.orders.v1';
/** 순서를 지키지 않는 토픽 — `sequencedTopics` 에 넣지 않는다 */
const UNSEQUENCED_TOPIC = 'dead-letter-query-spec.stock.v1';
const OUTBOX_TOPIC = 'dead-letter-query-spec.outbox.v1';

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
        await tx.delete(dead_letters).where(inArray(dead_letters.topic, [TOPIC, UNSEQUENCED_TOPIC]));
        await tx.delete(outbox_events).where(inArray(outbox_events.topic, [OUTBOX_TOPIC]));
        const dbService = { db: tx } as never;
        await run({
          tx: tx as never,
          store: new DeadLetterStore(dbService),
          query: new DeadLetterQueryService(dbService, new FailureActionLog(dbService), {
            sequencedTopics: [TOPIC],
          }),
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
    topic: TOPIC,
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
      const page = await query.listSequences(undefined, undefined, TOPIC);
      expect(page.items.map((i) => [i.sequenceKey, i.heldBehind])).toEqual([
        ['order-A', 2],
        [null, 0],
      ]);
    });
  });

  it('요약은 failed·held 수와 가장 오래된 시각, outbox FAILED 수', async () => {
    await inRollbackTx(async ({ tx, store, query }) => {
      // 요약은 전체를 센다 — 같은 DB 에 남은 다른 행이 있어도 맞게, 더한 만큼 늘었는지 본다
      const before = await query.summary();
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      await tx.insert(outbox_events).values({
        topic: OUTBOX_TOPIC,
        aggregateType: 'X',
        aggregateId: 'x',
        eventType: 'E',
        payload: {},
        status: 'FAILED',
        failedAt: new Date(),
      });
      const summary = await query.summary();
      expect(summary.deadLetters.failed - before.deadLetters.failed).toBe(1);
      expect(summary.deadLetters.held - before.deadLetters.held).toBe(1);
      expect(summary.deadLetters.oldestFailedAt).not.toBeNull();
      expect(summary.outbox.failed - before.outbox.failed).toBe(1);
      expect(summary.outbox.oldestFailedAt).not.toBeNull();
    });
  });

  it('상세는 같은 순서의 행 전부를 id 순으로', async () => {
    await inRollbackTx(async ({ store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.holdIfBlocked(msg('a2', 'order-A'));
      const { items } = await query.listSequences(undefined, undefined, TOPIC);
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
      const page = await query.listSequences(undefined, undefined, TOPIC);
      expect(page.items.map((i) => [i.sequenceKey, i.heldBehind])).toEqual([
        ['order-A', 3],
        ['order-B', 1],
      ]);
    });
  });

  it('순서를 지키지 않는 토픽의 행은 같은 키라도 각자 머리이고 뒤 수가 0 이다', async () => {
    await inRollbackTx(async ({ store, query }) => {
      const unsequenced = (id: string) => ({ ...msg(id, 'variant-1'), topic: UNSEQUENCED_TOPIC });
      await store.recordFailure(unsequenced('s1'), new Error('x'));
      await store.recordFailure(unsequenced('s2'), new Error('x'));
      const page = await query.listSequences(undefined, undefined, UNSEQUENCED_TOPIC);
      expect(page.items.map((i) => [i.topic, i.sequenceKey, i.heldBehind])).toEqual([
        [UNSEQUENCED_TOPIC, 'variant-1', 0],
        [UNSEQUENCED_TOPIC, 'variant-1', 0],
      ]);
      const detail = await query.detail(page.items[0].id);
      expect(detail.sequence.map((r) => r.messageId)).toEqual(['s1']);
    });
  });

  it('토픽으로 거르면 그 토픽의 순서만 나온다 — 커서도 그 안에서 넘어간다(스펙 §9 `GET dead-letters?topic&cursor`)', async () => {
    await inRollbackTx(async ({ store, query }) => {
      await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
      await store.recordFailure({ ...msg('s1', 'variant-1'), topic: UNSEQUENCED_TOPIC }, new Error('x'));
      await store.recordFailure(msg('b1', 'order-B'), new Error('x'));

      const first = await query.listSequences('1', undefined, TOPIC);
      expect(first.items.map((i) => i.sequenceKey)).toEqual(['order-A']);
      expect(first.nextCursor).not.toBeNull();
      const second = await query.listSequences('1', String(first.nextCursor), TOPIC);
      expect(second.items.map((i) => i.sequenceKey)).toEqual(['order-B']);
      expect(second.nextCursor).toBeNull();

      const other = await query.listSequences(undefined, undefined, UNSEQUENCED_TOPIC);
      expect(other.items.map((i) => [i.topic, i.sequenceKey])).toEqual([[UNSEQUENCED_TOPIC, 'variant-1']]);
    });
  });
});
