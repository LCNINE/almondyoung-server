/**
 * 아웃박스 멱등 — 실제 Postgres 에 걸린 제약을 확인한다 (ADR-0029 §5-1, Task 6-C-2)
 *
 * **왜 통합 스펙인가.** 이 기능의 주체는 코드가 아니라 **DB 제약**이다
 * (`unique(topic, event_type, idempotency_key)`). `onConflictDoNothing()` 은 제약이 있을 때만
 * 뜻이 있고, 제약이 없으면 같은 문장이 두 행을 그대로 넣는다. 목 DB 로는 그 차이가 보이지
 * 않으므로 — 어느 쪽이든 "SQL 에 ON CONFLICT 가 있다"만 관찰된다 — 이 스펙은 마이그레이션이
 * 적용된 실 DB 를 대상으로 돈다.
 *
 * **대조군이 이 스펙의 절반이다.** `제약 없는 쌍둥이 테이블`에 같은 두 문장을 넣어 **두 행**이
 * 남는 것을 나란히 고정한다. 그게 없으면 초록불이 "제약이 막았다"인지 "애초에 두 번째 적재가
 * 일어나지 않았다"인지 구분되지 않는다 — core 호출자 254곳의 중복 방어가 걸려 있는 판정이라
 * 그 구분이 중요하다.
 *
 * 실행: `npm run test:core:integration:local -- outbox-idempotency`
 * (DATABASE_URL 이 없으면 통째로 skip 된다 — `npm test` 기본 경로에서는 돌지 않는다.)
 */

import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxPublisher } from './outbox-publisher.service';
import { outbox_events } from './outbox.schema';
import type { DbTx } from './outbox.types';

const StockShippedSchema = z.object({
  skuId: z.string().min(1),
  quantity: z.number().int().positive(),
});

