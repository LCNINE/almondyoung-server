/**
 * 실행: `npm run test:core:integration:local -- dead-letter.redriver`
 * 이 스위트는 커밋한다 — 토픽 `redriver-spec.v1`·`redriver-spec-unsequenced.v1` 행만 쓰고 지운다(WHERE 없는 DELETE 금지, CLAUDE.md).
 */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import type { Server } from '@nestjs/microservices';
import { DeadLetterRedriver } from './dead-letter.redriver';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';
import { dead_letters, failure_actions } from './dead-letter.schema';
import { DEAD_LETTER_HEADERS, type DeadLetterMessage } from './dead-letter.types';
import { tryLockSequence } from './sequence-lock';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const TOPIC = 'redriver-spec.v1';
/** 순서를 지키지 않는 토픽 — `sequencedTopics` 에 넣지 않는다 */
const UNSEQUENCED_TOPIC = 'redriver-spec-unsequenced.v1';
const TOPICS = [TOPIC, UNSEQUENCED_TOPIC];
const GROUP = 'redriver-spec-group';

describeIfDb('DeadLetterRedriver (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<Record<string, never>>;
  let store: DeadLetterStore;
  let redriver: DeadLetterRedriver;
  /** 다시 넣은 messageId 순서 */
  let dispatched: string[];
  /** 이 messageId 를 다시 넣으면 실패한다 */
  let failOn: Set<string>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 4 });
    db = drizzle(client);
  });
  afterAll(async () => {
    await client.end();
  });

  beforeEach(() => {
    dispatched = [];
    failOn = new Set();
    const dbService = { db } as never;
    store = new DeadLetterStore(dbService);
    const runtime = new DeadLetterRuntime();
    const server = {
      getHandlerByPattern: (topic: string) =>
        TOPICS.includes(topic)
          ? async (data: { messageId: string }, context: { getMessage(): { headers: Record<string, Buffer> } }) => {
              const id = Number(context.getMessage().headers[DEAD_LETTER_HEADERS.id].toString());
              dispatched.push(data.messageId);
              if (failOn.has(data.messageId)) await store.recordRedriveFailure(id, new Error(`fail ${data.messageId}`));
              else await store.markRedriven(id);
            }
          : null,
    } as unknown as Server;
    runtime.attach({ consumerGroup: GROUP, server });
    redriver = new DeadLetterRedriver(dbService, runtime, new FailureActionLog(dbService), {
      sequencedTopics: [TOPIC],
    });
  });

  afterEach(async () => {
    const ids = (
      await db.select({ id: dead_letters.id }).from(dead_letters).where(inArray(dead_letters.topic, TOPICS))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db
        .delete(failure_actions)
        .where(and(eq(failure_actions.targetKind, 'dead_letter'), inArray(failure_actions.targetId, ids)));
    }
    await db.delete(dead_letters).where(inArray(dead_letters.topic, TOPICS));
  });

  const msg = (messageId: string, key = 'order-A'): DeadLetterMessage => ({
    consumerGroup: GROUP,
    handler: 'C.on',
    topic: TOPIC,
    sequenceKey: key,
    messageId,
    eventType: 'E',
    envelope: { messageId },
    kafkaPartition: 0,
    kafkaOffset: '0',
  });

  async function seed(...messageIds: string[]): Promise<number[]> {
    await store.recordFailure(msg(messageIds[0]), new Error('boom'));
    for (const id of messageIds.slice(1)) await store.holdIfBlocked(msg(id));
    const rows = await db.select().from(dead_letters).where(eq(dead_letters.topic, TOPIC)).orderBy(dead_letters.id);
    return rows.map((r) => r.id);
  }

  const statuses = async (topic = TOPIC) =>
    (await db.select().from(dead_letters).where(eq(dead_letters.topic, topic)).orderBy(dead_letters.id)).map(
      (r) => `${r.messageId}:${r.status}`,
    );

  it('순서를 처음부터 차례로 다시 넣는다 — 중간 행에서 눌러도', async () => {
    const [, second] = await seed('m1', 'm2', 'm3');
    const result = await redriver.redrive(second, 'admin-1');
    expect(dispatched).toEqual(['m1', 'm2', 'm3']);
    expect(result).toEqual({ processed: 3, stoppedAt: null });
    expect(await statuses()).toEqual(['m1:redriven', 'm2:redriven', 'm3:redriven']);
  });

  it('하나라도 실패하면 거기서 멈추고 그 행이 새 머리가 된다', async () => {
    const [first] = await seed('m1', 'm2', 'm3');
    failOn.add('m2');
    const result = await redriver.redrive(first, 'admin-1');
    expect(dispatched).toEqual(['m1', 'm2']);
    expect(result.processed).toBe(1);
    expect(result.stoppedAt?.errorMessage).toBe('fail m2');
    expect(await statuses()).toEqual(['m1:redriven', 'm2:failed', 'm3:held']);
  });

  it('머리를 종결하면 뒤에 보류된 것을 이어서 다시 넣는다', async () => {
    const [first] = await seed('m1', 'm2');
    const result = await redriver.discard(first, 'admin-1', '낡은 이벤트');
    expect(dispatched).toEqual(['m2']);
    expect(result.processed).toBe(1);
    expect(await statuses()).toEqual(['m1:discarded', 'm2:redriven']);
  });

  it('머리가 아닌 held 를 종결하면 아무것도 흐르지 않는다', async () => {
    const [, second] = await seed('m1', 'm2', 'm3');
    const result = await redriver.discard(second, 'admin-1', '건너뛴다');
    expect(dispatched).toEqual([]);
    expect(result).toEqual({ processed: 0, stoppedAt: null });
    expect(await statuses()).toEqual(['m1:failed', 'm2:discarded', 'm3:held']);
  });

  it('종결 사유가 비면 거부한다', async () => {
    const [first] = await seed('m1');
    await expect(redriver.discard(first, 'admin-1', '   ')).rejects.toThrow(/사유/);
  });

  it('같은 순서를 누가 다시 넣는 중이면 409', async () => {
    const [first] = await seed('m1');
    await db.transaction(async (tx) => {
      expect(await tryLockSequence(tx, { consumerGroup: GROUP, topic: TOPIC, sequenceKey: 'order-A' })).toBe(true);
      await expect(redriver.redrive(first, 'admin-1')).rejects.toThrow(/진행 중/);
    });
  });

  it('조치를 failure_actions 에 남긴다 — 다시 넣기 성공·실패, 종결 사유', async () => {
    const [first] = await seed('m1', 'm2');
    failOn.add('m2');
    await redriver.redrive(first, 'admin-1');
    const actions = await db
      .select()
      .from(failure_actions)
      .where(eq(failure_actions.targetKind, 'dead_letter'))
      .orderBy(failure_actions.id);
    const mine = actions.filter((a) => a.actor === 'admin-1').map((a) => `${a.action}:${a.outcome}`);
    expect(mine.slice(-2)).toEqual(['redrive:succeeded', 'redrive:failed']);
  });

  it('전체 다시 넣기는 순서마다 돌리고 요약한다', async () => {
    await store.recordFailure(msg('a1', 'order-A'), new Error('x'));
    await store.recordFailure(msg('b1', 'order-B'), new Error('x'));
    failOn.add('b1');
    const result = await redriver.redriveAll('admin-1');
    expect(result).toMatchObject({ sequences: 2, succeeded: 1, stopped: 1, busy: 0 });
    expect(result.stoppedByError).toEqual({ Error: 1 });
  });

  it('순서를 지키지 않는 토픽의 행은 혼자 한 순서다 — 같은 키의 다른 실패를 끌고 가지 않는다', async () => {
    // 실시간 소비가 이 토픽에서 보류하지 않으므로 같은 키라도 둘 다 failed 다
    await store.recordFailure({ ...msg('u1'), topic: UNSEQUENCED_TOPIC }, new Error('x'));
    await store.recordFailure({ ...msg('u2'), topic: UNSEQUENCED_TOPIC }, new Error('x'));
    const [first] = await db
      .select()
      .from(dead_letters)
      .where(eq(dead_letters.topic, UNSEQUENCED_TOPIC))
      .orderBy(dead_letters.id);

    expect(await redriver.redrive(first.id, 'admin-1')).toEqual({ processed: 1, stoppedAt: null });
    expect(dispatched).toEqual(['u1']);
    expect(await statuses(UNSEQUENCED_TOPIC)).toEqual(['u1:redriven', 'u2:failed']);
  });

  // 보류 검사와 다시 넣기의 «남은 게 없다» 판정이 같은 순서 lock 으로 직렬화되는지 (최종 리뷰 C2).
  // A 가 lock 을 쥔 동안 B(실시간 보류 검사, 다른 연결)는 기다리고, A 가 커밋한 뒤의 상태로 판정한다.
  describe('순서 lock 경쟁', () => {
    const pending = Symbol('pending');
    const settledWithin = <T>(promise: Promise<T>, ms: number) =>
      Promise.race([promise, new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), ms))]);

    async function raceWithLockHolder(
      resolveInsideLock: (tx: PostgresJsDatabase<Record<string, never>>) => Promise<void>,
    ) {
      let live!: Promise<boolean>;
      await db.transaction(async (tx) => {
        expect(await tryLockSequence(tx, { consumerGroup: GROUP, topic: TOPIC, sequenceKey: 'order-A' })).toBe(true);
        live = store.holdIfBlocked(msg('m9'));
        expect(await settledWithin(live, 300)).toBe(pending); // lock 을 기다린다
        await resolveInsideLock(tx as never);
      });
      return live;
    }

    it('A 가 남은 행을 모두 풀고 커밋하면 B 는 보류하지 않는다(false)', async () => {
      const [first] = await seed('m1');
      const live = await raceWithLockHolder(async (tx) => {
        await tx.update(dead_letters).set({ status: 'redriven' }).where(eq(dead_letters.id, first));
      });
      expect(await live).toBe(false);
      expect(await statuses()).toEqual(['m1:redriven']);
    });

    it('A 가 커밋한 뒤에도 failed 가 남아 있으면 B 는 held 로 적는다(true)', async () => {
      const [first, second] = await seed('m1', 'm2');
      const live = await raceWithLockHolder(async (tx) => {
        // 다시 넣기가 m1 은 성공하고 m2 에서 멈춘 모양 — m2 가 새 머리(failed)
        await tx.update(dead_letters).set({ status: 'redriven' }).where(eq(dead_letters.id, first));
        await tx.update(dead_letters).set({ status: 'failed' }).where(eq(dead_letters.id, second));
      });
      expect(await live).toBe(true);
      expect(await statuses()).toEqual(['m1:redriven', 'm2:failed', 'm9:held']);
    });
  });
});
