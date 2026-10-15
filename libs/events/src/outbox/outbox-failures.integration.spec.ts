/** 실행: `DATABASE_URL=… npx jest --runInBand --runTestsByPath libs/events/src/outbox/outbox-failures.integration.spec.ts` */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
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
    run: (ctx: { tx: Db; service: OutboxFailuresService; sent: string[]; fail: { on: boolean } }) => Promise<void>,
  ) {
    const sentinel = new Error('rollback');
    try {
      await db.transaction(async (tx) => {
        await tx.delete(outbox_events);
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
          sequenceByAggregate: true,
          maxRetries: 8,
        });
        const service = new OutboxFailuresService(dbService, dispatcher, new FailureActionLog(dbService));
        await run({ tx: tx as never, service, sent, fail });
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

  async function seed(tx: Db, marker: string, status: 'FAILED' | 'PENDING', second: number): Promise<number> {
    const [row] = await tx
      .insert(outbox_events)
      .values({
        topic: HARNESS.topic.topic,
        aggregateType: 'H',
        aggregateId: 'order-A',
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
      await seed(tx, 'A1', 'FAILED', 1);
      await seed(tx, 'A2', 'PENDING', 2);
      const page = await service.listFailed();
      expect(page.items.map((i) => [i.eventType, i.waitingBehind])).toEqual([['Moved', 1]]);
      expect(page.nextCursor).toBeNull();
    });
  });

  it('전체 다시 보내기는 오래된 순서로 한 번씩, 결과를 요약한다', async () => {
    await inRollbackTx(async ({ tx, service, sent }) => {
      await seed(tx, 'A1', 'FAILED', 1);
      await seed(tx, 'A2', 'FAILED', 2);
      const result = await service.resendAll('admin-1');
      expect(result).toMatchObject({ total: 2, published: 2, failed: [] });
      expect(sent).toEqual(['msg-A1', 'msg-A2']);
    });
  });
});
