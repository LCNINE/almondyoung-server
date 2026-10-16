/**
 * 같은 주문 순서 지키기 — 실제 Postgres 에서 확인한다 (#1016 7번, 스펙 §8.2)
 *
 * 주체가 SQL 술어라 목 DB 로는 볼 수 없다. 대조군(옵션 끔)을 나란히 둔다 — 없으면 초록불이
 * «술어가 걸렀다»인지 «애초에 후보가 아니었다»인지 구분되지 않는다.
 *
 * 실행: `npm run test:core:integration:local -- outbox-aggregate-sequence`
 */
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { inArray } from 'drizzle-orm';
import { outbox_events } from './outbox.schema';

const HARNESS_STREAM = stream({
  topic: 'outbox-aggregate-sequence.harness.v1',
  partitions: 1,
  aggregateType: 'SequenceHarness',
  events: { Moved: event('Moved', z.object({ step: z.number().int() })) },
});
/** 순서를 지키지 않는 토픽 — «마지막 값이 이긴다» 스트림 자리. `sequencedTopics` 에 넣지 않는다 */
const LATEST_WINS_STREAM = stream({
  topic: 'outbox-aggregate-sequence.latest-wins.v1',
  partitions: 1,
  aggregateType: 'SequenceHarness',
  events: { Moved: event('Moved', z.object({ step: z.number().int() })) },
});
const HARNESS_TOPICS = [HARNESS_STREAM.topic.topic, LATEST_WINS_STREAM.topic.topic];

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type SeedRow = {
  marker: string;
  aggregateId: string;
  createdAt: Date;
  status?: 'PENDING' | 'PROCESSING' | 'FAILED' | 'DISCARDED';
  topic?: string;
};

/** 롤백용 — 트랜잭션을 되돌리려고 일부러 던진다 */
class RollbackSentinel extends Error {}
type Db = PostgresJsDatabase<Record<string, never>>;