const HARNESS_STREAM = stream({
  topic: 'outbox-idempotency.harness.v1',
  partitions: 1,
  aggregateType: 'IdempotencyHarness',
  events: {
    StockShipped: event('StockShipped', StockShippedSchema),
  },
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('아웃박스 멱등 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: postgres.Sql;
  let db: PostgresJsDatabase<Record<string, never>>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client);
  });

  afterAll(async () => {
    await client.end();
  });

  /** 모든 케이스를 롤백 트랜잭션 안에서 돌린다 — 실 DB 를 더럽히지 않는다. */
  async function inRollbackTx(run: (tx: DbTx & PostgresJsDatabase<Record<string, never>>) => Promise<void>) {
    const sentinel = Symbol('rollback');
    try {
      await db.transaction(async (tx) => {
        await run(tx as never);
        throw sentinel;
      });
    } catch (error) {
      if (error !== sentinel) throw error;
    }
  }

  function publisherFor(dbService: unknown) {
    return new StreamPublisher(
      // 이 스펙은 적재만 본다 — transport 는 닿지 않는다.
      { send: async () => undefined } as never,
      HARNESS_STREAM,
      'outbox-idempotency-spec',
      undefined,
      undefined,
      undefined,
      new OutboxPublisher(dbService as never),
    );
  }

  const enqueueTwice = async (tx: DbTx, idempotencyKey?: string) => {
    const publisher = publisherFor({ db: tx });
    const params = {
      eventType: 'StockShipped' as const,
      aggregateId: 'agg-1',
      payload: { skuId: 'SKU-1', quantity: 3 },
      ...(idempotencyKey ? { idempotencyKey } : {}),
    };
    await publisher.enqueue(params, tx);
    await publisher.enqueue(params, tx);
  };

  const countHarnessRows = async (tx: PostgresJsDatabase<Record<string, never>>) => {
    const rows = await tx
      .select({ id: outbox_events.id })
      .from(outbox_events)
      .where(eq(outbox_events.topic, HARNESS_STREAM.topic.topic));
    return rows.length;
  };

  it('같은 idempotencyKey 로 두 번 적재하면 한 행만 남는다', async () => {
    await inRollbackTx(async (tx) => {
      await enqueueTwice(tx, 'stock-event:same-key');

      expect(await countHarnessRows(tx)).toBe(1);
    });
  });

  it('두 번째 적재가 던지지 않는다 — 호출자의 도메인 트랜잭션이 살아 있다', async () => {
    // 던지면 이미 기록된 사실을 다시 적재하려 했다는 이유로 재고 이동/출고가 통째로 롤백된다.
    // 트랜잭션이 살아 있음을 "그 뒤에도 쓸 수 있다" 로 관찰한다 — Postgres 는 문장 하나가
    // 실패하면 트랜잭션 전체를 aborted 상태로 만들므로, 후속 SELECT 가 성공한다는 것이 곧
    // 앞선 문장이 실패하지 않았다는 증거다.
    await inRollbackTx(async (tx) => {
      await expect(enqueueTwice(tx, 'stock-event:no-throw')).resolves.toBeUndefined();

      const [alive] = await tx.execute<{ ok: number }>(sql`SELECT 1 AS ok`);
      expect(alive.ok).toBe(1);
    });
  });

  it('대조군: 제약이 없는 같은 모양의 테이블에서는 두 행이 남는다', async () => {
    // `LIKE ... INCLUDING DEFAULTS` 는 컬럼과 기본값만 복제하고 **인덱스·제약은 복제하지 않는다**.
    // 바뀌는 변수는 unique 제약 하나뿐이고, 넣는 문장은 위 케이스와 같은
    // `INSERT ... ON CONFLICT DO NOTHING` 이다.
    await inRollbackTx(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE outbox_events_no_constraint (LIKE event.outbox_events INCLUDING DEFAULTS)`);

      const insertTwice = async () => {
        for (let i = 0; i < 2; i++) {
          await tx.execute(sql`
            INSERT INTO outbox_events_no_constraint
              (topic, aggregate_type, aggregate_id, event_type, idempotency_key, partition_key, payload, status)
            VALUES (${HARNESS_STREAM.topic.topic}, 'IdempotencyHarness', 'agg-1', 'StockShipped',
                    'stock-event:same-key', 'agg-1', ${JSON.stringify({ probe: true })}::jsonb, 'PENDING')
            ON CONFLICT DO NOTHING
          `);
        }
      };
      await insertTwice();

      const rows = await tx.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM outbox_events_no_constraint`);
      expect(Number(rows[0].n)).toBe(2);
    });
  });

  it('idempotencyKey 가 없으면 제약이 막지 않는다 — 컬럼이 생기기 전 동작', async () => {
    // Postgres 의 unique 는 NULL 을 서로 다르게 취급한다(`NULLS DISTINCT`, PG15+ 기본값).
    // 이 성질이 6-C-1 마이그레이션이 기존 행을 막지 않은 이유이고, 키를 넘기지 않는 앱
    // (core catalog · membership)의 동작이 그대로인 이유이기도 하다.
    await inRollbackTx(async (tx) => {
      await enqueueTwice(tx, undefined);

      expect(await countHarnessRows(tx)).toBe(2);
    });
  });

  it('제약이 실제로 걸려 있다 — NULLS DISTINCT 이며 세 컬럼짜리다', async () => {
    // 위 케이스들이 관찰하는 동작의 근거를 카탈로그에서 직접 읽는다. 제약이 조용히
    // 사라지거나 `NULLS NOT DISTINCT` 로 바뀌면 여기서 먼저 빨간불이 난다.
    const rows = await db.execute<{ nulls_not_distinct: boolean; cols: string }>(sql`
      SELECT i.indnullsnotdistinct AS nulls_not_distinct,
             string_agg(a.attname, ',' ORDER BY a.attnum) AS cols
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE c.relname = 'uq_event_outbox_topic_event_idempotency'
      GROUP BY i.indnullsnotdistinct
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].nulls_not_distinct).toBe(false);
    expect(rows[0].cols.split(',').sort()).toEqual(['event_type', 'idempotency_key', 'topic']);
  });

  it('적재된 행이 idempotencyKey 와 해석된 partitionKey 를 들고 있다', async () => {
    await inRollbackTx(async (tx) => {
      const publisher = publisherFor({ db: tx });
      await publisher.enqueue(
        {
          eventType: 'StockShipped',
          aggregateId: 'agg-1',
          payload: { skuId: 'SKU-9', quantity: 1 },
          idempotencyKey: 'stock-event:carried',
          // 호출자 지정이 aggregateId 를 이긴다 — 재고 이벤트가 skuId 로 파티션되는 근거.
          partitionKey: 'SKU-9',
        },
        tx,
      );

      const [row] = await tx
        .select({
          idempotencyKey: outbox_events.idempotencyKey,
          partitionKey: outbox_events.partitionKey,
          aggregateId: outbox_events.aggregateId,
        })
        .from(outbox_events)
        .where(
          and(eq(outbox_events.topic, HARNESS_STREAM.topic.topic), eq(outbox_events.eventType, 'StockShipped')),
        );

      expect(row).toEqual({ idempotencyKey: 'stock-event:carried', partitionKey: 'SKU-9', aggregateId: 'agg-1' });
    });
  });

  it('partitionKey 를 안 넘기면 aggregateId 로 해석된다 (파생 함수가 없는 스트림)', async () => {
    await inRollbackTx(async (tx) => {
      const publisher = publisherFor({ db: tx });
      await publisher.enqueue(
        {
          eventType: 'StockShipped',
          aggregateId: 'agg-fallback',
          payload: { skuId: 'SKU-2', quantity: 2 },
          idempotencyKey: 'stock-event:fallback',
        },
        tx,
      );

      const [row] = await tx
        .select({ partitionKey: outbox_events.partitionKey })
        .from(outbox_events)
        .where(eq(outbox_events.idempotencyKey, 'stock-event:fallback'));

      expect(row.partitionKey).toBe('agg-fallback');
    });
  });
});
