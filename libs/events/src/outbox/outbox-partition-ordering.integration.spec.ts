/**
 * 파티션 순서 보장 — 실제 Postgres 에서 확인한다 (ADR-0029 §5-1, Task 6-C-3)
 *
 * **왜 통합 스펙인가.** 이 기능의 주체는 코드가 아니라 **SQL 술어**다 — 후보 선택 시점에
 * "같은 partition_key 의 더 이른 미발행 행"이 있는지 묻는 상관 서브쿼리. 목 DB 로는 그 술어가
 * 실제로 무엇을 거르는지 볼 수 없고, `created_at` 동률 같은 경계는 특히 그렇다.
 *
 * **대조군이 이 스펙의 절반이다.** 같은 4행에 대해 옵션을 끄면 4행 전부가, 켜면 파티션마다
 * 첫 행만 선택되는 것을 나란히 고정한다. 그게 없으면 초록불이 "술어가 걸렀다"인지 "애초에
 * 뒤 행이 후보가 아니었다"인지 구분되지 않는다.
 *
 * 실행: `npm run test:core:integration:local -- outbox-partition-ordering`
 * (DATABASE_URL 이 없으면 통째로 skip — `npm test` 기본 경로에서는 돌지 않는다.)
 */

import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import type { MessageEnvelope } from '@packages/event-contracts/types';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { outbox_events } from './outbox.schema';

