/** 실행: `DATABASE_URL=… npx jest --runInBand --runTestsByPath libs/events/src/outbox/outbox-failures.integration.spec.ts` */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { OutboxFailuresService } from './outbox-failures.service';
import { outbox_events } from './outbox.schema';
import { FailureActionLog } from '../dead-letter/failure-action.log';
import { failure_actions } from '../dead-letter/dead-letter.schema';

const HARNESS = stream({
  topic: 'outbox-failures.harness.v1',
  partitions: 1,
  aggregateType: 'H',
  events: { Moved: event('Moved', z.object({ step: z.number().int() })) },
});
/** 순서를 지키지 않는 토픽 — 뒤 대기 수가 0 이어야 한다 */
const UNSEQUENCED_TOPIC = 'outbox-failures.unsequenced.v1';
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Db = PostgresJsDatabase<Record<string, never>>;

describeIfDb('OutboxFailuresService (PostgreSQL 통합)', () => {
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
    run: (ctx: {
      tx: Db;
      service: OutboxFailuresService;
      dispatcher: OutboxDispatcher;
      sent: string[];
      fail: { on: boolean };
    }) => Promise<void>,
  ) {
    const sentinel = new Error('rollback');
    try {
      await db.transaction(async (tx) => {
        // 하네스 토픽만 지운다(WHERE 없는 DELETE 금지, CLAUDE.md). 다른 행이 남아 있을 수 있으니 단언은 자기 행만 본다
        await tx.delete(outbox_events).where(inArray(outbox_events.topic, [HARNESS.topic.topic, UNSEQUENCED_TOPIC]));
        const sent: string[] = [];
        const fail = { on: false };
        const publisher = new StreamPublisher(
          {
            send: (_t, message) => {
              if (fail.on) return Promise.reject(new Error('broker down'));
              sent.push((JSON.parse(message.value) as MessageEnvelope).messageId);
              return Promise.resolve();
            },
          },
          HARNESS,
          'outbox-failures-spec',
        );
        const dbService = { db: tx } as never;
        const dispatcher = new OutboxDispatcher(dbService, new Map([[HARNESS.topic.topic, publisher]]), {
          sequencedTopics: [HARNESS.topic.topic],
          maxRetries: 8,
        });
        const service = new OutboxFailuresService(dbService, dispatcher, new FailureActionLog(dbService));
        await run({ tx: tx as never, service, dispatcher, sent, fail });
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  const envelope = (marker: string): MessageEnvelope => ({
    messageId: `msg-${marker}`,
    messageType: 'Moved',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: `msg-${marker}`,
    timestamp: new Date().toISOString(),
    occurredAt: new Date().toISOString(),
    source: { service: 's', aggregateType: 'H', aggregateId: 'order-A' },
    payload: { step: 1 },
  });

  async function seed(
    tx: Db,
    marker: string,
    status: 'FAILED' | 'PENDING',
    second: number,
    aggregateId = 'order-A',
    topic = HARNESS.topic.topic,
  ): Promise<number> {
    const [row] = await tx
      .insert(outbox_events)
      .values({
        topic,
        aggregateType: 'H',
        aggregateId,
        eventType: 'Moved',
        payload: envelope(marker),
        status,
        retryCount: status === 'FAILED' ? 8 : 0,
        errorMessage: status === 'FAILED' ? 'old error' : null,
        createdAt: new Date(`2026-10-15T00:00:0${second}.000Z`),
      })
      .returning({ id: outbox_events.id });
    return row.id;
  }

  it('다시 보내기 성공 → PUBLISHED, 같은 주문 뒤 행은 다음 주기에 흐른다', async () => {
    await inRollbackTx(async ({ tx, service, sent }) => {
      const failedId = await seed(tx, 'A1', 'FAILED', 1);
      await seed(tx, 'A2', 'PENDING', 2);

      expect(await service.resend(failedId, 'admin-1')).toEqual({ status: 'PUBLISHED' });
      expect(sent).toEqual(['msg-A1']);

      const [row] = await tx.select().from(outbox_events).where(eq(outbox_events.id, failedId));
      expect(row.status).toBe('PUBLISHED');
    });
  });

  it('다시 보내기 실패 → FAILED 로 돌아가고 retry_count 는 그대로, 오류만 갱신', async () => {
    await inRollbackTx(async ({ tx, service, fail }) => {
      const failedId = await seed(tx, 'A1', 'FAILED', 1);
      fail.on = true;
      const result = await service.resend(failedId, 'admin-1');
      expect(result).toEqual({ status: 'FAILED', error: 'broker down' });
      const [row] = await tx.select().from(outbox_events).where(eq(outbox_events.id, failedId));
      expect([row.status, row.retryCount, row.errorMessage]).toEqual(['FAILED', 8, 'broker down']);
    });
  });

  it('FAILED 가 아닌 행은 409', async () => {
    await inRollbackTx(async ({ tx, service }) => {
      const id = await seed(tx, 'A1', 'PENDING', 1);
      await expect(service.resend(id, 'admin-1')).rejects.toThrow(/FAILED/);
    });
  });

  it('종결 → DISCARDED, 사유를 남기고, 사유가 비면 거부', async () => {
    await inRollbackTx(async ({ tx, service }) => {
      const id = await seed(tx, 'A1', 'FAILED', 1);
      await expect(service.discard(id, 'admin-1', '')).rejects.toThrow(/사유/);
      expect(await service.discard(id, 'admin-1', '수기 처리함')).toEqual({ status: 'DISCARDED' });
      const actions = await tx.select().from(failure_actions).where(eq(failure_actions.targetId, id));
      expect(actions.map((a) => [a.targetKind, a.action, a.note])).toContainEqual(['outbox', 'discard', '수기 처리함']);
    });
  });

  it('목록은 FAILED 만, 같은 주문 뒤에서 기다리는 행 수와 함께', async () => {
    await inRollbackTx(async ({ tx, service }) => {
      const a1 = await seed(tx, 'A1', 'FAILED', 1);
      await seed(tx, 'A2', 'PENDING', 2);
      await seed(tx, 'A3', 'PENDING', 3);
      const b1 = await seed(tx, 'B1', 'FAILED', 4, 'order-B');
      await seed(tx, 'B2', 'PENDING', 5, 'order-B');
      await seed(tx, 'C1', 'PENDING', 6, 'order-C');
      // 순서를 지키지 않는 토픽은 같은 키 뒤에 PENDING 이 있어도 막고 있지 않다 — 0
      const u1 = await seed(tx, 'U1', 'FAILED', 7, 'order-U', UNSEQUENCED_TOPIC);
      await seed(tx, 'U2', 'PENDING', 8, 'order-U', UNSEQUENCED_TOPIC);
      const mine = new Set([a1, b1, u1]);
      const page = await service.listFailed('200');
      expect(page.items.filter((i) => mine.has(i.id)).map((i) => [i.id, i.waitingBehind])).toEqual([
        [a1, 2],
        [b1, 1],
        [u1, 0],
      ]);
    });
  });

  it('다시 보내기 중 죽은 lease(retry_count 가 한도) 는 FAILED 로 돌아온다 — PENDING 에 갇히지 않는다', async () => {
    await inRollbackTx(async ({ tx, dispatcher, sent }) => {
      const stale = new Date('2026-10-15T00:00:00.000Z');
      const stuck = await seed(tx, 'A1', 'FAILED', 1);
      await tx
        .update(outbox_events)
        .set({ status: 'PROCESSING', processingStartedAt: stale })
        .where(eq(outbox_events.id, stuck));
      await dispatcher.dispatchPendingEvents();
      const [row] = await tx.select().from(outbox_events).where(eq(outbox_events.id, stuck));
      expect([row.status, row.retryCount]).toEqual(['FAILED', 8]);
      expect(row.failedAt).not.toBeNull();
      expect(sent).toEqual([]);
    });
  });

  it('통제: 보통의 만료된 PROCESSING 행(retry_count 0) 은 예전처럼 다시 돌아 발행된다', async () => {
    await inRollbackTx(async ({ tx, dispatcher, sent }) => {
      const id = await seed(tx, 'A1', 'PENDING', 1);
      await tx
        .update(outbox_events)
        .set({ status: 'PROCESSING', processingStartedAt: new Date('2026-10-15T00:00:00.000Z') })
        .where(eq(outbox_events.id, id));
      await dispatcher.dispatchPendingEvents();
      const [row] = await tx.select().from(outbox_events).where(eq(outbox_events.id, id));
      expect(row.status).toBe('PUBLISHED');
      expect(sent).toEqual(['msg-A1']);
    });
  });

  it('전체 다시 보내기는 오래된 순서로 한 번씩, 결과를 요약한다', async () => {
    await inRollbackTx(async ({ tx, service, sent }) => {
      const a1 = await seed(tx, 'A1', 'FAILED', 1);
      const a2 = await seed(tx, 'A2', 'FAILED', 2);
      const result = await service.resendAll('admin-1');
      // 같은 DB 의 다른 FAILED 행도 대상이 되므로(롤백된다) 자기 행만 본다
      expect(result.failed.filter((f) => f.id === a1 || f.id === a2)).toEqual([]);
      expect(result.published).toBeGreaterThanOrEqual(2);
      expect(sent).toEqual(['msg-A1', 'msg-A2']);
    });
  });
});