describeIfDb('outbox 같은 주문 순서 지키기 (PostgreSQL 통합)', () => {
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

  async function inRollbackTx(run: (tx: Db) => Promise<void>) {
    const sentinel = new RollbackSentinel();
    try {
      await db.transaction(async (tx) => {
        await run(tx as never);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  function envelope(marker: string, aggregateId: string): MessageEnvelope {
    return {
      messageId: `msg-${marker}`,
      messageType: 'Moved',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: `msg-${marker}`,
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'outbox-aggregate-sequence-spec', aggregateType: HARNESS_STREAM.aggregateType, aggregateId },
      payload: { step: 1 },
    };
  }

  /** `sequenced` 가 true 면 HARNESS 토픽만 `sequencedTopics` 에 넣는다(LATEST_WINS 는 늘 밖) */
  async function dispatchOnce(tx: Db, rows: SeedRow[], sequenced: boolean): Promise<string[]> {
    // 하네스 토픽만 지운다 — 롤백 트랜잭션 안이라도 WHERE 없는 DELETE 는 쓰지 않는다(CLAUDE.md)
    await tx.delete(outbox_events).where(inArray(outbox_events.topic, HARNESS_TOPICS));
    for (const row of rows) {
      await tx.insert(outbox_events).values({
        topic: row.topic ?? HARNESS_STREAM.topic.topic,
        aggregateType: HARNESS_STREAM.aggregateType,
        aggregateId: row.aggregateId,
        eventType: 'Moved',
        // 모든 행이 같은 파티션 키 — channel-adapter 처럼 «채널 이름» 하나라도 주문별로 갈려야 한다
        partitionKey: 'medusa',
        payload: envelope(row.marker, row.aggregateId),
        status: row.status ?? 'PENDING',
        retryCount: row.status === 'FAILED' ? 8 : 0,
        // 살아 있는 lease — 타임아웃 회수 대상이 아니다
        processingStartedAt: row.status === 'PROCESSING' ? new Date() : null,
        createdAt: row.createdAt,
      });
    }
    const published: string[] = [];
    const transport = {
      send: (_topic: string, message: { value: string }) => {
        published.push((JSON.parse(message.value) as MessageEnvelope).messageId.replace('msg-', ''));
        return Promise.resolve();
      },
    };
    const publishers = new Map(
      [HARNESS_STREAM, LATEST_WINS_STREAM].map((s) => [
        s.topic.topic,
        new StreamPublisher(transport, s, 'outbox-aggregate-sequence-spec'),
      ]),
    );
    const dispatcher = new OutboxDispatcher({ db: tx } as never, publishers, {
      sequencedTopics: sequenced ? [HARNESS_STREAM.topic.topic] : [],
      maxRetries: 8,
    });
    await dispatcher.dispatchPendingEvents();
    return published;
  }

  const at = (s: string) => new Date(`2026-10-15T00:00:${s}.000Z`);

  it('켜면: 앞 행이 굳은 주문의 뒤 행은 나가지 않고, 다른 주문은 나간다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'A1', aggregateId: 'order-A', createdAt: at('01'), status: 'FAILED' },
          { marker: 'A2', aggregateId: 'order-A', createdAt: at('02') },
          { marker: 'B1', aggregateId: 'order-B', createdAt: at('03') },
        ],
        true,
      );
      expect(published).toEqual(['B1']);
    });
  });

  it('대조군 — 끄면: 굳은 앞 행과 무관하게 뒤 행이 나간다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'A1', aggregateId: 'order-A', createdAt: at('01'), status: 'FAILED' },
          { marker: 'A2', aggregateId: 'order-A', createdAt: at('02') },
        ],
        false,
      );
      expect(published).toEqual(['A2']);
    });
  });

  it('앞 행이 DISCARDED 면 막지 않는다 — 종결이 순서를 푼다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'A1', aggregateId: 'order-A', createdAt: at('01'), status: 'DISCARDED' },
          { marker: 'A2', aggregateId: 'order-A', createdAt: at('02') },
        ],
        true,
      );
      expect(published).toEqual(['A2']);
    });
  });

  it('앞 PENDING 이 같은 배치에 있으면 뒤 행은 다음 주기로 밀린다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'A1', aggregateId: 'order-A', createdAt: at('01') },
          { marker: 'A2', aggregateId: 'order-A', createdAt: at('02') },
        ],
        true,
      );
      expect(published).toEqual(['A1']);
    });
  });

  it('created_at 이 같아도 서로를 막지 않는다 — id 가 동률을 깬다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'T1', aggregateId: 'order-T', createdAt: at('05') },
          { marker: 'T2', aggregateId: 'order-T', createdAt: at('05') },
        ],
        true,
      );
      expect(published).toEqual(['T1']);
    });
  });

  it('앞 PROCESSING(살아 있는 lease)도 같은 주문의 뒤 행을 막는다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'P1', aggregateId: 'order-P', createdAt: at('01'), status: 'PROCESSING' },
          { marker: 'P2', aggregateId: 'order-P', createdAt: at('02') },
          { marker: 'Q1', aggregateId: 'order-Q', createdAt: at('03') },
        ],
        true,
      );
      expect(published).toEqual(['Q1']);
    });
  });

  it('순서를 지키지 않는 토픽은 같은 키의 앞 FAILED 에 막히지 않는다 — 켠 토픽만 막힌다', async () => {
    await inRollbackTx(async (tx) => {
      const latest = LATEST_WINS_STREAM.topic.topic;
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'V1', aggregateId: 'variant-1', createdAt: at('01'), status: 'FAILED', topic: latest },
          { marker: 'V2', aggregateId: 'variant-1', createdAt: at('02'), topic: latest },
          { marker: 'V3', aggregateId: 'variant-1', createdAt: at('03'), topic: latest },
          { marker: 'A1', aggregateId: 'order-A', createdAt: at('04'), status: 'FAILED' },
          { marker: 'A2', aggregateId: 'order-A', createdAt: at('05') },
        ],
        true,
      );
      // 같은 품목의 두 행이 한 주기에 다 나간다 — 품목당 한 행으로 줄지 않는다
      expect(published).toEqual(['V2', 'V3']);
    });
  });
});
