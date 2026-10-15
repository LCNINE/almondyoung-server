/**
 * DeadLetterStore — 실제 Postgres (#1016 8번, 스펙 §6.2·§6.3)
 * 실행: DATABASE_URL=… npx jest --runInBand --runTestsByPath libs/events/src/dead-letter/dead-letter.store.integration.spec.ts
 */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DeadLetterStore } from './dead-letter.store';
import { tryLockSequence } from './sequence-lock';
import { dead_letters } from './dead-letter.schema';
import type { DeadLetterMessage } from './dead-letter.types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Db = PostgresJsDatabase<Record<string, never>>;
const GROUP = 'dead-letter-store-spec-group';
/** 이 스펙의 행만 — 같은 DB 의 다른 행을 건드리거나 세지 않는다 */
const mine = eq(dead_letters.consumerGroup, GROUP);

/** 롤백용 — 트랜잭션을 되돌리려고 일부러 던진다 */
class RollbackSentinel extends Error {}

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
    const sentinel = new RollbackSentinel();
    try {
      await db.transaction(async (tx) => {
        await tx.delete(dead_letters).where(mine);
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
    consumerGroup: GROUP,
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

      const rows = await tx.select().from(dead_letters).where(mine).orderBy(dead_letters.id);
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
      expect(await tx.select().from(dead_letters).where(mine)).toHaveLength(1);
    });
  });

  it('같은 메시지의 최종 실패가 두 번 오면 한 행을 갱신한다', async () => {
    await inRollbackTx(async (store, tx) => {
      await store.recordFailure(message('m1'), new Error('first'));
      await store.recordFailure(message('m1'), new Error('second'));
      const rows = await tx.select().from(dead_letters).where(mine);
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
      const [first, second] = await tx.select().from(dead_letters).where(mine).orderBy(dead_letters.id);

      await store.markRedriven(first.id);
      await store.recordRedriveFailure(second.id, new Error('again'));

      const [a] = await tx.select().from(dead_letters).where(eq(dead_letters.id, first.id));
      const [b] = await tx.select().from(dead_letters).where(eq(dead_letters.id, second.id));
      expect([a.status, a.redriveCount, a.resolvedAt !== null]).toEqual(['redriven', 1, true]);
      expect([b.status, b.redriveCount, b.errorMessage]).toEqual(['failed', 1, 'again']);
    });
  });

  it('나쁜 메시지도 기록이 실패하지 않는다 — NUL 을 지우고 칸 길이로 자른다(최종 리뷰 D6)', async () => {
    await inRollbackTx(async (store, tx) => {
      const nul = '\u0000';
      await store.recordFailure(
        {
          ...message(`m${nul}1`, `order${nul}-A`),
          handler: `H${'x'.repeat(300)}`,
          eventType: `E${nul}${'y'.repeat(300)}`,
          envelope: { [`k${nul}`]: `v${nul}`, nested: [`a${nul}b`, 1, null], literal: '\\u0000' },
        },
        Object.assign(new Error(`boom${nul}`), { name: `Name${nul}` }),
      );
      const [row] = await tx.select().from(dead_letters).where(mine);
      expect([row.messageId, row.sequenceKey, row.errorName, row.errorMessage]).toEqual([
        'm1',
        'order-A',
        'Name',
        'boom',
      ]);
      expect([row.handler.length, row.eventType?.length]).toEqual([200, 100]);
      // 백슬래시+글자 «\u0000»(6자)은 NUL 이 아니다 — 그대로 남는다
      expect(row.envelope).toEqual({ k: 'v', nested: ['ab', 1, null], literal: '\\u0000' });
    });
  });

  it('순서 lock 을 다른 연결이 오래 쥐고 있으면 기다리다 끊고 던진다 — 실시간 소비가 무한정 매달리지 않는다(D7)', async () => {
    // 다시 넣기처럼 다른 연결이 같은 순서 lock 을 쥐고 놓지 않는다 — 테스트가 끝낼 때까지
    const holderClient = postgres(DATABASE_URL as string, { max: 1 });
    const otherClient = postgres(DATABASE_URL as string, { max: 1 });
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => (signalHeld = resolve));
    const holding = drizzle(holderClient).transaction(async (tx) => {
      expect(
        await tryLockSequence(tx, { consumerGroup: GROUP, topic: 'orders.events.v1', sequenceKey: 'order-A' }),
      ).toBe(true);
      signalHeld();
      await released;
    });
    try {
      await lockHeld;
      const store = new DeadLetterStore({ db: drizzle(otherClient) } as never);
      const started = Date.now();
      const failure: unknown = await store.holdIfBlocked(message('m1')).then(
        () => null,
        (error: unknown) => error,
      );
      expect(Date.now() - started).toBeLessThan(11_500);
      // drizzle 이 감싼 에러의 원인이 Postgres 의 lock_not_available(55P03, «canceling statement due to lock timeout»)이다
      expect(failure).toBeInstanceOf(Error);
      expect(failure instanceof Error ? failure.cause : undefined).toMatchObject({ code: '55P03' });
    } finally {
      release();
      await holding;
      await holderClient.end();
      await otherClient.end();
    }
  });
});