const HARNESS_STREAM = stream({
  topic: 'outbox-ordering.harness.v1',
  partitions: 1,
  aggregateType: 'OrderingHarness',
  events: {
    Moved: event('Moved', z.object({ step: z.number().int() })),
  },
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type SeedRow = { marker: string; partitionKey: string; createdAt: Date };

describeIfDb('아웃박스 파티션 순서 보장 (PostgreSQL 통합)', () => {
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
  async function inRollbackTx(run: (tx: PostgresJsDatabase<Record<string, never>>) => Promise<void>) {
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

  /**
   * 한 번의 dispatch 사이클을 돌리고 **발행된 순서대로** marker 를 돌려준다.
   *
   * 디스패처는 테이블 전체를 후보로 보므로, 케이스마다 먼저 테이블을 비운다 — 롤백
   * 트랜잭션 안이라 되돌아간다. 비우지 않으면 dev DB 에 남아 있는 다른 행이 배치를 채워
   * 이 스펙이 무엇을 관찰하는지 알 수 없게 된다.
   */
  async function dispatchOnce(
    tx: PostgresJsDatabase<Record<string, never>>,
    rows: SeedRow[],
    strictPartitionOrdering: boolean,
  ): Promise<string[]> {
    await tx.delete(outbox_events);

    for (const row of rows) {
      await tx.insert(outbox_events).values({
        topic: HARNESS_STREAM.topic.topic,
        aggregateType: HARNESS_STREAM.aggregateType,
        aggregateId: row.marker,
        eventType: 'Moved',
        partitionKey: row.partitionKey,
        payload: buildEnvelope(row.marker),
        status: 'PENDING',
        createdAt: row.createdAt,
      });
    }

    const published: string[] = [];
    const publisher = new StreamPublisher(
      {
        send: (_topic, message) => {
          published.push((JSON.parse(message.value) as MessageEnvelope).source.aggregateId);
          return Promise.resolve();
        },
      },
      HARNESS_STREAM,
      'outbox-ordering-spec',
    );

    const dispatcher = new OutboxDispatcher({ db: tx } as never, new Map([[HARNESS_STREAM.topic.topic, publisher]]), {
      strictPartitionOrdering,
    });

    await dispatcher.dispatchPendingEvents();
    return published;
  }

  function buildEnvelope(marker: string): MessageEnvelope {
    return {
      messageId: `msg-${marker}`,
      messageType: 'Moved',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: `msg-${marker}`,
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: {
        service: 'outbox-ordering-spec',
        aggregateType: HARNESS_STREAM.aggregateType,
        aggregateId: marker,
      },
      payload: { step: 1 },
    };
  }

  const at = (isoSeconds: string) => new Date(`2026-08-09T00:00:${isoSeconds}.000Z`);

  /** P 파티션 3행(시간 순) + Q 파티션 1행. */
  const THREE_PLUS_ONE: SeedRow[] = [
    { marker: 'P1', partitionKey: 'P', createdAt: at('01') },
    { marker: 'P2', partitionKey: 'P', createdAt: at('02') },
    { marker: 'P3', partitionKey: 'P', createdAt: at('03') },
    { marker: 'Q1', partitionKey: 'Q', createdAt: at('02') },
  ];

  it('켜면: 파티션마다 가장 이른 한 행만 나간다', async () => {
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(tx, THREE_PLUS_ONE, true);

      // P2·P3 는 P1 이 아직 미발행이라 **선택되지 않는다.** Q1 은 다른 파티션이라 막히지 않는다.
      expect(published.sort()).toEqual(['P1', 'Q1']);
    });
  });

  it('대조군 — 끄면: 같은 4행이 전부 나간다', async () => {
    // 이 케이스가 없으면 위 단언은 "애초에 P2·P3 가 후보가 아니었다" 로도 초록이다.
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(tx, THREE_PLUS_ONE, false);

      expect(published.sort()).toEqual(['P1', 'P2', 'P3', 'Q1']);
    });
  });

  it('다음 사이클에서 막혔던 행이 풀린다 — 정지가 아니라 지연이다', async () => {
    await inRollbackTx(async (tx) => {
      const first = await dispatchOnce(tx, THREE_PLUS_ONE, true);
      expect(first.sort()).toEqual(['P1', 'Q1']);

      // 앞 행이 PUBLISHED 가 됐으므로 이제 P2 가 자격을 얻는다. (테이블을 다시 비우지 않도록
      // 디스패처만 새로 돌린다 — dispatchOnce 는 seed 부터 다시 하므로 쓸 수 없다.)
      const published: string[] = [];
      const publisher = new StreamPublisher(
        {
          send: (_topic, message) => {
            published.push((JSON.parse(message.value) as MessageEnvelope).source.aggregateId);
            return Promise.resolve();
          },
        },
        HARNESS_STREAM,
        'outbox-ordering-spec',
      );
      const dispatcher = new OutboxDispatcher({ db: tx } as never, new Map([[HARNESS_STREAM.topic.topic, publisher]]), {
        strictPartitionOrdering: true,
      });
      await dispatcher.dispatchPendingEvents();

      expect(published).toEqual(['P2']);
    });
  });

  it('created_at 이 같아도 파티션이 정지하지 않는다 — id 가 동률을 깬다', async () => {
    // 한 트랜잭션에서 두 이벤트를 적재하면 실제로 같은 타임스탬프가 나온다. `created_at` 만
    // 비교하면 두 행이 **서로를** 막아 그 파티션이 영구히 멈춘다. 술어가 `(created_at, id)` 를
    // 사전식으로 비교하는 이유이고, 이 단언이 그 이유를 실행으로 고정한다.
    await inRollbackTx(async (tx) => {
      const published = await dispatchOnce(
        tx,
        [
          { marker: 'T1', partitionKey: 'T', createdAt: at('05') },
          { marker: 'T2', partitionKey: 'T', createdAt: at('05') },
        ],
        true,
      );

      expect(published).toEqual(['T1']);
    });
  });

  it('partition_key 가 NULL 인 행은 서로 막지 않는다', async () => {
    // 이 컬럼이 생기기 전에 적재된 행이 그렇다. SQL 의 `=` 가 NULL 을 같다고 하지 않으므로
    // 술어가 걸리지 않는 것이 옳다 — 옛 행들이 서로를 막으면 회수 배포 직후 아웃박스가 선다.
    await inRollbackTx(async (tx) => {
      await tx.delete(outbox_events);

      for (const marker of ['N1', 'N2']) {
        await tx.insert(outbox_events).values({
          topic: HARNESS_STREAM.topic.topic,
          aggregateType: HARNESS_STREAM.aggregateType,
          aggregateId: marker,
          eventType: 'Moved',
          partitionKey: null,
          payload: buildEnvelope(marker),
          status: 'PENDING',
          createdAt: at('07'),
        });
      }

      const published: string[] = [];
      const publisher = new StreamPublisher(
        {
          send: (_topic, message) => {
            published.push((JSON.parse(message.value) as MessageEnvelope).source.aggregateId);
            return Promise.resolve();
          },
        },
        HARNESS_STREAM,
        'outbox-ordering-spec',
      );
      const dispatcher = new OutboxDispatcher({ db: tx } as never, new Map([[HARNESS_STREAM.topic.topic, publisher]]), {
        strictPartitionOrdering: true,
      });
      await dispatcher.dispatchPendingEvents();

      expect(published.sort()).toEqual(['N1', 'N2']);
    });
  });
});
