# 이벤트 실패 출구 PR 1 (백엔드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** core·channel-adapter 의 outbox `FAILED` 와 컨슈머 최종 실패를 앱 DB 에 남기고, 같은 `aggregateId` 의 순서를 지키며 그 핸들러에만 다시 넣거나 종결하는 백엔드 API 를 만든다 (#1016 7·8번).

**Architecture:** `@app/events` 에 공용 장치를 둔다 — 컨슈머 실패 기록·보류(`EventRetryInterceptor` 확장 + `DeadLetterStore`), 앱 안 재주입(`DeadLetterRuntime`·`DeadLetterRedriver`), outbox 출구(`OutboxDispatcher` 설정 + `OutboxFailuresService`). 켜는 스위치는 앱이 `EventFailuresModule` 을 import 하는 것 하나다. 컨트롤러는 #705 원칙대로 각 앱이 자기 가드와 함께 선언한다.

**Tech Stack:** NestJS 11 microservices(`ServerKafka`) · kafkajs · drizzle-orm(postgres.js) · prom-client · Jest(`describeIfDb` 통합 스펙은 `npm run test:core:integration:local`)

**Spec:** `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md` — 계획은 스펙을 근거로 한다. 실행자는 둘 다 읽는다.

**선행 조건:** #1073(PR #1074 `c7aa04b04`)이 머지돼 있어야 한다 — 컨슈머 오프셋 커밋이 켜져 있어야 §6.3 «기록 실패 → 커밋 안 됨 → 다시 온다»가 참이다. **배포도 #1074 가 라이브에 나간 뒤**다(Task 14).

## 스펙과 달라진 점 (계획 단계 결정)

| 스펙 | 계획 | 이유 |
| --- | --- | --- |
| §9 라이브러리가 컨트롤러 모듈 제공 | 라이브러리는 서비스만, 컨트롤러는 각 앱 | #705 — 앱마다 전역 가드가 다르다(`EventTraceApiModule` 과 같은 모양). 스펙 머리 노트에 이미 적힘 |
| §6.6 `startConsumer({ deadLetters: { enabled } })` | 앱이 `EventFailuresModule` 을 import 하면 켜진다. `startConsumer` 는 컨테이너에서 `DeadLetterRuntime` 을 찾는다 | 스위치가 둘이면 갈린다. `groupId` 는 `startConsumer` 인자 하나가 정본으로 남는다 |
| §6.3-3 envelope 파싱 실패를 키 없는 `failed` 로 기록 | 하지 않는다 | `EventTypeGuard` 가 파싱 실패 메시지를 핸들러 전에 조용히 거른다 — 재시도 인터셉터의 최종 실패 경로에 파싱 실패가 도달하지 않는다. 대신 `messageId` 가 비면 `topic:partition:offset` 으로 채우는 방어만 둔다 |
| §7.2 서버 참조 «`startConsumer` 가 보관» | `startConsumer` 가 `new ServerKafka(options)` 를 만들어 `{ strategy }` 로 넘긴다 | `NestMicroservice` 의 서버 인스턴스는 private 이다. `strategy` 분기는 같은 서버를 만든다(`nest-microservice.js` `createServer`) |
| §9 channel-adapter 오류 매핑 | 컨트롤러에 `@UseFilters(new GlobalExceptionFilter())` | channel-adapter 는 전역 예외 필터가 없다 — 없으면 `ConflictError` 가 500 이 된다. 앱 전체 필터 추가는 범위 밖 |

## Global Constraints

- outbox 재시도 간격(core·channel-adapter): `[10, 30, 60, 300, 900, 1800, 3600]`초, `maxRetries: 8`. 나머지 4개 앱은 지금 값(`[10, 30, 60, 300]`, 5) 그대로
- 순서 키 = `envelope.source.aggregateId`(컨슈머) / `aggregate_id` 칸(outbox). Kafka 키·`partition_key` 를 쓰지 않는다
- `event.dead_letters.status` ∈ `failed` · `held` · `redriven` · `discarded` (varchar + TS 유니온, pgEnum 아님)
- `event.dead_letters` 유일 키 `(consumer_group, handler, message_id)`
- outbox 종결 상태값 `DISCARDED`. outbox 테이블 스키마(칸·인덱스)는 바꾸지 않는다
- 새 테이블 스키마 파일은 core·channel-adapter `drizzle.config.ts` 에만 넣는다(outbox 처럼 6개 앱에 물리지 않는다)
- 다시 넣기·다시 보내기는 **한 번만 시도**한다
- 다시 넣기 헤더: `x-dead-letter-id`, `x-dead-letter-handler`
- 종결 사유 필수, 최대 500자
- 라우트 접두사: core `/event-failures`, channel-adapter `/adapter/event-failures`
- 라벨에 `aggregate_id`·`event_type` 을 쓰지 않는다(카디널리티, `outbox.metrics.ts` 머리 주석)
- `@Cron` 을 쓰면 바로 윗줄에 `// cron-overlap-safe: <근거>` (CLAUDE.md «크론»)
- 게이트: `npm run type-check` 0 · `npx jest --maxWorkers=2` 실패 0 · `npx jest scripts/security` 통과

## Review Focus

1. **크래시 뒤 재전달** — 이미 `failed` 로 적힌 메시지가 커밋 전에 죽어 다시 오면 행이 늘지 않고, 그 순서는 계속 막혀 있어야 한다 → Task 4 의 «재전달» 테스트
2. **같은 이벤트를 받는 핸들러가 둘** — 다시 넣기는 실패한 핸들러만 다시 돌리고 성공한 쪽은 건드리지 않아야 한다 → Task 6 의 «대상 핸들러만» 테스트
3. **이벤트 종류가 다른 핸들러** — 같은 토픽의 다른 이벤트 핸들러가 남의 순서에 `held` 행을 만들면 안 된다 → Task 6 의 «종류가 다른 핸들러» 테스트
4. **머리 종결 vs 중간 종결** — 머리를 종결하면 뒤가 이어서 흐르고, 중간 `held` 를 종결하면 아무것도 흐르지 않아야 한다 → Task 8
5. **켜는 순간 옛 `FAILED`** — `sequenceByAggregate` 를 켜면 옛 `FAILED` 가 같은 주문의 새 행을 막고, `DISCARDED` 로 바꾸면 풀려야 한다 → Task 2 + Task 14 배포 전 확인

---

## 파일 구조

새로 만드는 것 (`libs/events/src/`):

| 파일 | 책임 |
| --- | --- |
| `dead-letter/dead-letter.schema.ts` | `event.dead_letters`·`event.failure_actions` 테이블 |
| `dead-letter/dead-letter.types.ts` | 상태 유니온, 헤더 이름, `DeadLetterMessage`, `DeadLetterRecorder` port |
| `dead-letter/sequence-lock.ts` | 순서 키 advisory lock 헬퍼 |
| `dead-letter/dead-letter.store.ts` | 보류·기록·다시 넣기 결과 갱신(Drizzle) |
| `dead-letter/failure-action.log.ts` | `failure_actions` 기록·조회 |
| `dead-letter/dead-letter.runtime.ts` | 컨슈머 그룹·서버 참조를 붙들고 한 행을 파이프라인에 다시 태운다 |
| `dead-letter/dead-letter.redriver.ts` | 순서 다시 넣기·종결·전체 다시 넣기 |
| `dead-letter/dead-letter.query.ts` | 요약·순서 목록·상세 |
| `dead-letter/dead-letter.metrics.ts` | `events_dead_letters` 게이지 파사드 |
| `dead-letter/dead-letter-metrics.collector.ts` | 15초 주기 게이지 갱신 |
| `dead-letter/event-failures.module.ts` | 위 provider 묶음 — 앱이 import 하면 켜진다 |
| `dead-letter/event-failures.http.ts` | `DiscardFailureDto`, `actorIdOf` |
| `outbox/outbox-failures.service.ts` | outbox `FAILED` 목록·다시 보내기·종결 |
| `transport/kafka-context.factory.ts` | 레코드 → 진짜 `KafkaContext`, 서버 핸들러 디스패치 |

고치는 것: `outbox/outbox.types.ts`, `outbox/outbox-dispatcher.service.ts`, `interceptors/event-retry.interceptor.ts`, `consumers/consumer-interceptors.ts`, `events.module.ts`, `transport/in-memory.server.ts`, `dlq/dlq-handler.service.ts`, `index.ts` / 앱: core `catalog.module.ts`·`app.module.ts`·새 `modules/event-failures/`, channel-adapter `adapter.module.ts`·새 컨트롤러, membership `admin-operations.controller.ts` / drizzle config 2개 + 생성 마이그 2개 / 문서·스크립트.

---

### Task 1: outbox 재시도 간격을 앱별 설정으로, `DISCARDED` 상태

**Files:**
- Modify: `libs/events/src/outbox/outbox.types.ts`
- Modify: `libs/events/src/outbox/outbox-dispatcher.service.ts`
- Test: `libs/events/src/outbox/outbox-retry-schedule.spec.ts` (새 파일)

**Interfaces:**
- Produces: `OutboxConfig.retryDelaysSeconds?: readonly number[]`, `OutboxConfig.sequenceByAggregate?: boolean`(Task 2 가 씀), `OutboxStatus` 에 `'DISCARDED'`, `nextAttemptDelaySeconds(retryCount: number, delays: readonly number[]): number`, `LONG_OUTBOX_RETRY_DELAYS_SECONDS`, `LONG_OUTBOX_MAX_RETRIES`

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/outbox/outbox-retry-schedule.spec.ts`:

```ts
import {
  LONG_OUTBOX_MAX_RETRIES,
  LONG_OUTBOX_RETRY_DELAYS_SECONDS,
  OUTBOX_RETRY_DELAYS_SECONDS,
  OutboxDispatcher,
  nextAttemptDelaySeconds,
} from './outbox-dispatcher.service';

describe('outbox 재시도 간격 (#1016 7번)', () => {
  it('retryCount 는 실패 후 값이라 1회차 실패가 첫 간격을 쓴다', () => {
    expect(nextAttemptDelaySeconds(1, [10, 30])).toBe(10);
    expect(nextAttemptDelaySeconds(2, [10, 30])).toBe(30);
  });

  it('간격표를 넘으면 마지막 값을 유지한다', () => {
    expect(nextAttemptDelaySeconds(9, [10, 30])).toBe(30);
  });

  it('긴 간격표의 합은 굳기 전 약 2시간이다 — maxRetries 8 이면 7번 기다린다', () => {
    const waits = Array.from({ length: LONG_OUTBOX_MAX_RETRIES - 1 }, (_, i) =>
      nextAttemptDelaySeconds(i + 1, LONG_OUTBOX_RETRY_DELAYS_SECONDS),
    );
    expect(waits).toEqual([10, 30, 60, 300, 900, 1800, 3600]);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(6700);
  });

  it('기본 간격표는 지금 값 그대로다 — 켜지 않은 앱의 동작이 바뀌지 않는다', () => {
    expect(OUTBOX_RETRY_DELAYS_SECONDS).toEqual([10, 30, 60, 300]);
  });

  it('빈 간격표는 생성에서 거부한다 — 0초 재시도 폭주를 막는다', () => {
    expect(() => new OutboxDispatcher({ db: {} } as never, new Map(), { retryDelaysSeconds: [] })).toThrow(
      /retryDelaysSeconds/,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/outbox/outbox-retry-schedule.spec.ts`
Expected: FAIL — `nextAttemptDelaySeconds` / `LONG_OUTBOX_*` 가 export 되지 않음

- [ ] **Step 3: 구현**

`outbox.types.ts` — 상태 유니온과 설정:

```ts
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DISCARDED';
```

`OutboxConfig` 끝(`strictPartitionOrdering` 아래)에 추가:

```ts
  /**
   * 실패 후 다음 시도까지의 대기(초) 표 (#1016 7번). 생략하면 `OUTBOX_RETRY_DELAYS_SECONDS`.
   * 합이 «굳기 전 버티는 시간»이다 — 기본표는 약 7분이라 그보다 긴 Kafka 장애는 행을 전부 `FAILED` 로 굳힌다.
   * `strictPartitionOrdering` 을 켠 앱에서 늘리면 재시도 중인 행이 그 파티션을 그만큼 붙잡는다.
   */
  retryDelaysSeconds?: readonly number[];

  /**
   * 같은 `(topic, aggregate_id)` 의 **더 이른** `PENDING`·`PROCESSING`·`FAILED` 행이 있으면 뒤 행을 고르지 않는다
   * (#1016 7번, 스펙 §8.2). `strictPartitionOrdering` 과 달리 `FAILED` 도 막는다 — 막히는 범위가 주문 하나라
   * 가용성 사고가 아니고, 굳은 앞 행을 사람이 다시 보내거나 종결(`DISCARDED`)하면 풀린다.
   */
  sequenceByAggregate?: boolean;
```

`outbox-dispatcher.service.ts` — 상수 아래에 추가:

```ts
/**
 * 주문 경로 앱(core·channel-adapter)이 쓰는 긴 간격표 (#1016 7번, 스펙 D4). `maxRetries` 8 과 짝이고 합이 약 1시간 52분이다 —
 * 그 안에 끝나는 장애는 사람 없이 풀린다. 마지막 시도까지 기다리는 횟수는 `maxRetries - 1` 이다.
 */
export const LONG_OUTBOX_RETRY_DELAYS_SECONDS = [10, 30, 60, 300, 900, 1800, 3600] as const;
export const LONG_OUTBOX_MAX_RETRIES = 8;

/** `retryCount` 는 실패 **후** 값이다. 표를 넘으면 마지막 값을 유지한다. */
export function nextAttemptDelaySeconds(retryCount: number, delays: readonly number[]): number {
  return delays[Math.min(retryCount - 1, delays.length - 1)];
}
```

`this.config` 타입을 바꾼다 — `Required<OutboxConfig>` 그대로 두면 `retryDelaysSeconds` 가 readonly 배열이라 맞는다. 생성자의 설정 블록:

```ts
    const retryDelaysSeconds = config?.retryDelaysSeconds ?? OUTBOX_RETRY_DELAYS_SECONDS;
    if (retryDelaysSeconds.length === 0 || retryDelaysSeconds.some((s) => !(s > 0))) {
      throw new Error('OutboxConfig.retryDelaysSeconds 는 양수 하나 이상이어야 한다 — 빈 표는 0초 재시도 폭주가 된다');
    }
    this.config = {
      dispatchIntervalMs: config?.dispatchIntervalMs ?? 5000,
      batchSize: config?.batchSize ?? 100,
      maxRetries: config?.maxRetries ?? 5,
      processingTimeoutMs: config?.processingTimeoutMs ?? 300_000,
      cleanupDays: config?.cleanupDays ?? 7,
      strictPartitionOrdering: config?.strictPartitionOrdering ?? false,
      retryDelaysSeconds,
      sequenceByAggregate: config?.sequenceByAggregate ?? false,
    };
```

`calculateNextAttempt`:

```ts
  private calculateNextAttempt(retryCount: number): Date {
    const delay = nextAttemptDelaySeconds(retryCount, this.config.retryDelaysSeconds);
    return new Date(Date.now() + delay * 1000);
  }
```

- [ ] **Step 4: 통과 확인 + 기존 outbox 스펙 회귀**

Run: `npx jest libs/events/src/outbox`
Expected: PASS (`outbox-backoff-lease.spec.ts` 의 «백오프 상한» 테스트 포함 — 기본표 동작이 같다)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/outbox/outbox.types.ts libs/events/src/outbox/outbox-dispatcher.service.ts libs/events/src/outbox/outbox-retry-schedule.spec.ts
git commit -m "feat(events): outbox 재시도 간격을 앱별 설정으로, DISCARDED 상태 (#1016 7번)"
```

---

### Task 2: outbox 같은 주문 순서 지키기 (`sequenceByAggregate`)

**Files:**
- Modify: `libs/events/src/outbox/outbox-dispatcher.service.ts`
- Test: `libs/events/src/outbox/outbox-aggregate-sequence.integration.spec.ts` (새 파일)

**Interfaces:**
- Consumes: Task 1 의 `OutboxConfig.sequenceByAggregate`
- Produces: 디스패처 선택 조건(외부 표면 없음)

- [ ] **Step 1: 실패하는 통합 테스트**

`libs/events/src/outbox/outbox-aggregate-sequence.integration.spec.ts` — `outbox-partition-ordering.integration.spec.ts` 의 하네스를 그대로 따른다(롤백 트랜잭션, 케이스마다 테이블 비우기):

```ts
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
import { outbox_events } from './outbox.schema';

const HARNESS_STREAM = stream({
  topic: 'outbox-aggregate-sequence.harness.v1',
  partitions: 1,
  aggregateType: 'SequenceHarness',
  events: { Moved: event('Moved', z.object({ step: z.number().int() })) },
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type SeedRow = { marker: string; aggregateId: string; createdAt: Date; status?: 'PENDING' | 'FAILED' | 'DISCARDED' };
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

  async function dispatchOnce(tx: Db, rows: SeedRow[], sequenceByAggregate: boolean): Promise<string[]> {
    await tx.delete(outbox_events);
    for (const row of rows) {
      await tx.insert(outbox_events).values({
        topic: HARNESS_STREAM.topic.topic,
        aggregateType: HARNESS_STREAM.aggregateType,
        aggregateId: row.aggregateId,
        eventType: 'Moved',
        // 모든 행이 같은 파티션 키 — channel-adapter 처럼 «채널 이름» 하나라도 주문별로 갈려야 한다
        partitionKey: 'medusa',
        payload: envelope(row.marker, row.aggregateId),
        status: row.status ?? 'PENDING',
        retryCount: row.status === 'FAILED' ? 8 : 0,
        createdAt: row.createdAt,
      });
    }
    const published: string[] = [];
    const publisher = new StreamPublisher(
      {
        send: (_topic, message) => {
          published.push((JSON.parse(message.value) as MessageEnvelope).messageId.replace('msg-', ''));
          return Promise.resolve();
        },
      },
      HARNESS_STREAM,
      'outbox-aggregate-sequence-spec',
    );
    const dispatcher = new OutboxDispatcher({ db: tx } as never, new Map([[HARNESS_STREAM.topic.topic, publisher]]), {
      sequenceByAggregate,
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
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- outbox-aggregate-sequence`
Expected: FAIL — «켜면» 케이스에서 `['A2', 'B1']` (조건이 아직 없다). «대조군»·«DISCARDED» 는 통과

- [ ] **Step 3: 구현**

`partitionOrderCondition()` 아래에 추가:

```ts
  /**
   * 같은 `(topic, aggregate_id)` 의 **더 이른** 미발행·굳은 행이 있으면 후보에서 뺀다 (#1016 7번, 스펙 §8.2).
   *
   * 키가 `partition_key` 가 아니라 `aggregate_id` 인 이유: channel-adapter 는 주문 이벤트의 파티션 키가 채널
   * 이름이라 그 키로 막으면 채널 전체가 멈춘다. 주문 하나를 가리키는 것은 `aggregate_id` 다.
   * `FAILED` 를 막는 것이 `partitionOrderCondition` 과 반대인 이유는 `OutboxConfig.sequenceByAggregate` 주석.
   * 새 인덱스 없이 기존 `outbox_status_idx (status, created_at)` 가 받는다 — 미발행 상태만 보고 `PUBLISHED` 는 7일 뒤 지워진다.
   */
  private aggregateSequenceCondition(): SQL | undefined {
    if (!this.config.sequenceByAggregate) return undefined;

    return sql`not exists (
      select 1
      from ${outbox_events} previous
      where previous.topic = ${outbox_events.topic}
        and previous.aggregate_id = ${outbox_events.aggregateId}
        and previous.status in ('PENDING', 'PROCESSING', 'FAILED')
        and (
          previous.created_at < ${outbox_events.createdAt}
          or (previous.created_at = ${outbox_events.createdAt} and previous.id < ${outbox_events.id})
        )
    )`;
  }
```

`acquireEventBatch` 의 `and(...)` 안, `this.partitionOrderCondition(),` 다음 줄에:

```ts
            // 같은 주문의 순서 (#1016 7번). 선택 단계에서 거는 이유는 위 두 조건과 같다.
            this.aggregateSequenceCondition(),
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:core:integration:local -- "outbox-(aggregate-sequence|partition-ordering)"`
Expected: PASS (기존 파티션 순서 스펙 회귀 없음)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/outbox/outbox-dispatcher.service.ts libs/events/src/outbox/outbox-aggregate-sequence.integration.spec.ts
git commit -m "feat(events): outbox 같은 주문 순서 지키기 — 굳은 앞 행이 뒤 행을 막는다 (#1016 7번)"
```

---

### Task 3: 실패 테이블 스키마와 마이그레이션 (core·channel-adapter)

**Files:**
- Create: `libs/events/src/dead-letter/dead-letter.schema.ts`
- Create: `libs/events/src/dead-letter/dead-letter.types.ts`
- Modify: `apps/core/drizzle.config.ts`, `apps/channel-adapter/drizzle.config.ts`
- Generate: `apps/core/drizzle/<ts>_add-event-dead-letters.sql`, `apps/channel-adapter/drizzle/<ts>_add-event-dead-letters.sql` + 각 `meta/`
- Test: `libs/events/src/dead-letter/dead-letter.schema.spec.ts` (새 파일)

**Interfaces:**
- Produces: `dead_letters`, `failure_actions`, `deadLetterSchema`, `DeadLetterStatus`, `UNRESOLVED_DEAD_LETTER_STATUSES`, `DEAD_LETTER_HEADERS`, `DeadLetterMessage`, `DeadLetterRecorder`, `DeadLetterRow`, `FailureActionKind`

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/dead-letter/dead-letter.schema.spec.ts` — 스키마 파일이 두 앱에만 물려 있는지 고정한다(outbox 처럼 6개 앱에 번지면 무관한 `db:generate` 가 이 테이블을 끼워 넣는다):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { dead_letters, failure_actions } from './dead-letter.schema';

const ROOT = join(__dirname, '../../../..');
const SCHEMA_PATH = 'libs/events/src/dead-letter/dead-letter.schema.ts';

describe('event.dead_letters 스키마 (#1016 8번)', () => {
  it('켜는 앱(core·channel-adapter)의 drizzle config 에만 물린다', () => {
    const configs = ['core', 'channel-adapter', 'wallet', 'membership', 'analytics', 'file-service'];
    const holders = configs.filter((app) =>
      readFileSync(join(ROOT, `apps/${app}/drizzle.config.ts`), 'utf8').includes(SCHEMA_PATH),
    );
    expect(holders).toEqual(['core', 'channel-adapter']);
  });

  it('유일 키는 (consumer_group, handler, message_id) 다 — 재전달이 행을 늘리지 않는다', () => {
    const config = getTableConfig(dead_letters);
    const unique = config.indexes.find((index) => index.config.name === 'uq_dead_letters_group_handler_message');
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'consumer_group',
      'handler',
      'message_id',
    ]);
  });

  it('두 테이블 모두 event 스키마에 있다', () => {
    expect(getTableConfig(dead_letters).schema).toBe('event');
    expect(getTableConfig(failure_actions).schema).toBe('event');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/dead-letter/dead-letter.schema.spec.ts`
Expected: FAIL — `Cannot find module './dead-letter.schema'`

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/dead-letter.types.ts`:

```ts
/**
 * 컨슈머 실패 기록 (#1016 8번, 스펙 §5·§6). 상태는 varchar + 이 유니온 — pgEnum 은 값을 더할 때마다 마이그가 필요하다.
 *
 * - `failed`: 처리하다 실패했다(순서의 머리)
 * - `held`: 앞 실패 때문에 처리하지 않고 보관했다
 * - `redriven`: 다시 넣어서 성공했다
 * - `discarded`: 사람이 종결했다
 */
export type DeadLetterStatus = 'failed' | 'held' | 'redriven' | 'discarded';
export const UNRESOLVED_DEAD_LETTER_STATUSES = ['failed', 'held'] as const;

/** 다시 넣기로 들어온 메시지의 표시 (스펙 §6.4). 이 헤더가 있으면 보류 검사를 건너뛰고 한 번만 시도한다. */
export const DEAD_LETTER_HEADERS = {
  id: 'x-dead-letter-id',
  handler: 'x-dead-letter-handler',
} as const;

export type FailureActionKind = 'dead_letter' | 'outbox';
export type FailureAction = 'redrive' | 'discard';
export type FailureActionOutcome = 'succeeded' | 'failed';

/** 인터셉터가 한 메시지에 대해 아는 것. 저장은 이 모양 그대로다. */
export interface DeadLetterMessage {
  consumerGroup: string;
  /** `클래스.메서드` — 같은 이벤트를 받는 핸들러가 둘 이상일 때 대상을 가른다 */
  handler: string;
  topic: string;
  /** `envelope.source.aggregateId`. 없으면 null — 그 행은 혼자 한 순서다 */
  sequenceKey: string | null;
  messageId: string;
  eventType: string | null;
  envelope: unknown;
  kafkaPartition: number;
  kafkaOffset: string;
}

/**
 * 인터셉터가 쓰는 쓰기 port. 테스트는 메모리 구현을 넣는다 — 진짜 구현(`DeadLetterStore`)의 SQL 은 통합 스펙이 본다.
 * 모든 메서드는 실패하면 던진다. 인터셉터가 그것을 `DlqDeliveryError` 로 바꿔 오프셋을 커밋하지 않게 한다.
 */
export interface DeadLetterRecorder {
  /** 같은 순서에 안 푼 행이 있으면 이 메시지를 `held` 로 적고 true. 없으면 아무것도 안 적고 false */
  holdIfBlocked(message: DeadLetterMessage): Promise<boolean>;
  /** 최종 실패를 `failed` 로 적는다. 같은 유일 키가 있으면 그 행을 갱신한다 */
  recordFailure(message: DeadLetterMessage, error: Error): Promise<void>;
  /** 다시 넣기 성공 */
  markRedriven(id: number): Promise<void>;
  /** 다시 넣기 실패 — 그 행을 `failed` 로(머리가 된다) */
  recordRedriveFailure(id: number, error: Error): Promise<void>;
}

export interface DeadLetterRow {
  id: number;
  consumerGroup: string;
  handler: string;
  topic: string;
  sequenceKey: string | null;
  messageId: string;
  eventType: string | null;
  envelope: unknown;
  kafkaPartition: number;
  kafkaOffset: string;
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  redriveCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  resolvedAt: Date | null;
}
```

`libs/events/src/dead-letter/dead-letter.schema.ts`:

```ts
import { bigserial, index, integer, jsonb, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { eventSchema } from '../outbox/outbox.schema';

/**
 * 컨슈머 실패 기록 (#1016 8번, 스펙 §5.1). **켜는 앱(core·channel-adapter)의 drizzle config 에만** 물린다 —
 * outbox 스키마처럼 6개 앱에 물리면 무관한 `db:generate` 가 이 테이블을 조용히 끼워 넣는다
 * (`dead-letter.schema.spec.ts` 가 지킨다).
 *
 * 시각 칸은 전부 `withTimezone` 이다 — `now()` 와 JS `Date` 를 섞어 쓰고 서로 비교한다(outbox 의 `next_attempt_at` 주석과 같은 이유).
 */
export const dead_letters = eventSchema.table(
  'dead_letters',
  {
    id: serial('id').primaryKey(),
    consumerGroup: varchar('consumer_group', { length: 200 }).notNull(),
    handler: varchar('handler', { length: 200 }).notNull(),
    topic: varchar('topic', { length: 100 }).notNull(),
    sequenceKey: varchar('sequence_key', { length: 200 }),
    messageId: varchar('message_id', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 100 }),
    envelope: jsonb('envelope').notNull(),
    kafkaPartition: integer('kafka_partition').notNull(),
    kafkaOffset: varchar('kafka_offset', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    errorName: varchar('error_name', { length: 200 }),
    errorMessage: text('error_message'),
    redriveCount: integer('redrive_count').notNull().default(0),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }).notNull().defaultNow(),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    uqGroupHandlerMessage: uniqueIndex('uq_dead_letters_group_handler_message').on(
      table.consumerGroup,
      table.handler,
      table.messageId,
    ),
    // 보류 검사와 순서 조회가 탄다. 안 푼 행만 담아 작게 유지한다.
    unresolvedSequenceIdx: index('dead_letters_unresolved_sequence_idx')
      .on(table.consumerGroup, table.topic, table.sequenceKey, table.id)
      .where(sql`status in ('failed', 'held')`),
  }),
);

/** 사람이 한 조치 (스펙 §5.2). outbox 행과 dead letter 둘 다 여기 남는다 — outbox 테이블엔 칸을 더하지 않는다. */
export const failure_actions = eventSchema.table(
  'failure_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    targetKind: varchar('target_kind', { length: 20 }).notNull(),
    targetId: integer('target_id').notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    actor: varchar('actor', { length: 100 }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index('failure_actions_target_idx').on(table.targetKind, table.targetId),
  }),
);

export const deadLetterSchema = { dead_letters, failure_actions };
```

두 drizzle config 의 `schema` 배열, `'./libs/events/src/tracking/tracking.schema.ts'`(core) / `'libs/events/src/tracking/tracking.schema.ts'`(channel-adapter) 다음 줄에:

```ts
    './libs/events/src/dead-letter/dead-letter.schema.ts',
```

(channel-adapter 는 기존 항목처럼 `./` 없이 `'libs/events/src/dead-letter/dead-letter.schema.ts'` — 스펙 테스트는 경로 부분일치로 본다.)

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx jest libs/events/src/dead-letter/dead-letter.schema.spec.ts`
Expected: PASS

- [ ] **Step 5: 마이그레이션 생성·검토**

```bash
npm run db:generate:core -- --name add-event-dead-letters
npm run db:generate:channel-adapter -- --name add-event-dead-letters
```

생성된 두 SQL 을 연다. **`CREATE TABLE "event"."dead_letters"`·`"event"."failure_actions"` 와 인덱스 3개만** 있어야 한다. 다른 테이블의 `ALTER`·`DROP` 이 섞였으면(누군가의 미반영 스키마 변경) `git rm` 하고 원인을 먼저 본다 — 고쳐 쓰지 않는다(CLAUDE.md).

부분 인덱스의 `WHERE` 가 `status in ('failed', 'held')` 로 나왔는지 확인한다.

- [ ] **Step 6: 로컬 적용**

```bash
npm run test:core:integration:local -- dead-letter.schema
```

이 러너가 core 마이그를 적용한다(no-op 이면 이미 적용). channel-adapter 는 `npm run db:setup -- --stage dev --deployment lcnine-services` 로 적용하거나 Task 13 의 로컬 E2E bootstrap 이 적용한다.

- [ ] **Step 7: 커밋 (스키마 + SQL + meta 한 커밋 — CLAUDE.md)**

```bash
git add libs/events/src/dead-letter/dead-letter.schema.ts libs/events/src/dead-letter/dead-letter.types.ts \
  libs/events/src/dead-letter/dead-letter.schema.spec.ts apps/core/drizzle.config.ts apps/channel-adapter/drizzle.config.ts \
  apps/core/drizzle apps/channel-adapter/drizzle
git commit -m "feat(events): event.dead_letters·failure_actions 테이블 — core·channel-adapter (#1016 8번)"
```

---

### Task 4: `DeadLetterStore` — 보류·기록·다시 넣기 결과

**Files:**
- Create: `libs/events/src/dead-letter/sequence-lock.ts`
- Create: `libs/events/src/dead-letter/dead-letter.store.ts`
- Test: `libs/events/src/dead-letter/dead-letter.store.integration.spec.ts`

**Interfaces:**
- Consumes: Task 3 의 테이블·타입
- Produces: `class DeadLetterStore implements DeadLetterRecorder` (생성자 `(dbService: DbService)`), `lockSequence(tx, key: SequenceLockKey): Promise<void>`, `tryLockSequence(tx, key): Promise<boolean>`, `type SequenceLockKey = { consumerGroup: string; topic: string; sequenceKey: string | null; rowId?: number }`

- [ ] **Step 1: 실패하는 통합 테스트**

`libs/events/src/dead-letter/dead-letter.store.integration.spec.ts`:

```ts
/**
 * DeadLetterStore — 실제 Postgres (#1016 8번, 스펙 §6.2·§6.3)
 * 실행: `npm run test:core:integration:local -- dead-letter.store`
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

  const message = (messageId: string, sequenceKey: string | null = 'order-A', handler = 'C.onCreated'): DeadLetterMessage => ({
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- dead-letter.store`
Expected: FAIL — `Cannot find module './dead-letter.store'`

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/sequence-lock.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** 이 파일이 쓰는 것은 `execute` 하나다 — 트랜잭션 객체와 db 둘 다 받는다. */
type Executor = Pick<PostgresJsDatabase<Record<string, never>>, 'execute'>;

export interface SequenceLockKey {
  consumerGroup: string;
  topic: string;
  sequenceKey: string | null;
  /** 순서 키가 없는 행은 그 행 혼자 한 순서다 — 행 id 로 잠근다 */
  rowId?: number;
}

/**
 * 순서 키별 트랜잭션 advisory lock (스펙 §6.2·§7.4). 실시간 보류 검사와 다시 넣기의 «남은 게 없다» 판정을
 * 직렬화한다 — 겹치면 아무도 깨우지 않는 `held` 가 생긴다. 구분자로 NUL 을 쓰는 것은 그룹·토픽·키가 서로의
 * 접두사가 되어도 같은 해시 입력이 나오지 않게 하기 위해서다.
 */
function lockText(key: SequenceLockKey): string {
  const sequence = key.sequenceKey ?? `row:${key.rowId ?? 'none'}`;
  return `dead-letter\u0000${key.consumerGroup}\u0000${key.topic}\u0000${sequence}`;
}

/** 기다린다 — 실시간 소비가 쓴다 */
export async function lockSequence(executor: Executor, key: SequenceLockKey): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockText(key)}, 0))`);
}

/** 기다리지 않는다 — 다시 넣기가 쓴다. 못 잡으면 false(이미 진행 중) */
export async function tryLockSequence(executor: Executor, key: SequenceLockKey): Promise<boolean> {
  const rows = await executor.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${lockText(key)}, 0)) as locked`,
  );
  return rows[0]?.locked === true;
}
```

`libs/events/src/dead-letter/dead-letter.store.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { dead_letters } from './dead-letter.schema';
import { lockSequence } from './sequence-lock';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterMessage, type DeadLetterRecorder } from './dead-letter.types';

/** 오류 문장은 진단용이다 — 스택이 수 KB 로 커지는 것을 막는다 */
const MAX_ERROR_MESSAGE = 2000;

function toInsert(message: DeadLetterMessage) {
  return {
    consumerGroup: message.consumerGroup,
    handler: message.handler,
    topic: message.topic,
    sequenceKey: message.sequenceKey,
    messageId: message.messageId,
    eventType: message.eventType,
    envelope: message.envelope,
    kafkaPartition: message.kafkaPartition,
    kafkaOffset: message.kafkaOffset,
  };
}

/**
 * 컨슈머 실패의 쓰기 쪽 (#1016 8번, 스펙 §6). 인터셉터가 `DeadLetterRecorder` 로 부른다.
 * 조회·다시 넣기는 `DeadLetterQueryService`·`DeadLetterRedriver` 가 한다.
 */
@Injectable()
export class DeadLetterStore implements DeadLetterRecorder {
  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  async holdIfBlocked(message: DeadLetterMessage): Promise<boolean> {
    if (message.sequenceKey === null) return false;

    return this.db.transaction(async (tx) => {
      await lockSequence(tx, message);
      const [blocking] = await tx
        .select({ id: dead_letters.id })
        .from(dead_letters)
        .where(
          and(
            eq(dead_letters.consumerGroup, message.consumerGroup),
            eq(dead_letters.topic, message.topic),
            eq(dead_letters.sequenceKey, message.sequenceKey as string),
            inArray(dead_letters.status, [...UNRESOLVED_DEAD_LETTER_STATUSES]),
          ),
        )
        .limit(1);
      if (!blocking) return false;

      // 재전달된 같은 메시지면 유일 키 충돌로 아무것도 안 적는다 — 그래도 막혀 있으니 true 다(스펙 §7.4 마지막 줄).
      await tx
        .insert(dead_letters)
        .values({ ...toInsert(message), status: 'held' })
        .onConflictDoNothing({ target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId] });
      return true;
    });
  }

  async recordFailure(message: DeadLetterMessage, error: Error): Promise<void> {
    const errorMessage = error.message.slice(0, MAX_ERROR_MESSAGE);
    await this.db
      .insert(dead_letters)
      .values({ ...toInsert(message), status: 'failed', errorName: error.name, errorMessage })
      .onConflictDoUpdate({
        target: [dead_letters.consumerGroup, dead_letters.handler, dead_letters.messageId],
        set: { status: 'failed', errorName: error.name, errorMessage, lastFailedAt: sql`now()` },
      });
  }

  async markRedriven(id: number): Promise<void> {
    await this.db
      .update(dead_letters)
      .set({ status: 'redriven', redriveCount: sql`${dead_letters.redriveCount} + 1`, resolvedAt: sql`now()` })
      .where(eq(dead_letters.id, id));
  }

  async recordRedriveFailure(id: number, error: Error): Promise<void> {
    await this.db
      .update(dead_letters)
      .set({
        status: 'failed',
        redriveCount: sql`${dead_letters.redriveCount} + 1`,
        errorName: error.name,
        errorMessage: error.message.slice(0, MAX_ERROR_MESSAGE),
        lastFailedAt: sql`now()`,
      })
      .where(eq(dead_letters.id, id));
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:core:integration:local -- dead-letter.store`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/dead-letter/sequence-lock.ts libs/events/src/dead-letter/dead-letter.store.ts libs/events/src/dead-letter/dead-letter.store.integration.spec.ts
git commit -m "feat(events): DeadLetterStore — 보류·실패 기록·다시 넣기 결과 (#1016 8번)"
```

---

### Task 5: 레코드 → `KafkaContext` 조립을 한 곳으로

**Files:**
- Create: `libs/events/src/transport/kafka-context.factory.ts`
- Modify: `libs/events/src/transport/in-memory.server.ts`
- Test: `libs/events/src/transport/kafka-context.factory.spec.ts`

**Interfaces:**
- Produces: `buildKafkaContext(record: BrokerRecord, heartbeat: () => Promise<void>): { context: KafkaContext; data: unknown }`, `dispatchToServerHandler(server: Server, record: BrokerRecord): Promise<boolean>`(핸들러가 없으면 false)

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/transport/kafka-context.factory.spec.ts`:

```ts
import { KafkaContext, Server } from '@nestjs/microservices';
import { of } from 'rxjs';
import { buildKafkaContext, dispatchToServerHandler } from './kafka-context.factory';
import type { BrokerRecord } from './in-memory.broker';

const record = (headers: Record<string, string> = {}): BrokerRecord => ({
  topic: 'orders.events.v1',
  partition: 2,
  offset: '41',
  key: 'medusa',
  value: JSON.stringify({ messageId: 'm1', messageType: 'OrderCreated' }),
  headers,
  timestamp: '0',
});

describe('kafka-context.factory (#1016 8번)', () => {
  it('운영과 같이 value 를 JSON 객체로 파싱한 진짜 KafkaContext 를 만든다', () => {
    const { context, data } = buildKafkaContext(record({ 'x-dead-letter-id': '9' }), async () => undefined);
    expect(context).toBeInstanceOf(KafkaContext);
    expect(context.getTopic()).toBe('orders.events.v1');
    expect(context.getPartition()).toBe(2);
    expect(data).toEqual({ messageId: 'm1', messageType: 'OrderCreated' });
    expect(String(context.getMessage().headers?.['x-dead-letter-id'])).toBe('9');
  });

  it('consumer·producer 를 쓰면 즉시 던진다 — 이 경로가 무엇을 보장하지 않는지 드러낸다', () => {
    const { context } = buildKafkaContext(record(), async () => undefined);
    expect(() => context.getConsumer().commitOffsets).toThrow(/제공하지 않는다/);
  });

  it('서버의 토픽 핸들러를 부르고, Observable 이면 끝까지 기다린다', async () => {
    const seen: unknown[] = [];
    const server = {
      getHandlerByPattern: (pattern: string) =>
        pattern === 'orders.events.v1'
          ? async (data: unknown) => {
              seen.push(data);
              return of('done');
            }
          : null,
    } as unknown as Server;

    await expect(dispatchToServerHandler(server, record())).resolves.toBe(true);
    expect(seen).toHaveLength(1);
  });

  it('핸들러가 없는 토픽이면 false', async () => {
    const server = { getHandlerByPattern: () => null } as unknown as Server;
    await expect(dispatchToServerHandler(server, record())).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/transport/kafka-context.factory.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`libs/events/src/transport/kafka-context.factory.ts` — `InMemoryServer` 의 조립부를 옮긴다(주석의 «왜 진짜 KafkaContext 인가»·«왜 KafkaParser 인가» 근거도 함께 옮긴다):

```ts
/**
 * 레코드 → 진짜 `KafkaContext` (#1016 8번 다시 넣기 + `InMemoryServer`).
 *
 * 진짜 `KafkaContext` 여야 하는 이유: `EventRetryInterceptor`·`EventTypeGuard`·`SchemaValidationInterceptor` 가
 * `instanceof KafkaContext` 로 게이트한다. 손으로 만든 객체를 넣으면 재시도·분류·검증이 통째로 건너뛰어진다.
 * `KafkaParser` 를 쓰는 이유: Nest 는 수신 `value` 를 JSON 파싱해서 넘긴다 — 운영과 같은 것을 넘겨야 한다.
 */
import { KafkaContext, KafkaParser, Server } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import type { BrokerRecord } from './in-memory.broker';

const parser = new KafkaParser();

/**
 * `KafkaContext` 가 요구하지만 이 경로에서 의미가 없는 협력자들. 호출되면 조용히 통과하지 않고 즉시 던진다.
 *
 * as 정당화: Nest 의 `Consumer`/`Producer` 타입은 공개 표면에 없고(`external/kafka.interface`), 우리 코드가 실제로 쓰는 것은
 * `getHeartbeat()` 뿐이다.
 */
function unsupportedCollaborator<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `KafkaContext.${name}().${String(property)} 는 이 경로(인메모리·다시 넣기)가 제공하지 않는다. ` +
            `이 경로를 검증해야 한다면 실제 브로커가 필요하다.`,
        );
      },
    },
  ) as T;
}

export function buildKafkaContext(
  record: BrokerRecord,
  heartbeat: () => Promise<void>,
): { context: KafkaContext; data: unknown } {
  const rawMessage = parser.parse<Record<string, unknown>>({
    topic: record.topic,
    partition: record.partition,
    key: Buffer.from(record.key),
    value: Buffer.from(record.value),
    headers: Object.fromEntries(Object.entries(record.headers).map(([name, value]) => [name, Buffer.from(value)])),
    timestamp: record.timestamp,
    offset: record.offset,
    size: Buffer.byteLength(record.value),
    attributes: 0,
  });
  const context = new KafkaContext([
    // as 정당화: `parser.parse` 의 반환은 입력 형태를 따르는 제네릭이라 Nest 내부 `KafkaMessage` 로 좁혀지지 않는다.
    rawMessage as never,
    record.partition,
    record.topic,
    unsupportedCollaborator('getConsumer'),
    heartbeat,
    unsupportedCollaborator('getProducer'),
  ]);
  // KafkaRequestDeserializer.mapToSchema 와 동일: value 가 있으면 value, 없으면 메시지 전체
  return { context, data: rawMessage.value ?? rawMessage };
}

/**
 * 서버에 등록된 토픽 핸들러를 한 번 부르고 끝까지 기다린다 — `ServerKafka.handleEvent` 가 `lastValueFrom` 으로 기다리는 것과
 * 같은 의미다(#1073). 같은 토픽의 다중 핸들러는 `handlerRef.next` 로 Nest 가 순회하므로 한 번만 부른다.
 * 처리 시작·끝 훅(`onProcessingStartHook`)은 부르지 않는다 — protected 이고, 기본값은 `done()` 을 그대로 부를 뿐이다.
 */
export async function dispatchToServerHandler(server: Server, record: BrokerRecord): Promise<boolean> {
  const handler = server.getHandlerByPattern(record.topic);
  if (!handler) return false;
  const { context, data } = buildKafkaContext(record, async () => undefined);
  const resultOrStream: unknown = await handler(data, context);
  if (isObservable(resultOrStream)) {
    await lastValueFrom(resultOrStream, { defaultValue: undefined });
  }
  return true;
}
```

`in-memory.server.ts` — `unsupportedCollaborator`·`parser` 필드와 `dispatch` 의 조립부를 지우고 새 함수를 쓴다(머리 주석의 «왜 진짜 KafkaContext» 두 절은 «`kafka-context.factory.ts` 참조» 한 줄로 줄인다):

```ts
import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import { BrokerRecord, InMemoryBroker } from './in-memory.broker';
import { buildKafkaContext } from './kafka-context.factory';
```

```ts
  private async dispatch(record: BrokerRecord): Promise<void> {
    const handler = this.getHandlerByPattern(record.topic);
    if (!handler) {
      // 아무도 구독하지 않은 토픽 — Kafka 였다면 배달 자체가 없다
      return;
    }
    const { context, data } = buildKafkaContext(record, async () => {
      /* heartbeat — EventRetryInterceptor 가 backoff 중 호출한다 */
    });
    // 기본 훅은 `done()` 의 Promise 를 그대로 반환하지만 (`server.js:19`) Nest 타입은 반환을 void 로 선언한다.
    const settled: unknown = this.onProcessingStartHook(this.transportId, context, async () => {
      const resultOrStream: unknown = await handler(data, context);
      if (isObservable(resultOrStream)) {
        await lastValueFrom(resultOrStream, { defaultValue: undefined });
        this.onProcessingEndHook?.(this.transportId, context);
      }
    });
    if (settled instanceof Promise) {
      await settled;
    }
  }
```

`index.ts` 의 transport 블록에 `export * from './transport/kafka-context.factory';` 를 더한다.

- [ ] **Step 4: 통과 + 하네스 회귀**

Run: `npx jest libs/events/src/transport`
Expected: PASS (`round-trip`·`handler-failure`·`start-consumer`·`consume-validation` 포함)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/transport/kafka-context.factory.ts libs/events/src/transport/kafka-context.factory.spec.ts libs/events/src/transport/in-memory.server.ts libs/events/src/index.ts
git commit -m "refactor(events): 레코드 → KafkaContext 조립을 한 곳으로 — 다시 넣기가 같은 것을 쓴다 (#1016 8번)"
```

---

### Task 6: `EventRetryInterceptor` — 보류 검사·실패 기록·다시 넣기 모드

**Files:**
- Modify: `libs/events/src/interceptors/event-retry.interceptor.ts`
- Modify: `libs/events/src/consumers/consumer-interceptors.ts`
- Test: `libs/events/src/dead-letter/dead-letter-interceptor.spec.ts` (새 파일)

**Interfaces:**
- Consumes: Task 3 `DeadLetterRecorder`·`DeadLetterMessage`·`DEAD_LETTER_HEADERS`, Task 5 (테스트가 `InMemoryServer` 경유)
- Produces: `EventRetryInterceptor` 생성자 3번째 인자 `deadLetters?: DeadLetterInterceptorOptions` (`{ recorder: DeadLetterRecorder; consumerGroup: string }`), 토큰 `DEAD_LETTER_INTERCEPTOR_OPTIONS`, `buildConsumerInterceptors(app, streams, deadLetters?)`, `optionalGet` export, `handlerIdOf(cls, handler): string`

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/dead-letter/dead-letter-interceptor.spec.ts` — 메모리 recorder 로 인메모리 파이프라인 전체를 탄다. 앱은 `startConsumer` 대신 `connectMicroservice` + `buildConsumerInterceptors` 를 직접 써서 recorder 를 넣는다(Task 7 이 `startConsumer` 배선을 붙인 뒤에도 이 스펙은 인터셉터만 본다):

```ts
import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { NestMicroservice } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { EventEnvelope, EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import { buildConsumerInterceptors } from '../consumers/consumer-interceptors';
import { DEAD_LETTER_HEADERS, type DeadLetterMessage, type DeadLetterRecorder } from './dead-letter.types';

const TOPIC = CART_STREAM.topic.topic;

/** 메모리 recorder — SQL 은 Task 4 통합 스펙이 본다. 여기선 «인터셉터가 언제 무엇을 부르나»만 본다 */
class MemoryRecorder implements DeadLetterRecorder {
  rows: Array<DeadLetterMessage & { id: number; status: string; error?: string }> = [];
  private nextId = 1;
  async holdIfBlocked(m: DeadLetterMessage) {
    const blocked = this.rows.some(
      (r) => r.topic === m.topic && r.sequenceKey === m.sequenceKey && ['failed', 'held'].includes(r.status),
    );
    if (blocked && !this.rows.some((r) => r.handler === m.handler && r.messageId === m.messageId)) {
      this.rows.push({ ...m, id: this.nextId++, status: 'held' });
    }
    return blocked;
  }
  async recordFailure(m: DeadLetterMessage, e: Error) {
    this.rows.push({ ...m, id: this.nextId++, status: 'failed', error: e.message });
  }
  async markRedriven(id: number) {
    this.rows.find((r) => r.id === id)!.status = 'redriven';
  }
  async recordRedriveFailure(id: number, e: Error) {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = 'failed';
    row.error = e.message;
  }
}

const calls: string[] = [];
let failCreated = false;

@Controller()
@UseInterceptors(EventTypeGuard)
class CartConsumer {
  @RetryPolicy({ maxRetries: 1, backoff: 'fixed', initialDelayMs: 1 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { id: string }) {
    calls.push(`created:${payload.id}`);
    if (failCreated) throw new Error('created failed');
  }

  @On(CART_STREAM, 'CartUpdated')
  onUpdated(@EventPayload() payload: { id: string }) {
    calls.push(`updated:${payload.id}`);
  }
}

/** 같은 이벤트를 받는 두 번째 핸들러 — 다시 넣기가 이쪽을 건드리면 안 된다(Review Focus 2) */
@Controller()
@UseInterceptors(EventTypeGuard)
class CartAuditConsumer {
  @On(CART_STREAM, 'CartCreated')
  onCreatedAudit(@EventPayload() payload: { id: string }, @EventEnvelope() _e: unknown) {
    calls.push(`audit:${payload.id}`);
  }
}

const kafka = { clientId: 'dead-letter-interceptor-spec', brokers: ['unused:9092'] };
const cart = (id: string) => ({ id, customerId: 'c', regionId: 'r', createdAt: new Date().toISOString() });

describe('EventRetryInterceptor — dead letter 모드 (#1016 8번)', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;
  let recorder: MemoryRecorder;
  let publisher: StreamPublisher<typeof CART_STREAM.events>;

  beforeEach(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    calls.length = 0;
    failCreated = false;
    broker = new InMemoryBroker();
    recorder = new MemoryRecorder();
    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'dl-spec', kafka })],
      controllers: [CartConsumer, CartAuditConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    const microservice = app.connectMicroservice(
      { strategy: new InMemoryServer(broker) },
      { deferInitialization: true },
    ) as NestMicroservice;
    microservice.useGlobalInterceptors(
      ...buildConsumerInterceptors(app, [CART_STREAM], { recorder, consumerGroup: 'spec-group' }),
    );
    microservice.registerListeners();
    microservice.setIsInitialized(true);
    microservice.setIsInitHookCalled(true);
    await app.startAllMicroservices();
    await app.init();
    publisher = app.get(EventsModule.getPublisherToken(TOPIC));
  });

  afterEach(async () => {
    await app.close();
  });

  it('최종 실패를 recorder 에 적고 .dlq 토픽으로는 보내지 않는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(recorder.rows.map((r) => [r.handler, r.status, r.sequenceKey])).toEqual([
      ['CartConsumer.onCreated', 'failed', 'cart-1'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
    expect(broker.deliveryFailures).toHaveLength(0);
  });

  it('같은 순서 키의 뒤 메시지는 핸들러를 부르지 않고 held 로 적는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    calls.length = 0;
    await publisher.publishEvent({ eventType: 'CartUpdated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(calls).toEqual([]);
    expect(recorder.rows.map((r) => [r.handler, r.status])).toContainEqual(['CartConsumer.onUpdated', 'held']);
  });

  it('이벤트 종류가 다른 핸들러는 보류 검사를 하지 않는다 — 가짜 held 가 생기지 않는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    await publisher.publishEvent({ eventType: 'CartUpdated', aggregateId: 'cart-1', payload: cart('cart-1') });

    // onUpdated 는 CartCreated 를 받지 않고, onCreated·onCreatedAudit 는 CartUpdated 를 받지 않는다
    const heldHandlers = recorder.rows.filter((r) => r.status === 'held').map((r) => r.handler);
    expect(heldHandlers).toEqual(['CartConsumer.onUpdated']);
  });

  it('기록이 실패하면 에러가 파이프라인을 탈출한다 — 커밋되지 않아 다시 온다', async () => {
    failCreated = true;
    // holdIfBlocked 는 통과시키고 recordFailure 에서 터지게 한다
    const original = recorder.recordFailure.bind(recorder);
    recorder.recordFailure = async () => {
      throw new Error('db down');
    };
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    recorder.recordFailure = original;

    expect(broker.deliveryFailures.map((f) => (f.error as Error).name)).toContain('DlqDeliveryError');
  });

  it('다시 넣기 헤더가 있으면 대상 핸들러만 한 번 돌리고 결과를 그 행에 적는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    const failed = recorder.rows[0];
    const envelope = broker.envelopesOn(TOPIC)[0];
    calls.length = 0;
    failCreated = false;

    await broker.inject(TOPIC, envelope, {
      key: 'cart-1',
      headers: { [DEAD_LETTER_HEADERS.id]: String(failed.id), [DEAD_LETTER_HEADERS.handler]: 'CartConsumer.onCreated' },
    });

    expect(calls).toEqual(['created:cart-1']); // audit 핸들러는 건드리지 않는다
    expect(recorder.rows[0].status).toBe('redriven');
  });

  it('다시 넣기는 재시도하지 않는다 — 실패하면 한 번 만에 그 행을 failed 로', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    const failed = recorder.rows[0];
    const envelope = broker.envelopesOn(TOPIC)[0];
    calls.length = 0;

    await broker.inject(TOPIC, envelope, {
      key: 'cart-1',
      headers: { [DEAD_LETTER_HEADERS.id]: String(failed.id), [DEAD_LETTER_HEADERS.handler]: 'CartConsumer.onCreated' },
    });

    expect(calls).toEqual(['created:cart-1']);
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0].status).toBe('failed');
  });

  it('recorder 가 없으면 지금처럼 .dlq 토픽으로 보낸다 — 켜지 않은 앱은 바뀌지 않는다', async () => {
    await app.close();
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'dl-spec', kafka })],
      controllers: [CartConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, { groupId: 'g', kafka, strategy: new InMemoryServer(broker) });
    await app.init();
    failCreated = true;
    await app
      .get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC))
      .publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/dead-letter/dead-letter-interceptor.spec.ts`
Expected: FAIL — `buildConsumerInterceptors` 가 3번째 인자를 받지 않음(타입 에러) / 동작 없음

- [ ] **Step 3: 구현 — 인터셉터**

`event-retry.interceptor.ts` import 에 더한다:

```ts
import { defer, lastValueFrom, Observable, of } from 'rxjs';
import { EVENT_TYPE_FILTER } from '../consumers/decorators';
import {
  DEAD_LETTER_HEADERS,
  type DeadLetterMessage,
  type DeadLetterRecorder,
} from '../dead-letter/dead-letter.types';
import { dlqMessagesTotal } from '../dlq/dlq.metrics';
import type { MessageEnvelope } from '@packages/event-contracts/types';
```

파일 상단(클래스 밖)에:

```ts
/** 앱이 실패 테이블을 켰을 때 인터셉터가 받는 것 (#1016 8번). 이 토큰은 DI 로 제공되지 않는다 — `buildConsumerInterceptors` 가 직접 넣는다 */
export const DEAD_LETTER_INTERCEPTOR_OPTIONS = Symbol('DEAD_LETTER_INTERCEPTOR_OPTIONS');
export interface DeadLetterInterceptorOptions {
  recorder: DeadLetterRecorder;
  consumerGroup: string;
}

/** 실패 행의 `handler` 칸 — 다시 넣기 헤더와 같은 값이어야 한다 */
export function handlerIdOf(cls: { name: string }, handler: { name: string }): string {
  return `${cls.name}.${handler.name}`;
}

function headerString(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  if (value === undefined || value === null) return undefined;
  return Buffer.isBuffer(value) ? value.toString('utf-8') : String(value);
}

function tryParseEnvelope(value: unknown): MessageEnvelope | undefined {
  try {
    return parseEnvelope(value);
  } catch {
    return undefined;
  }
}
```

생성자에 3번째 인자:

```ts
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DLQHandler)
    private readonly dlqHandler?: DLQHandler,
    @Optional()
    @Inject(DEAD_LETTER_INTERCEPTOR_OPTIONS)
    private readonly deadLetters?: DeadLetterInterceptorOptions,
  ) {}
```

`intercept` 의 마지막 줄 `return defer(() => this.executeWithRetry(...))` 를 다음으로 바꾼다:

```ts
    if (!this.deadLetters) {
      return defer(() => this.executeWithRetry(next, handler.name, kafkaContext, retryPolicy, disableDLQ));
    }

    // ── 실패 테이블 모드 (#1016 8번, 스펙 §6) ──
    // `EventTypeGuard` 는 클래스 레벨이라 이 전역 인터셉터보다 **안쪽**에서 돈다. 즉 여기는 같은 토픽의 모든 핸들러에
    // 대해 돈다. 이벤트 종류를 직접 비교하지 않으면 남의 이벤트를 이 핸들러 이름으로 보류하는 가짜 행이 생긴다(스펙 §6.1).
    const envelope = tryParseEnvelope(kafkaContext.getMessage().value);
    const expectedEventType = this.reflector.get<string | undefined>(EVENT_TYPE_FILTER, handler);
    if (expectedEventType && envelope?.messageType !== expectedEventType) {
      return next.handle(); // 안쪽 EventTypeGuard 가 조용히 거른다
    }

    const handlerId = handlerIdOf(context.getClass(), handler);
    const redriveId = headerString(headers, DEAD_LETTER_HEADERS.id);
    if (redriveId !== undefined) {
      if (headerString(headers, DEAD_LETTER_HEADERS.handler) !== handlerId) {
        return of(undefined); // 같은 이벤트를 받는 다른 핸들러 — 이미 성공했으니 건드리지 않는다
      }
      return defer(() => this.executeRedrive(next, Number(redriveId), handlerId, this.deadLetters!.recorder));
    }

    const message = this.toDeadLetterMessage(kafkaContext, envelope, handlerId);
    return defer(async () => {
      if (await this.holdIfBlocked(message)) return undefined; // 보관했다 → 정상 완료 → 커밋
      return this.executeWithRetry(next, handler.name, kafkaContext, retryPolicy, disableDLQ, message);
    });
```

클래스에 메서드를 더한다:

```ts
  private toDeadLetterMessage(
    kafkaContext: KafkaContext,
    envelope: MessageEnvelope | undefined,
    handlerId: string,
  ): DeadLetterMessage {
    const topic = kafkaContext.getTopic();
    const partition = kafkaContext.getPartition();
    const offset = String(kafkaContext.getMessage().offset);
    return {
      consumerGroup: this.deadLetters!.consumerGroup,
      handler: handlerId,
      topic,
      sequenceKey: envelope?.source?.aggregateId || null,
      // 빈 messageId 는 유일 키를 무력화한다 — 위치로 대신한다
      messageId: envelope?.messageId || `${topic}:${partition}:${offset}`,
      eventType: envelope?.messageType ?? null,
      envelope: envelope ?? { raw: String(kafkaContext.getMessage().value) },
      kafkaPartition: partition,
      kafkaOffset: offset,
    };
  }

  /** DB 를 못 읽으면 커밋하지 않고 다시 받는다 — 보류 여부를 모르는 채 처리하면 순서가 깨질 수 있다 */
  private async holdIfBlocked(message: DeadLetterMessage): Promise<boolean> {
    try {
      return await this.deadLetters!.recorder.holdIfBlocked(message);
    } catch (error) {
      throw new DlqDeliveryError(`dead letter 보류 검사 실패: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }

  /** 다시 넣기 — 한 번만 시도한다(스펙 §7.3). 결과는 그 행에 적는다 */
  private async executeRedrive(
    next: CallHandler,
    id: number,
    handlerId: string,
    recorder: DeadLetterRecorder,
  ): Promise<unknown> {
    try {
      const result = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await recorder.markRedriven(id);
      return result;
    } catch (error) {
      if (error instanceof DlqDeliveryError) throw error;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ msg: `Redrive failed: ${handlerId}`, deadLetterId: id, error: failure.message });
      await recorder.recordRedriveFailure(id, failure);
      return undefined;
    }
  }
```

`executeWithRetry` 에 마지막 인자 `deadLetterMessage?: DeadLetterMessage` 를 더하고, `handleFinalFailure` 호출에 넘긴다. `handleFinalFailure` 시그니처와 본문의 `disableDLQ` 분기 다음:

```ts
    if (this.deadLetters && deadLetterMessage) {
      try {
        await this.deadLetters.recorder.recordFailure(deadLetterMessage, error);
      } catch (recordError) {
        this.logger.error({
          msg: `❌ CRITICAL: Failed to record dead letter`,
          originalError: error.message,
          recordError: recordError instanceof Error ? recordError.message : String(recordError),
          topic,
          offset,
        });
        // 커밋하지 않고 다시 받는다(#1073 이후 참). DB 가 원인인 실패에서도 메시지를 잃지 않는다.
        throw new DlqDeliveryError(recordError instanceof Error ? recordError.message : String(recordError), recordError);
      }
      dlqMessagesTotal.inc({ topic, consumer: handlerName, error: error.name });
      this.logger.error({ msg: `❌ Handler failed after ${retries} retries — dead letter: ${handlerName}`, error: error.message, topic, offset });
      return;
    }
```

(`disableDLQ` 분기는 그대로 위에 둔다 — `@DisableDLQ` 는 기록 없이 버린다.)

- [ ] **Step 4: 구현 — 인터셉터 조립**

`consumer-interceptors.ts`:

```ts
import { DeadLetterInterceptorOptions, EventRetryInterceptor } from '../interceptors/event-retry.interceptor';
```

`optionalGet` 앞에 `export` 를 붙인다(Task 7 의 `startConsumer` 가 쓴다). `buildConsumerInterceptors` 시그니처와 재시도 인터셉터 생성:

```ts
export function buildConsumerInterceptors(
  app: INestApplicationContext,
  streams: StreamConfig[],
  deadLetters?: DeadLetterInterceptorOptions,
): NestInterceptor[] {
```

```ts
    new EventRetryInterceptor(reflector, optionalGet(app, DLQHandler), deadLetters),
```

`index.ts` 에 `export * from './dead-letter/dead-letter.types';` 를 더한다.

- [ ] **Step 5: 통과 + 회귀**

Run: `npx jest libs/events`
Expected: PASS — 새 스펙 7개 + 기존 `handler-failure`·`start-consumer`·`consumer-policy-wiring` 회귀 없음

- [ ] **Step 6: 커밋**

```bash
git add libs/events/src/interceptors/event-retry.interceptor.ts libs/events/src/consumers/consumer-interceptors.ts \
  libs/events/src/dead-letter/dead-letter-interceptor.spec.ts libs/events/src/index.ts
git commit -m "feat(events): 컨슈머 최종 실패를 앱 DB 에 — 같은 순서 키는 보류, 다시 넣기는 대상 핸들러만 한 번 (#1016 8번)"
```

---

### Task 7: `DeadLetterRuntime` + `EventFailuresModule` + `startConsumer` 배선

**Files:**
- Create: `libs/events/src/dead-letter/failure-action.log.ts`
- Create: `libs/events/src/dead-letter/dead-letter.runtime.ts`
- Create: `libs/events/src/dead-letter/event-failures.module.ts`
- Modify: `libs/events/src/events.module.ts`
- Test: `libs/events/src/dead-letter/event-failures-wiring.spec.ts`

**Interfaces:**
- Consumes: Task 4 `DeadLetterStore`, Task 5 `dispatchToServerHandler`, Task 6 `buildConsumerInterceptors(app, streams, deadLetters?)`·`optionalGet`
- Produces: `DeadLetterRuntime { attach(opts: { consumerGroup: string; server: Server }): void; get consumerGroup(): string; dispatch(row: DeadLetterRow): Promise<boolean> }`, `FailureActionLog { record(entry: FailureActionEntry, executor?): Promise<void>; forTargets(kind, ids: number[]): Promise<FailureActionRow[]> }`, `EventFailuresModule`

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/dead-letter/event-failures-wiring.spec.ts` — 앱이 `EventFailuresModule` 을 import 하면 `startConsumer` 가 그룹·서버를 붙이고 실패가 `.dlq` 대신 store 로 간다. DB 없이 보기 위해 `DeadLetterStore` 를 메모리 구현으로 덮는다:

```ts
import { Controller, Global, INestApplication, Module, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher.service';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import { EventFailuresModule } from './event-failures.module';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import type { DeadLetterMessage } from './dead-letter.types';

const TOPIC = CART_STREAM.topic.topic;
const recorded: DeadLetterMessage[] = [];

/**
 * 앱에서는 `DbModule`(전역)과 `EventsModule.forApp({ enableOutbox: true })` 가 주는 것들. 이 스펙은 배선만 보므로
 * 껍데기로 채운다. `OutboxDispatcher` 는 Task 9 의 `OutboxFailuresService` 가 요구한다 — 지금 넣어 두면 Task 9 에서 이 스펙이 깨지지 않는다.
 */
@Global()
@Module({
  providers: [
    { provide: DbService, useValue: { db: {} } },
    { provide: OutboxDispatcher, useValue: {} },
  ],
  exports: [DbService, OutboxDispatcher],
})
class FakeInfraModule {}

@Controller()
@UseInterceptors(EventTypeGuard)
class FailingConsumer {
  @RetryPolicy({ maxRetries: 0 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() _p: unknown) {
    throw new Error('nope');
  }
}

describe('EventFailuresModule 배선 (#1016 8번)', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;

  beforeEach(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    recorded.length = 0;
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeInfraModule,
        EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'wiring-spec', kafka: { clientId: 'w', brokers: ['unused:9092'] } }),
        EventFailuresModule,
      ],
      controllers: [FailingConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .overrideProvider(DeadLetterStore)
      .useValue({
        holdIfBlocked: async () => false,
        recordFailure: async (m: DeadLetterMessage) => {
          recorded.push(m);
        },
        markRedriven: async () => undefined,
        recordRedriveFailure: async () => undefined,
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, {
      groupId: 'wiring-group',
      kafka: { clientId: 'w', brokers: ['unused:9092'] },
      strategy: new InMemoryServer(broker),
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('startConsumer 가 런타임에 그룹을 붙인다 — groupId 정본은 startConsumer 인자 하나', () => {
    expect(app.get(DeadLetterRuntime).consumerGroup).toBe('wiring-group');
  });

  it('실패가 .dlq 토픽이 아니라 store 로 가고, 그룹·핸들러가 채워진다', async () => {
    await app
      .get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC))
      .publishEvent({
        eventType: 'CartCreated',
        aggregateId: 'cart-9',
        payload: { id: 'cart-9', customerId: 'c', regionId: 'r', createdAt: new Date().toISOString() },
      });

    expect(recorded.map((m) => [m.consumerGroup, m.handler, m.sequenceKey])).toEqual([
      ['wiring-group', 'FailingConsumer.onCreated', 'cart-9'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
  });
});
```

`FakeInfraModule` 이 전역인 이유: `EventFailuresModule` 의 provider 는 자기 모듈 스코프에서 `DbService` 를 찾는다 — 루트 모듈의 `providers` 에 넣으면 보이지 않는다(앱에서는 `DbModule` 이 전역이다).

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/dead-letter/event-failures-wiring.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/failure-action.log.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { failure_actions } from './dead-letter.schema';
import type { FailureAction, FailureActionKind, FailureActionOutcome } from './dead-letter.types';

export interface FailureActionEntry {
  targetKind: FailureActionKind;
  targetId: number;
  action: FailureAction;
  outcome: FailureActionOutcome;
  actor: string | null;
  note: string | null;
}

export type FailureActionRow = typeof failure_actions.$inferSelect;

/** 사람이 한 조치 (스펙 §5.2). 다시 넣기는 성공·실패와 무관하게 남긴다(스펙 §7.7). */
@Injectable()
export class FailureActionLog {
  constructor(private readonly dbService: DbService) {}

  async record(entry: FailureActionEntry): Promise<void> {
    await this.dbService.db.insert(failure_actions).values({ ...entry, note: entry.note?.slice(0, 2000) ?? null });
  }

  async forTargets(targetKind: FailureActionKind, targetIds: number[]): Promise<FailureActionRow[]> {
    if (targetIds.length === 0) return [];
    return this.dbService.db
      .select()
      .from(failure_actions)
      .where(and(eq(failure_actions.targetKind, targetKind), inArray(failure_actions.targetId, targetIds)))
      .orderBy(desc(failure_actions.id));
  }
}
```

`libs/events/src/dead-letter/dead-letter.runtime.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Server } from '@nestjs/microservices';
import { dispatchToServerHandler } from '../transport/kafka-context.factory';
import { DEAD_LETTER_HEADERS, type DeadLetterRow } from './dead-letter.types';

/**
 * 컨슈머 그룹과 마이크로서비스 서버를 붙든다 (#1016 8번, 스펙 §7.2). `startConsumer` 가 `attach` 한다 —
 * 그래서 `groupId` 의 정본은 `startConsumer` 인자 하나로 남는다.
 */
@Injectable()
export class DeadLetterRuntime {
  private attached?: { consumerGroup: string; server: Server };

  attach(options: { consumerGroup: string; server: Server }): void {
    if (this.attached) {
      throw new Error('DeadLetterRuntime: startConsumer 가 두 번 불렸다 — 앱에 컨슈머는 하나다');
    }
    this.attached = options;
  }

  get consumerGroup(): string {
    return this.require().consumerGroup;
  }

  /**
   * 한 행을 그 앱의 실제 소비 파이프라인에 다시 태운다. Kafka 를 거치지 않으므로 다른 구독자는 아무것도 받지 않는다.
   * 결과(성공·실패)는 인터셉터가 그 행에 적는다(`executeRedrive`). 토픽 핸들러가 없으면 false.
   */
  async dispatch(row: DeadLetterRow): Promise<boolean> {
    const { server } = this.require();
    return dispatchToServerHandler(server, {
      topic: row.topic,
      partition: row.kafkaPartition,
      offset: row.kafkaOffset,
      key: row.sequenceKey ?? '',
      value: JSON.stringify(row.envelope),
      headers: { [DEAD_LETTER_HEADERS.id]: String(row.id), [DEAD_LETTER_HEADERS.handler]: row.handler },
      timestamp: String(Date.now()),
    });
  }

  private require(): { consumerGroup: string; server: Server } {
    if (!this.attached) {
      throw new Error('DeadLetterRuntime: 컨슈머가 아직 시작되지 않았다 — main.ts 에서 startConsumer 가 app.listen 보다 먼저인지 확인');
    }
    return this.attached;
  }
}
```

`libs/events/src/dead-letter/event-failures.module.ts` (Task 8~11 이 provider 를 더한다 — 지금은 셋):

```ts
import { Module } from '@nestjs/common';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';

/**
 * 이벤트 실패 출구 (#1016 7·8번). **앱이 이 모듈을 import 하면 켜진다** — `startConsumer` 가 컨테이너에서
 * `DeadLetterRuntime` 을 찾아 그룹·서버를 붙이고, 인터셉터가 `.dlq` 토픽 대신 `event.dead_letters` 에 적는다.
 * 그 앱의 drizzle config 에 `dead-letter.schema.ts` 가 있어야 한다.
 *
 * 컨트롤러는 없다 — 앱마다 전역 가드가 달라 라우팅·인가는 앱이 소유한다(#705, `EventTraceApiModule` 과 같은 이유).
 */
@Module({
  providers: [DeadLetterStore, FailureActionLog, DeadLetterRuntime],
  exports: [DeadLetterStore, FailureActionLog, DeadLetterRuntime],
})
export class EventFailuresModule {}
```

`events.module.ts` — import:

```ts
import { ServerKafka } from '@nestjs/microservices';
import { buildConsumerInterceptors, EVENTS_CONSUMER_POLICY, optionalGet } from './consumers/consumer-interceptors';
import { DeadLetterRuntime } from './dead-letter/dead-letter.runtime';
import { DeadLetterStore } from './dead-letter/dead-letter.store';
```

`startConsumer` 의 `microserviceOptions` 블록과 인터셉터 줄을 바꾼다:

```ts
    // 서버를 직접 만든다 (#1016 8번). 다시 넣기가 이 서버의 `getHandlerByPattern` 을 써야 하는데
    // `NestMicroservice` 의 서버 인스턴스는 private 이다. `{ strategy }` 분기는 `{ transport, options }` 와
    // 같은 서버를 만든다(`nest-microservice.js` createServer).
    const server = options.strategy ?? new ServerKafka(buildKafkaConsumerServerOptions(kafka, options));

    const microservice = app.connectMicroservice({ strategy: server }, { deferInitialization: true }) as NestMicroservice;

    // 실패 테이블 (#1016 8번). 앱이 `EventFailuresModule` 을 import 했을 때만 있다.
    const deadLetterRuntime = optionalGet(app, DeadLetterRuntime);
    const deadLetters = deadLetterRuntime
      ? { recorder: app.get(DeadLetterStore, { strict: false }), consumerGroup: options.groupId }
      : undefined;
    deadLetterRuntime?.attach({ consumerGroup: options.groupId, server });

    microservice.useGlobalInterceptors(...buildConsumerInterceptors(app, derived.streams, deadLetters));
```

(`microserviceOptions` 변수와 그 타입 선언, `Transport` import 중 안 쓰게 된 것을 지운다. `Transport` 는 `forApp` 의 `ClientsModule` 이 계속 쓴다.)

`index.ts`:

```ts
export * from './dead-letter/dead-letter.schema';
export { DeadLetterStore } from './dead-letter/dead-letter.store';
export { DeadLetterRuntime } from './dead-letter/dead-letter.runtime';
export { FailureActionLog } from './dead-letter/failure-action.log';
export type { FailureActionEntry, FailureActionRow } from './dead-letter/failure-action.log';
export { EventFailuresModule } from './dead-letter/event-failures.module';
```

- [ ] **Step 4: 통과 + 회귀 (실 브로커 스펙 포함)**

Run: `npx jest libs/events`
Expected: PASS — `start-consumer-shutdown-hooks.spec.ts`·`kafka-consumer-options.spec.ts` 회귀 없음

Run (로컬 kafka 가 떠 있을 때): `npx jest libs/events/src/transport/kafka-commit.integration.spec.ts`
Expected: PASS — `{ strategy: new ServerKafka(...) }` 로 바뀌어도 커밋 의미론(#1073)이 같다

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/dead-letter/failure-action.log.ts libs/events/src/dead-letter/dead-letter.runtime.ts \
  libs/events/src/dead-letter/event-failures.module.ts libs/events/src/dead-letter/event-failures-wiring.spec.ts \
  libs/events/src/events.module.ts libs/events/src/index.ts
git commit -m "feat(events): EventFailuresModule — import 하면 컨슈머 실패가 앱 DB 로, startConsumer 가 그룹·서버를 붙인다 (#1016 8번)"
```

---

### Task 8: `DeadLetterRedriver` — 순서 다시 넣기·종결·전체 다시 넣기

**Files:**
- Create: `libs/events/src/dead-letter/dead-letter.redriver.ts`
- Modify: `libs/events/src/dead-letter/event-failures.module.ts`
- Test: `libs/events/src/dead-letter/dead-letter.redriver.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4 `tryLockSequence`, Task 7 `DeadLetterRuntime.dispatch`·`FailureActionLog`
- Produces:
  ```ts
  interface RedriveStop { id: number; errorName: string | null; errorMessage: string | null }
  interface RedriveResult { processed: number; stoppedAt: RedriveStop | null }
  interface RedriveAllResult { sequences: number; succeeded: number; stopped: number; busy: number; stoppedByError: Record<string, number> }
  class DeadLetterRedriver {
    redrive(id: number, actor: string | null): Promise<RedriveResult>;
    discard(id: number, actor: string | null, reason: string): Promise<RedriveResult>;
    redriveAll(actor: string | null): Promise<RedriveAllResult>;
  }
  ```
  `NotFoundError`(행 없음), `ConflictError`(이미 진행 중 / 이미 처리됨)

- [ ] **Step 1: 실패하는 통합 테스트**

`libs/events/src/dead-letter/dead-letter.redriver.integration.spec.ts` — **실제 커밋**한다(lock 경합은 연결이 둘이어야 보인다). 스위트 고유 토픽을 쓰고 `afterEach` 에서 그 토픽만 지운다. 런타임은 가짜 서버로 붙여, 핸들러 대신 «무엇을 다시 넣었나»를 기록하고 결과를 store 로 적는다(인터셉터의 `executeRedrive` 와 같은 일):

```ts
/**
 * 실행: `npm run test:core:integration:local -- dead-letter.redriver`
 * 이 스위트는 커밋한다 — 토픽 `redriver-spec.v1` 행만 쓰고 지운다(WHERE 없는 DELETE 금지, CLAUDE.md).
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
        topic === TOPIC
          ? async (data: { messageId: string }, context: { getMessage(): { headers: Record<string, Buffer> } }) => {
              const id = Number(context.getMessage().headers[DEAD_LETTER_HEADERS.id].toString());
              dispatched.push(data.messageId);
              if (failOn.has(data.messageId)) await store.recordRedriveFailure(id, new Error(`fail ${data.messageId}`));
              else await store.markRedriven(id);
            }
          : null,
    } as unknown as Server;
    runtime.attach({ consumerGroup: GROUP, server });
    redriver = new DeadLetterRedriver(dbService, runtime, new FailureActionLog(dbService));
  });

  afterEach(async () => {
    const ids = (await db.select({ id: dead_letters.id }).from(dead_letters).where(eq(dead_letters.topic, TOPIC))).map((r) => r.id);
    if (ids.length > 0) {
      await db.delete(failure_actions).where(and(eq(failure_actions.targetKind, 'dead_letter'), inArray(failure_actions.targetId, ids)));
    }
    await db.delete(dead_letters).where(eq(dead_letters.topic, TOPIC));
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

  const statuses = async () =>
    (await db.select().from(dead_letters).where(eq(dead_letters.topic, TOPIC)).orderBy(dead_letters.id)).map(
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
    const actions = await db.select().from(failure_actions).where(eq(failure_actions.targetKind, 'dead_letter')).orderBy(failure_actions.id);
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
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- dead-letter.redriver`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/dead-letter.redriver.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared/filters/domain-exceptions';
import { dead_letters } from './dead-letter.schema';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { FailureActionLog } from './failure-action.log';
import { tryLockSequence, type SequenceLockKey } from './sequence-lock';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterRow } from './dead-letter.types';

export interface RedriveStop {
  id: number;
  errorName: string | null;
  errorMessage: string | null;
}
export interface RedriveResult {
  processed: number;
  stoppedAt: RedriveStop | null;
}
export interface RedriveAllResult {
  sequences: number;
  succeeded: number;
  stopped: number;
  /** 다른 사람이 다시 넣는 중이라 건너뛴 순서 */
  busy: number;
  stoppedByError: Record<string, number>;
}

const MAX_REASON = 500;
const UNRESOLVED = [...UNRESOLVED_DEAD_LETTER_STATUSES];

/**
 * 다시 넣기와 종결 (#1016 8번, 스펙 §7). 단위는 «순서» = 같은 (그룹, 토픽, 순서 키)의 `failed`·`held`.
 *
 * lock 을 쥔 트랜잭션은 루프 내내 열려 있고(같은 순서의 실시간 소비가 기다린다), 행 상태는 그 트랜잭션 밖(`this.db`)에서
 * 바로 커밋한다 — 중간에 죽어도 이미 성공한 행이 되돌아가 두 번 처리되지 않게 하기 위해서다.
 */
@Injectable()
export class DeadLetterRedriver {
  private readonly logger = new Logger(DeadLetterRedriver.name);

  constructor(
    private readonly dbService: DbService,
    private readonly runtime: DeadLetterRuntime,
    private readonly actions: FailureActionLog,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async redrive(id: number, actor: string | null): Promise<RedriveResult> {
    const row = await this.load(id);
    return this.runSequence(row, actor);
  }

  async discard(id: number, actor: string | null, reason: string): Promise<RedriveResult> {
    const note = reason?.trim();
    if (!note) throw new BadRequestError('종결 사유가 필요하다');
    const row = await this.load(id);
    return this.runSequence(row, actor, note.slice(0, MAX_REASON));
  }

  async redriveAll(actor: string | null): Promise<RedriveAllResult> {
    const heads = await this.heads();
    const result: RedriveAllResult = { sequences: heads.length, succeeded: 0, stopped: 0, busy: 0, stoppedByError: {} };
    for (const head of heads) {
      try {
        const outcome = await this.runSequence(head, actor);
        if (outcome.stoppedAt) {
          result.stopped += 1;
          const name = outcome.stoppedAt.errorName ?? 'Unknown';
          result.stoppedByError[name] = (result.stoppedByError[name] ?? 0) + 1;
        } else {
          result.succeeded += 1;
        }
      } catch (error) {
        if (error instanceof ConflictError) result.busy += 1;
        else throw error;
      }
    }
    return result;
  }

  private async runSequence(row: DeadLetterRow, actor: string | null, discardReason?: string): Promise<RedriveResult> {
    const key: SequenceLockKey = {
      consumerGroup: row.consumerGroup,
      topic: row.topic,
      sequenceKey: row.sequenceKey,
      rowId: row.id,
    };

    return this.db.transaction(async (tx) => {
      if (!(await tryLockSequence(tx, key))) {
        throw new ConflictError('이 순서를 이미 다시 넣는 중이다');
      }

      if (discardReason !== undefined) {
        const headBefore = await this.nextInSequence(row);
        const [discarded] = await this.db
          .update(dead_letters)
          .set({ status: 'discarded', resolvedAt: sql`now()` })
          .where(and(eq(dead_letters.id, row.id), inArray(dead_letters.status, UNRESOLVED)))
          .returning({ id: dead_letters.id });
        if (!discarded) throw new ConflictError('이미 처리된 행이다');
        await this.actions.record({
          targetKind: 'dead_letter',
          targetId: row.id,
          action: 'discard',
          outcome: 'succeeded',
          actor,
          note: discardReason,
        });
        // 머리가 아니었으면 머리가 그대로라 아무것도 흐르지 않는다(스펙 §7.5)
        if (headBefore?.id !== row.id) return { processed: 0, stoppedAt: null };
      }

      let processed = 0;
      for (;;) {
        const next = await this.nextInSequence(row);
        if (!next) return { processed, stoppedAt: null };

        const stop = await this.dispatchOne(next);
        await this.actions.record({
          targetKind: 'dead_letter',
          targetId: next.id,
          action: 'redrive',
          outcome: stop ? 'failed' : 'succeeded',
          actor,
          note: stop?.errorMessage ?? null,
        });
        if (stop) return { processed, stoppedAt: stop };
        processed += 1;
      }
    });
  }

  /**
   * 한 행을 다시 넣고 결과를 읽는다. 인터셉터가 그 행에 성공(`redriven`, 횟수+1)·실패(`failed`, 횟수+1)를 적는다.
   * 횟수가 그대로면 핸들러가 돌지 않은 것이다(이벤트 종류·핸들러 이름이 바뀐 경우) — 옛 오류를 결과로 착각하지 않는다.
   */
  private async dispatchOne(row: DeadLetterRow): Promise<RedriveStop | null> {
    const stopWith = (error: Error): RedriveStop => {
      this.logger.warn({ msg: 'Redrive stopped', deadLetterId: row.id, error: error.message });
      return { id: row.id, errorName: error.name, errorMessage: error.message };
    };

    try {
      const handled = await this.runtime.dispatch(row);
      if (!handled) return stopWith(new Error(`토픽 ${row.topic} 의 핸들러가 이 앱에 없다`));
    } catch (error) {
      // 인터셉터가 결과를 적지 못했다(DlqDeliveryError 등). 행은 그대로 두고 멈춘다.
      return stopWith(error instanceof Error ? error : new Error(String(error)));
    }

    const [after] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, row.id));
    if (!after || after.redriveCount === row.redriveCount) {
      return stopWith(new Error('핸들러가 실행되지 않았다 — 이벤트 종류·핸들러 이름이 바뀌었는지 확인'));
    }
    if (after.status === 'redriven') return null;
    this.logger.warn({ msg: 'Redrive stopped', deadLetterId: row.id, error: after.errorMessage });
    return { id: row.id, errorName: after.errorName, errorMessage: after.errorMessage };
  }

  private async nextInSequence(row: DeadLetterRow): Promise<DeadLetterRow | undefined> {
    const sequence =
      row.sequenceKey === null
        ? eq(dead_letters.id, row.id)
        : and(
            eq(dead_letters.consumerGroup, row.consumerGroup),
            eq(dead_letters.topic, row.topic),
            eq(dead_letters.sequenceKey, row.sequenceKey),
          );
    const [next] = await this.db
      .select()
      .from(dead_letters)
      .where(and(sequence, inArray(dead_letters.status, UNRESOLVED)))
      .orderBy(asc(dead_letters.id))
      .limit(1);
    return next;
  }

  /** 순서마다 가장 이른 안 푼 행 */
  private async heads(): Promise<DeadLetterRow[]> {
    const earlier = alias(dead_letters, 'earlier');
    return this.db
      .select()
      .from(dead_letters)
      .where(
        and(
          inArray(dead_letters.status, UNRESOLVED),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.consumerGroup, dead_letters.consumerGroup),
                  eq(earlier.topic, dead_letters.topic),
                  eq(earlier.sequenceKey, dead_letters.sequenceKey),
                  inArray(earlier.status, UNRESOLVED),
                  sql`${earlier.id} < ${dead_letters.id}`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(dead_letters.id));
  }

  private async load(id: number): Promise<DeadLetterRow> {
    const [row] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, id));
    if (!row) throw new NotFoundError(`dead letter 가 없다: ${id}`);
    if (!UNRESOLVED.includes(row.status as (typeof UNRESOLVED)[number])) {
      throw new ConflictError(`이미 처리된 행이다: ${id} (${row.status})`);
    }
    return row;
  }
}
```

`heads()` 의 `eq(earlier.sequenceKey, dead_letters.sequenceKey)` 는 NULL 끼리 같지 않으므로 키 없는 행은 각자 머리가 된다 — 의도다.

`event-failures.module.ts` 의 providers·exports 에 `DeadLetterRedriver` 를 더한다. `index.ts` 에:

```ts
export { DeadLetterRedriver } from './dead-letter/dead-letter.redriver';
export type { RedriveResult, RedriveAllResult, RedriveStop } from './dead-letter/dead-letter.redriver';
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:core:integration:local -- dead-letter`
Expected: PASS (store 7 + redriver 8)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/dead-letter/dead-letter.redriver.ts libs/events/src/dead-letter/dead-letter.redriver.integration.spec.ts \
  libs/events/src/dead-letter/event-failures.module.ts libs/events/src/index.ts
git commit -m "feat(events): DeadLetterRedriver — 순서 단위 다시 넣기·종결, 한 번만 시도 (#1016 8번)"
```

---

### Task 9: `OutboxFailuresService` — 다시 보내기·종결

**Files:**
- Modify: `libs/events/src/outbox/outbox-dispatcher.service.ts` (발행부 분리 + `publishLeasedRow`)
- Create: `libs/events/src/outbox/outbox-failures.service.ts`
- Modify: `libs/events/src/dead-letter/event-failures.module.ts`
- Test: `libs/events/src/outbox/outbox-failures.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `DISCARDED`, Task 7 `FailureActionLog`
- Produces:
  ```ts
  type OutboxDispatchRow = { id; topic; aggregateType; aggregateId; eventType; partitionKey: string | null; payload: unknown; retryCount; createdAt }
  OutboxDispatcher.publishLeasedRow(row: OutboxDispatchRow): Promise<{ ok: true } | { ok: false; error: string }>
  class OutboxFailuresService {
    listFailed(limitRaw?: string, cursorRaw?: string): Promise<{ items: OutboxFailedItem[]; nextCursor: number | null }>;
    detail(id: number): Promise<OutboxFailureDetail>;
    resend(id: number, actor: string | null): Promise<{ status: 'PUBLISHED' } | { status: 'FAILED'; error: string }>;
    discard(id: number, actor: string | null, reason: string): Promise<{ status: 'DISCARDED' }>;
    resendAll(actor: string | null): Promise<{ total: number; published: number; failed: Array<{ id: number; error: string }> }>;
  }
  ```

- [ ] **Step 1: 실패하는 통합 테스트**

`libs/events/src/outbox/outbox-failures.integration.spec.ts` — 롤백 트랜잭션. 디스패처는 기록용 가짜 publisher 로:

```ts
/** 실행: `npm run test:core:integration:local -- outbox-failures` */
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

  async function inRollbackTx(run: (ctx: { tx: Db; service: OutboxFailuresService; sent: string[]; fail: { on: boolean } }) => Promise<void>) {
    const sentinel = Symbol('rollback');
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- outbox-failures`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 디스패처 — 발행부 분리**

`outbox-dispatcher.service.ts` — `AcquiredOutboxRow` 를 `export type OutboxDispatchRow` 로 이름을 바꾸고(파일 안 참조 전부), `processEvent` 를 둘로 나눈다:

```ts
  private async processEvent(event: OutboxDispatchRow) {
    try {
      await this.publishAndMark(event);
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  /** 발행 + `PUBLISHED` 표시. 디스패처 주기와 사람의 «다시 보내기»가 같은 길을 탄다(검증 포함). */
  private async publishAndMark(event: OutboxDispatchRow): Promise<void> {
    const publisher = this.publisherFor(event.topic);
    if (!publisher) {
      throw new Error(`No publisher found for topic: ${event.topic}`);
    }
    // (기존 processEvent 의 주석 블록 — 검증·partitionKey 폴백·payload 좁히기 — 을 그대로 옮긴다)
    await publisher.publishStoredEnvelope(event.payload as MessageEnvelope, event.partitionKey ?? event.aggregateId);
    await this.db
      .update(outbox_events)
      .set({ status: 'PUBLISHED', processingStartedAt: null, publishedAt: new Date() })
      .where(eq(outbox_events.id, event.id));
    recordOutboxPublished(event.topic);
    this.logger.log(`Event ${event.id} published: ${event.eventType}`);
  }

  /**
   * 사람이 선점(`FAILED → PROCESSING`)한 행을 **한 번** 보낸다 (#1016 7번, 스펙 §8.3). 실패하면 `FAILED` 로 되돌리고
   * 오류만 갱신한다 — `retry_count` 를 그대로 두는 이유는 다시 2시간 재시도 일정에 태우지 않기 위해서다.
   */
  async publishLeasedRow(event: OutboxDispatchRow): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.publishAndMark(event);
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(outbox_events)
        .set({ status: 'FAILED', processingStartedAt: null, errorMessage: message, failedAt: new Date() })
        .where(eq(outbox_events.id, event.id));
      recordOutboxFailed(event.topic, true);
      this.logger.error(`Event ${event.id} resend failed: ${message}`);
      return { ok: false, error: message };
    }
  }
```

- [ ] **Step 4: 서비스 구현**

`libs/events/src/outbox/outbox-failures.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared/filters/domain-exceptions';
import { outbox_events } from './outbox.schema';
import { OutboxDispatcher } from './outbox-dispatcher.service';
import { FailureActionLog, type FailureActionRow } from '../dead-letter/failure-action.log';

export interface OutboxFailedItem {
  id: number;
  topic: string;
  eventType: string;
  aggregateId: string;
  createdAt: Date;
  failedAt: Date | null;
  retryCount: number;
  errorMessage: string | null;
  /** 같은 (topic, aggregate_id) 뒤에서 기다리는 PENDING 수 — `sequenceByAggregate` 가 막고 있는 것 */
  waitingBehind: number;
}
export interface OutboxFailureDetail extends OutboxFailedItem {
  status: string;
  payload: unknown;
  actions: FailureActionRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_REASON = 500;

const dispatchColumns = {
  id: outbox_events.id,
  topic: outbox_events.topic,
  aggregateType: outbox_events.aggregateType,
  aggregateId: outbox_events.aggregateId,
  eventType: outbox_events.eventType,
  partitionKey: outbox_events.partitionKey,
  payload: outbox_events.payload,
  retryCount: outbox_events.retryCount,
  createdAt: outbox_events.createdAt,
};

/** outbox 출구 (#1016 7번, 스펙 §8.3~8.5). 발행 자체는 디스패처의 길을 그대로 탄다. */
@Injectable()
export class OutboxFailuresService {
  constructor(
    private readonly dbService: DbService,
    private readonly dispatcher: OutboxDispatcher,
    private readonly actions: FailureActionLog,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async listFailed(limitRaw?: string, cursorRaw?: string): Promise<{ items: OutboxFailedItem[]; nextCursor: number | null }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = Math.max(parseInt(cursorRaw ?? '', 10) || 0, 0);
    const rows = await this.selectFailed(and(eq(outbox_events.status, 'FAILED'), gt(outbox_events.id, cursor)), limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async detail(id: number): Promise<OutboxFailureDetail> {
    const [row] = await this.db.select().from(outbox_events).where(eq(outbox_events.id, id));
    if (!row) throw new NotFoundError(`outbox 행이 없다: ${id}`);
    const [item] = await this.selectFailed(eq(outbox_events.id, id), 1);
    return { ...item, status: row.status, payload: row.payload, actions: await this.actions.forTargets('outbox', [id]) };
  }

  async resend(id: number, actor: string | null): Promise<{ status: 'PUBLISHED' } | { status: 'FAILED'; error: string }> {
    const [leased] = await this.db
      .update(outbox_events)
      .set({ status: 'PROCESSING', processingStartedAt: new Date() })
      .where(and(eq(outbox_events.id, id), eq(outbox_events.status, 'FAILED')))
      .returning(dispatchColumns);
    if (!leased) throw new ConflictError(`FAILED 상태의 outbox 행이 아니다: ${id}`);

    const outcome = await this.dispatcher.publishLeasedRow(leased);
    await this.actions.record({
      targetKind: 'outbox',
      targetId: id,
      action: 'redrive',
      outcome: outcome.ok ? 'succeeded' : 'failed',
      actor,
      note: outcome.ok ? null : outcome.error,
    });
    return outcome.ok ? { status: 'PUBLISHED' } : { status: 'FAILED', error: outcome.error };
  }

  async discard(id: number, actor: string | null, reason: string): Promise<{ status: 'DISCARDED' }> {
    const note = reason?.trim();
    if (!note) throw new BadRequestError('종결 사유가 필요하다');
    const [row] = await this.db
      .update(outbox_events)
      .set({ status: 'DISCARDED', processingStartedAt: null })
      .where(and(eq(outbox_events.id, id), eq(outbox_events.status, 'FAILED')))
      .returning({ id: outbox_events.id });
    if (!row) throw new ConflictError(`FAILED 상태의 outbox 행이 아니다: ${id}`);
    await this.actions.record({ targetKind: 'outbox', targetId: id, action: 'discard', outcome: 'succeeded', actor, note: note.slice(0, MAX_REASON) });
    return { status: 'DISCARDED' };
  }

  async resendAll(actor: string | null): Promise<{ total: number; published: number; failed: Array<{ id: number; error: string }> }> {
    const ids = (
      await this.db
        .select({ id: outbox_events.id })
        .from(outbox_events)
        .where(eq(outbox_events.status, 'FAILED'))
        .orderBy(asc(outbox_events.createdAt), asc(outbox_events.id))
    ).map((r) => r.id);
    const failed: Array<{ id: number; error: string }> = [];
    let published = 0;
    for (const id of ids) {
      try {
        const outcome = await this.resend(id, actor);
        if (outcome.status === 'PUBLISHED') published += 1;
        else failed.push({ id, error: outcome.error });
      } catch (error) {
        // 그 사이 다른 사람이 처리했다(409) — 건너뛴다
        if (!(error instanceof ConflictError)) throw error;
      }
    }
    return { total: ids.length, published, failed };
  }

  private async selectFailed(where: SQL | undefined, limit: number): Promise<OutboxFailedItem[]> {
    const behind = alias(outbox_events, 'behind');
    return this.db
      .select({
        id: outbox_events.id,
        topic: outbox_events.topic,
        eventType: outbox_events.eventType,
        aggregateId: outbox_events.aggregateId,
        createdAt: outbox_events.createdAt,
        failedAt: outbox_events.failedAt,
        retryCount: outbox_events.retryCount,
        errorMessage: outbox_events.errorMessage,
        waitingBehind: sql<number>`(
          select count(*)::int from ${behind}
          where ${behind.topic} = ${outbox_events.topic}
            and ${behind.aggregateId} = ${outbox_events.aggregateId}
            and ${behind.status} = 'PENDING'
            and ${behind.id} > ${outbox_events.id}
        )`,
      })
      .from(outbox_events)
      .where(where)
      .orderBy(asc(outbox_events.id))
      .limit(limit);
  }
}
```

`event-failures.module.ts` providers·exports 에 `OutboxFailuresService` 를 더한다(디스패처는 `EventsModule.forApp({ enableOutbox: true })` 의 전역 provider 다 — outbox 를 켜지 않은 앱이 이 모듈을 import 하면 부팅 시 DI 에러로 드러난다. core·channel-adapter 는 켜져 있다). `index.ts`:

```ts
export * from './outbox/outbox-failures.service';
```

- [ ] **Step 5: 통과 + outbox 회귀**

Run: `npm run test:core:integration:local -- outbox`
Expected: PASS (새 6 + 기존 파티션·순서·멱등·메트릭)

Run: `npx jest libs/events/src/outbox`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add libs/events/src/outbox/outbox-dispatcher.service.ts libs/events/src/outbox/outbox-failures.service.ts \
  libs/events/src/outbox/outbox-failures.integration.spec.ts libs/events/src/dead-letter/event-failures.module.ts libs/events/src/index.ts
git commit -m "feat(events): outbox FAILED 다시 보내기·종결 — 한 번만, retry_count 유지 (#1016 7번)"
```

---

### Task 10: `DeadLetterQueryService` — 요약·순서 목록·상세

**Files:**
- Create: `libs/events/src/dead-letter/dead-letter.query.ts`
- Modify: `libs/events/src/dead-letter/event-failures.module.ts`
- Test: `libs/events/src/dead-letter/dead-letter.query.integration.spec.ts`

**Interfaces:**
- Consumes: Task 4·7·9
- Produces:
  ```ts
  interface EventFailuresSummary { deadLetters: { failed: number; held: number; oldestFailedAt: string | null }; outbox: { failed: number; oldestFailedAt: string | null } }
  interface DeadLetterSequenceItem { id; topic; handler; eventType: string | null; sequenceKey: string | null; status: string; errorName: string | null; errorMessage: string | null; firstFailedAt: Date; redriveCount: number; heldBehind: number }
  interface DeadLetterDetail { row: DeadLetterRow; sequence: DeadLetterRow[]; actions: FailureActionRow[] }
  class DeadLetterQueryService {
    summary(): Promise<EventFailuresSummary>;
    listSequences(limitRaw?: string, cursorRaw?: string): Promise<{ items: DeadLetterSequenceItem[]; nextCursor: number | null }>;
    detail(id: number): Promise<DeadLetterDetail>;
  }
  ```

- [ ] **Step 1: 실패하는 통합 테스트**

`libs/events/src/dead-letter/dead-letter.query.integration.spec.ts` — 롤백 트랜잭션(Task 4 하네스와 같은 모양):

```ts
/** 실행: `npm run test:core:integration:local -- dead-letter.query` */
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

  async function inRollbackTx(run: (ctx: { tx: Db; store: DeadLetterStore; query: DeadLetterQueryService }) => Promise<void>) {
    const sentinel = Symbol('rollback');
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
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:core:integration:local -- dead-letter.query`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/dead-letter.query.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, asc, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { NotFoundError } from '@app/shared/filters/domain-exceptions';
import { dead_letters } from './dead-letter.schema';
import { outbox_events } from '../outbox/outbox.schema';
import { FailureActionLog, type FailureActionRow } from './failure-action.log';
import { UNRESOLVED_DEAD_LETTER_STATUSES, type DeadLetterRow } from './dead-letter.types';

export interface EventFailuresSummary {
  deadLetters: { failed: number; held: number; oldestFailedAt: string | null };
  outbox: { failed: number; oldestFailedAt: string | null };
}
export interface DeadLetterSequenceItem {
  id: number;
  topic: string;
  handler: string;
  eventType: string | null;
  sequenceKey: string | null;
  status: string;
  errorName: string | null;
  errorMessage: string | null;
  firstFailedAt: Date;
  redriveCount: number;
  heldBehind: number;
}
export interface DeadLetterDetail {
  row: DeadLetterRow;
  sequence: DeadLetterRow[];
  actions: FailureActionRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UNRESOLVED = [...UNRESOLVED_DEAD_LETTER_STATUSES];

/** 화면이 읽는 것 (스펙 §9). 집계는 여기서 끝낸다. */
@Injectable()
export class DeadLetterQueryService {
  constructor(
    private readonly dbService: DbService,
    private readonly actions: FailureActionLog,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async summary(): Promise<EventFailuresSummary> {
    const [dl] = await this.db
      .select({
        failed: sql<number>`count(*) filter (where ${dead_letters.status} = 'failed')::int`,
        held: sql<number>`count(*) filter (where ${dead_letters.status} = 'held')::int`,
        oldest: sql<Date | null>`min(${dead_letters.firstFailedAt}) filter (where ${dead_letters.status} in ('failed', 'held'))`,
      })
      .from(dead_letters);
    const [ob] = await this.db
      .select({
        failed: sql<number>`count(*)::int`,
        oldest: sql<Date | null>`min(${outbox_events.failedAt})`,
      })
      .from(outbox_events)
      .where(eq(outbox_events.status, 'FAILED'));
    return {
      deadLetters: { failed: dl?.failed ?? 0, held: dl?.held ?? 0, oldestFailedAt: toIso(dl?.oldest) },
      outbox: { failed: ob?.failed ?? 0, oldestFailedAt: toIso(ob?.oldest) },
    };
  }

  async listSequences(limitRaw?: string, cursorRaw?: string): Promise<{ items: DeadLetterSequenceItem[]; nextCursor: number | null }> {
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = Math.max(parseInt(cursorRaw ?? '', 10) || 0, 0);
    const earlier = alias(dead_letters, 'earlier');
    const later = alias(dead_letters, 'later');
    const rows = await this.db
      .select({
        id: dead_letters.id,
        topic: dead_letters.topic,
        handler: dead_letters.handler,
        eventType: dead_letters.eventType,
        sequenceKey: dead_letters.sequenceKey,
        status: dead_letters.status,
        errorName: dead_letters.errorName,
        errorMessage: dead_letters.errorMessage,
        firstFailedAt: dead_letters.firstFailedAt,
        redriveCount: dead_letters.redriveCount,
        heldBehind: sql<number>`(
          select count(*)::int from ${later}
          where ${later.consumerGroup} = ${dead_letters.consumerGroup}
            and ${later.topic} = ${dead_letters.topic}
            and ${later.sequenceKey} = ${dead_letters.sequenceKey}
            and ${later.status} in ('failed', 'held')
            and ${later.id} > ${dead_letters.id}
        )`,
      })
      .from(dead_letters)
      .where(
        and(
          inArray(dead_letters.status, UNRESOLVED),
          gt(dead_letters.id, cursor),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(earlier)
              .where(
                and(
                  eq(earlier.consumerGroup, dead_letters.consumerGroup),
                  eq(earlier.topic, dead_letters.topic),
                  eq(earlier.sequenceKey, dead_letters.sequenceKey),
                  inArray(earlier.status, UNRESOLVED),
                  sql`${earlier.id} < ${dead_letters.id}`,
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(dead_letters.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async detail(id: number): Promise<DeadLetterDetail> {
    const [row] = await this.db.select().from(dead_letters).where(eq(dead_letters.id, id));
    if (!row) throw new NotFoundError(`dead letter 가 없다: ${id}`);
    const sequence =
      row.sequenceKey === null
        ? [row]
        : await this.db
            .select()
            .from(dead_letters)
            .where(
              and(
                eq(dead_letters.consumerGroup, row.consumerGroup),
                eq(dead_letters.topic, row.topic),
                eq(dead_letters.sequenceKey, row.sequenceKey),
              ),
            )
            .orderBy(asc(dead_letters.id));
    const actions = await this.actions.forTargets('dead_letter', sequence.map((r) => r.id));
    return { row, sequence, actions };
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
```

`event-failures.module.ts` providers·exports 에 `DeadLetterQueryService`. `index.ts`:

```ts
export * from './dead-letter/dead-letter.query';
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:core:integration:local -- dead-letter`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/dead-letter/dead-letter.query.ts libs/events/src/dead-letter/dead-letter.query.integration.spec.ts \
  libs/events/src/dead-letter/event-failures.module.ts libs/events/src/index.ts
git commit -m "feat(events): 이벤트 실패 요약·순서 목록·상세 조회 (#1016 7·8번)"
```

---

### Task 11: `events_dead_letters` 게이지

**Files:**
- Create: `libs/events/src/dead-letter/dead-letter.metrics.ts`
- Create: `libs/events/src/dead-letter/dead-letter-metrics.collector.ts`
- Modify: `libs/events/src/dead-letter/event-failures.module.ts`
- Test: `libs/events/src/dead-letter/dead-letter.metrics.spec.ts`

**Interfaces:**
- Produces: `setDeadLetterCount(topic: string, status: 'failed' | 'held', count: number)`, `DeadLetterMetricsCollector.refresh(): Promise<void>`

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/dead-letter/dead-letter.metrics.spec.ts`:

```ts
import { register } from 'prom-client';
import { DeadLetterMetricsCollector } from './dead-letter-metrics.collector';

async function gauge(topic: string, status: string): Promise<number | undefined> {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === 'events_dead_letters');
  return (metric?.values as Array<{ labels: Record<string, string>; value: number }> | undefined)?.find(
    (v) => v.labels.topic === topic && v.labels.status === status,
  )?.value;
}

describe('events_dead_letters 게이지 (#1016 8번)', () => {
  it('토픽·상태별 안 푼 건수를 쓰고, 사라진 조합은 0 으로 되돌린다', async () => {
    let rows = [
      { topic: 'orders.events.v1', status: 'failed', count: 2 },
      { topic: 'orders.events.v1', status: 'held', count: 5 },
    ];
    const collector = new DeadLetterMetricsCollector({
      db: { select: () => ({ from: () => ({ where: () => ({ groupBy: async () => rows }) }) }) },
    } as never);

    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(2);
    expect(await gauge('orders.events.v1', 'held')).toBe(5);

    rows = [];
    await collector.refresh();
    expect(await gauge('orders.events.v1', 'failed')).toBe(0);
    expect(await gauge('orders.events.v1', 'held')).toBe(0);
  });

  it('조회가 실패해도 던지지 않는다 — 스크레이프를 죽이지 않는다', async () => {
    const collector = new DeadLetterMetricsCollector({
      db: { select: () => ({ from: () => ({ where: () => ({ groupBy: async () => Promise.reject(new Error('db down')) }) }) }) },
    } as never);
    await expect(collector.refresh()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/dead-letter/dead-letter.metrics.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`libs/events/src/dead-letter/dead-letter.metrics.ts`:

```ts
import { Gauge, register } from 'prom-client';

/**
 * 컨슈머 실패 관측 (#1016 8번, 스펙 §6.5). `events_outbox_failed_rows` 와 짝이고 알림 규칙의 대상이다.
 * 라벨은 `topic`·`status` 뿐 — `aggregate_id`·`event_type` 은 카디널리티 폭탄이다(`outbox.metrics.ts` 머리 주석).
 * 모듈 스코프 싱글턴인 이유는 `dlq.metrics.ts` 와 같다.
 */
const deadLettersGauge = new Gauge({
  name: 'events_dead_letters',
  help: 'Unresolved consumer dead letters in this app DB (status=failed is the head of a blocked sequence, held waits behind it)',
  labelNames: ['topic', 'status'],
  registers: [register],
});

export function setDeadLetterCount(topic: string, status: 'failed' | 'held', count: number): void {
  deadLettersGauge.set({ topic, status }, count);
}
```

`libs/events/src/dead-letter/dead-letter-metrics.collector.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { inArray, sql } from 'drizzle-orm';
import { dead_letters } from './dead-letter.schema';
import { setDeadLetterCount } from './dead-letter.metrics';

/** 안 푼 건수를 15초마다 게이지에 쓴다 — 이유는 `OutboxMetricsCollector` 머리 주석(스크레이프 시점 계산 금지)과 같다. */
@Injectable()
export class DeadLetterMetricsCollector {
  private readonly logger = new Logger(DeadLetterMetricsCollector.name);
  /** 한 번이라도 쓴 조합. 다음 tick 에 결과에서 빠지면 0 으로 되돌린다 — 낡은 값이 남지 않게 */
  private readonly known = new Set<string>();

  constructor(private readonly dbService: DbService) {}

  // cron-overlap-safe: 겹쳐도 게이지에 같은 값을 두 번 쓸 뿐인 멱등 갱신이다(#707, OutboxMetricsCollector 와 같음).
  @Cron('*/15 * * * * *')
  async refresh(): Promise<void> {
    try {
      const rows = await this.dbService.db
        .select({ topic: dead_letters.topic, status: dead_letters.status, count: sql<number>`count(*)::int` })
        .from(dead_letters)
        .where(inArray(dead_letters.status, ['failed', 'held']))
        .groupBy(dead_letters.topic, dead_letters.status);

      const seen = new Set<string>();
      for (const row of rows as Array<{ topic: string; status: 'failed' | 'held'; count: number }>) {
        const key = `${row.topic}\u0000${row.status}`;
        seen.add(key);
        this.known.add(key);
        setDeadLetterCount(row.topic, row.status, Number(row.count));
      }
      for (const key of this.known) {
        if (seen.has(key)) continue;
        const [topic, status] = key.split('\u0000') as [string, 'failed' | 'held'];
        setDeadLetterCount(topic, status, 0);
      }
    } catch (error) {
      this.logger.error(`Dead letter metrics refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
```

`event-failures.module.ts` providers 에 `DeadLetterMetricsCollector`. 이 모듈이 `@Cron` 을 쓰므로 imports 에 `SCHEDULE_ROOT`(`@app/shared/schedule/schedule-root`)를 더한다 — `EventsModule` 이 outbox 를 켜면 이미 들어오지만 그것에 기대지 않는다.

- [ ] **Step 4: 통과 + 크론 가드**

Run: `npx jest libs/events/src/dead-letter/dead-letter.metrics.spec.ts libs/cron-once`
Expected: PASS (`cron-once-guard.spec.ts` 가 마커 있는 `@Cron` 을 받아들인다)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/dead-letter/dead-letter.metrics.ts libs/events/src/dead-letter/dead-letter-metrics.collector.ts \
  libs/events/src/dead-letter/dead-letter.metrics.spec.ts libs/events/src/dead-letter/event-failures.module.ts
git commit -m "feat(events): events_dead_letters 게이지 — 안 푼 컨슈머 실패 (#1016 8번)"
```

---

### Task 12: 앱 배선 — core·channel-adapter 컨트롤러와 outbox 설정

**Files:**
- Create: `libs/events/src/dead-letter/event-failures.http.ts`
- Create: `apps/core/src/modules/event-failures/event-failures.module.ts`
- Create: `apps/core/src/modules/event-failures/event-failures.controller.ts`
- Create: `apps/channel-adapter/src/controllers/event-failures.controller.ts`
- Modify: `apps/core/src/app.module.ts`, `apps/core/src/modules/catalog/catalog.module.ts`
- Modify: `apps/channel-adapter/src/adapter.module.ts`
- Test: `apps/core/src/modules/event-failures/event-failures.controller.spec.ts`, `libs/events/src/dead-letter/event-failures.http.spec.ts`

**Interfaces:**
- Consumes: Task 8·9·10 서비스
- Produces: `DiscardFailureDto { reason: string }`, `actorIdOf(user: unknown): string | null`, 라우트(스펙 §9)

- [ ] **Step 1: 실패하는 테스트**

`libs/events/src/dead-letter/event-failures.http.spec.ts`:

```ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { DiscardFailureDto, actorIdOf } from './event-failures.http';

describe('이벤트 실패 HTTP 공용부 (#1016 7·8번)', () => {
  it('종결 사유는 비면 안 되고 500자까지', async () => {
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: '' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: 'x'.repeat(501) }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(DiscardFailureDto, { reason: '수기 처리함' }))).toHaveLength(0);
  });

  it('actor 는 id → userId → sub 순으로 읽고, 없으면 null', () => {
    expect(actorIdOf({ id: 'a', userId: 'b' })).toBe('a');
    expect(actorIdOf({ userId: 'b', sub: 'c' })).toBe('b');
    expect(actorIdOf({ sub: 'c' })).toBe('c');
    expect(actorIdOf(undefined)).toBeNull();
  });
});
```

`apps/core/src/modules/event-failures/event-failures.controller.spec.ts` — 위임만 본다(로직은 lib 스펙이 본다):

```ts
import { EventFailuresController } from './event-failures.controller';

describe('core EventFailuresController (#1016 7·8번)', () => {
  const deadLetters = { summary: jest.fn(), listSequences: jest.fn(), detail: jest.fn() };
  const redriver = { redrive: jest.fn(), discard: jest.fn(), redriveAll: jest.fn() };
  const outbox = { listFailed: jest.fn(), detail: jest.fn(), resend: jest.fn(), discard: jest.fn(), resendAll: jest.fn() };
  const controller = new EventFailuresController(deadLetters as never, redriver as never, outbox as never);

  it('종결은 사유와 JWT 의 사용자 id 를 넘긴다', async () => {
    await controller.discardDeadLetter(7, { reason: '낡음' }, { id: 'admin-1' });
    expect(redriver.discard).toHaveBeenCalledWith(7, 'admin-1', '낡음');
  });

  it('outbox 다시 보내기는 id 와 사용자 id 를 넘긴다', async () => {
    await controller.resendOutbox(3, { userId: 'admin-2' });
    expect(outbox.resend).toHaveBeenCalledWith(3, 'admin-2');
  });

  it('목록은 쿼리 문자열을 그대로 넘긴다 — 파싱은 서비스가 한다', async () => {
    await controller.listDeadLetters('20', '100');
    expect(deadLetters.listSequences).toHaveBeenCalledWith('20', '100');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest libs/events/src/dead-letter/event-failures.http.spec.ts apps/core/src/modules/event-failures`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: lib HTTP 공용부**

`libs/events/src/dead-letter/event-failures.http.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 종결 요청 본문 (스펙 §7.5·§8.4). 컨트롤러는 앱이 선언하지만 본문 모양은 같아야 한다 */
export class DiscardFailureDto {
  @ApiProperty({ description: '종결 사유', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

/** JWT 사용자에서 조치자 id. core·channel-adapter 의 `@User()` 모양이 같지 않아 셋을 차례로 본다 */
export function actorIdOf(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const candidate = user as { id?: unknown; userId?: unknown; sub?: unknown };
  const value = candidate.id ?? candidate.userId ?? candidate.sub;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
```

`index.ts`: `export * from './dead-letter/event-failures.http';`

- [ ] **Step 4: core 컨트롤러·모듈**

`apps/core/src/modules/event-failures/event-failures.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import {
  DeadLetterQueryService,
  DeadLetterRedriver,
  DiscardFailureDto,
  OutboxFailuresService,
  actorIdOf,
} from '@app/events';

/**
 * 이벤트 실패 출구 (#1016 7·8번, 스펙 §9). 전역 가드(admin·master)만 — 정체 보드와 같다.
 * 컨트롤러가 앱에 있는 이유: 앱마다 전역 가드가 달라 라이브러리가 인가를 고를 수 없다(#705).
 */
@ApiTags('Event Failures')
@Controller('event-failures')
export class EventFailuresController {
  constructor(
    private readonly deadLetters: DeadLetterQueryService,
    private readonly redriver: DeadLetterRedriver,
    private readonly outbox: OutboxFailuresService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '이벤트 실패 요약 — 안 푼 컨슈머 실패·outbox FAILED' })
  summary() {
    return this.deadLetters.summary();
  }

  @Get('dead-letters')
  @ApiOperation({ summary: '컨슈머 실패 — 순서 단위 목록(머리 + 뒤 보류 수)' })
  listDeadLetters(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.deadLetters.listSequences(limit, cursor);
  }

  @Get('dead-letters/:id')
  @ApiOperation({ summary: '컨슈머 실패 상세 — envelope·같은 순서·조치 기록' })
  deadLetterDetail(@Param('id', ParseIntPipe) id: number) {
    return this.deadLetters.detail(id);
  }

  @Post('dead-letters/redrive-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '컨슈머 실패 전체 다시 넣기 — 순서마다 한 번씩' })
  redriveAll(@User() user: unknown) {
    return this.redriver.redriveAll(actorIdOf(user));
  }

  @Post('dead-letters/:id/redrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이 행이 속한 순서를 처음부터 다시 넣는다(한 번만 시도)' })
  redriveDeadLetter(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.redriver.redrive(id, actorIdOf(user));
  }

  @Post('dead-letters/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '종결 — 머리면 뒤 보류가 이어서 흐른다' })
  discardDeadLetter(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.redriver.discard(id, actorIdOf(user), dto.reason);
  }

  @Get('outbox/failed')
  @ApiOperation({ summary: 'outbox FAILED 목록 — 같은 주문 뒤 대기 수 포함' })
  listOutbox(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.outbox.listFailed(limit, cursor);
  }

  @Get('outbox/:id')
  @ApiOperation({ summary: 'outbox 행 상세 — 페이로드·오류·조치 기록' })
  outboxDetail(@Param('id', ParseIntPipe) id: number) {
    return this.outbox.detail(id);
  }

  @Post('outbox/resend-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 전체 다시 보내기 — 오래된 순서로 한 번씩' })
  resendAllOutbox(@User() user: unknown) {
    return this.outbox.resendAll(actorIdOf(user));
  }

  @Post('outbox/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 다시 보내기(한 번만 시도)' })
  resendOutbox(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.outbox.resend(id, actorIdOf(user));
  }

  @Post('outbox/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 종결 — 같은 주문 뒤 행이 흐른다' })
  discardOutbox(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.outbox.discard(id, actorIdOf(user), dto.reason);
  }
}
```

`apps/core/src/modules/event-failures/event-failures.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EventFailuresModule as EventFailuresCapability } from '@app/events';
import { EventFailuresController } from './event-failures.controller';

/** #1016 7·8번 — 이 모듈을 import 하는 순간 core 의 컨슈머 실패가 `.dlq` 토픽 대신 `event.dead_letters` 로 간다 */
@Module({
  imports: [EventFailuresCapability],
  controllers: [EventFailuresController],
})
export class CoreEventFailuresModule {}
```

`apps/core/src/app.module.ts` 의 imports 에서 `OrderReconcileModule,` 다음에 `CoreEventFailuresModule,` (import 문 추가).

`apps/core/src/modules/catalog/catalog.module.ts` 의 `EventsModule.forApp({ ... enableOutbox: true, })` 에:

```ts
      // 굳기 전 약 2시간 버티고, 같은 주문의 순서를 지킨다 (#1016 7번, 스펙 D4·§8.2).
      // 아웃박스는 앱 하나에 테이블 하나라 이 설정이 core 전체 outbox 에 적용된다.
      outbox: {
        retryDelaysSeconds: LONG_OUTBOX_RETRY_DELAYS_SECONDS,
        maxRetries: LONG_OUTBOX_MAX_RETRIES,
        sequenceByAggregate: true,
      },
```

(`LONG_OUTBOX_RETRY_DELAYS_SECONDS`, `LONG_OUTBOX_MAX_RETRIES` 를 `@app/events` 에서 import.)

- [ ] **Step 5: channel-adapter 컨트롤러·배선**

`apps/channel-adapter/src/controllers/event-failures.controller.ts` — 라우트 모양은 core 와 같다(admin-web 이 한 클라이언트로 두 앱을 부른다). 다른 것은 머리(필터·접두사·주석)뿐이다:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@app/authorization';
import { GlobalExceptionFilter } from '@app/shared';
import {
  DeadLetterQueryService,
  DeadLetterRedriver,
  DiscardFailureDto,
  OutboxFailuresService,
  actorIdOf,
} from '@app/events';

/**
 * 이벤트 실패 출구 (#1016 7·8번). 인가 데코레이터가 없는 게 의도다 — 이 앱은 전역 `AdminRealmGuard` 가 표시 없는 라우트를
 * 직원 전용으로 기본 차단한다(`event-trace.controller.ts` 와 같다).
 * `@UseFilters` 인 이유: 이 앱엔 전역 예외 필터가 없어 `ConflictError` 등이 500 이 된다. 앱 전체 필터 추가는 범위 밖이다.
 */
@ApiTags('adapter-event-failures')
@UseFilters(new GlobalExceptionFilter())
@Controller('adapter/event-failures')
export class EventFailuresController {
  constructor(
    private readonly deadLetters: DeadLetterQueryService,
    private readonly redriver: DeadLetterRedriver,
    private readonly outbox: OutboxFailuresService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: '이벤트 실패 요약 — 안 푼 컨슈머 실패·outbox FAILED' })
  summary() {
    return this.deadLetters.summary();
  }

  @Get('dead-letters')
  @ApiOperation({ summary: '컨슈머 실패 — 순서 단위 목록(머리 + 뒤 보류 수)' })
  listDeadLetters(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.deadLetters.listSequences(limit, cursor);
  }

  @Get('dead-letters/:id')
  @ApiOperation({ summary: '컨슈머 실패 상세 — envelope·같은 순서·조치 기록' })
  deadLetterDetail(@Param('id', ParseIntPipe) id: number) {
    return this.deadLetters.detail(id);
  }

  @Post('dead-letters/redrive-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '컨슈머 실패 전체 다시 넣기 — 순서마다 한 번씩' })
  redriveAll(@User() user: unknown) {
    return this.redriver.redriveAll(actorIdOf(user));
  }

  @Post('dead-letters/:id/redrive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '이 행이 속한 순서를 처음부터 다시 넣는다(한 번만 시도)' })
  redriveDeadLetter(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.redriver.redrive(id, actorIdOf(user));
  }

  @Post('dead-letters/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '종결 — 머리면 뒤 보류가 이어서 흐른다' })
  discardDeadLetter(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.redriver.discard(id, actorIdOf(user), dto.reason);
  }

  @Get('outbox/failed')
  @ApiOperation({ summary: 'outbox FAILED 목록 — 같은 주문 뒤 대기 수 포함' })
  listOutbox(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.outbox.listFailed(limit, cursor);
  }

  @Get('outbox/:id')
  @ApiOperation({ summary: 'outbox 행 상세 — 페이로드·오류·조치 기록' })
  outboxDetail(@Param('id', ParseIntPipe) id: number) {
    return this.outbox.detail(id);
  }

  @Post('outbox/resend-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 전체 다시 보내기 — 오래된 순서로 한 번씩' })
  resendAllOutbox(@User() user: unknown) {
    return this.outbox.resendAll(actorIdOf(user));
  }

  @Post('outbox/:id/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 다시 보내기(한 번만 시도)' })
  resendOutbox(@Param('id', ParseIntPipe) id: number, @User() user: unknown) {
    return this.outbox.resend(id, actorIdOf(user));
  }

  @Post('outbox/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'outbox FAILED 종결 — 같은 주문 뒤 행이 흐른다' })
  discardOutbox(@Param('id', ParseIntPipe) id: number, @Body() dto: DiscardFailureDto, @User() user: unknown) {
    return this.outbox.discard(id, actorIdOf(user), dto.reason);
  }
}
```

`adapter.module.ts`:
- import: `import { EventFailuresModule, LONG_OUTBOX_MAX_RETRIES, LONG_OUTBOX_RETRY_DELAYS_SECONDS } from '@app/events';` + 컨트롤러 import
- `process.env.KAFKA_BROKERS ? [EventsModule.forApp({...})] : []` 배열에 `EventFailuresModule` 을 함께 넣는다(outbox 디스패처가 있는 조건과 같아야 DI 가 선다)
- 같은 `forApp` 의 `enableOutbox: true,` 다음에 core 와 같은 `outbox: {...}` 블록
- `controllers` 의 `EventTraceController,` 다음에 `...(process.env.KAFKA_BROKERS ? [EventFailuresController] : []),`

- [ ] **Step 6: 통과 + 보안·인가 가드 + 부팅**

Run: `npx jest libs/events/src/dead-letter/event-failures.http.spec.ts apps/core/src/modules/event-failures scripts/security`
Expected: PASS — 새 쓰기 라우트는 `@Public` 이 없어 «키 검증 없는 @Public 쓰기» 감사에 걸리지 않는다

Run: `npm run type-check`
Expected: 에러 0

로컬 부팅 확인(로컬 E2E 인프라가 떠 있을 때): `npm run start:main:dev` 로그에 `Consumer started (groupId=almondyoung-order-consumer)` 가 나오고 `DeadLetterRuntime` 관련 에러가 없을 것. `curl -s localhost:<core포트>/event-failures/summary` 는 인증 없이는 401 이 정상이다.

- [ ] **Step 7: 커밋**

```bash
git add libs/events/src/dead-letter/event-failures.http.ts libs/events/src/dead-letter/event-failures.http.spec.ts libs/events/src/index.ts \
  apps/core/src/modules/event-failures apps/core/src/app.module.ts apps/core/src/modules/catalog/catalog.module.ts \
  apps/channel-adapter/src/controllers/event-failures.controller.ts apps/channel-adapter/src/adapter.module.ts
git commit -m "feat(core,channel-adapter): 이벤트 실패 출구 API 와 outbox 순서·긴 재시도 켜기 (#1016 7·8번)"
```

---

### Task 13: membership 원래 토픽 재발행 API 삭제 + 문서·스크립트 정리

**Files:**
- Modify: `apps/membership/src/controllers/admin-operations.controller.ts`
- Modify: `libs/events/src/dlq/dlq-handler.service.ts`, `libs/events/src/dlq/dlq.types.ts`
- Modify: `libs/events/src/transport/transport.port.ts`
- Modify: `scripts/events/consume-validation-readiness.ts`
- Modify: `docs/adr/0029-events-module-registration-surfaces.md`, `docs/adr/0027-followups.md`, `libs/events/docs/first-look.md`, `libs/events/docs/auto-dlq-guide.md`
- Modify: `docs/superpowers/specs/2026-10-15-event-failure-exits-design.md` (계획 단계 결정 반영)
- Test: 기존 `scripts/events` 게이트 스펙, `scripts/security`

- [ ] **Step 1: 지울 것이 정말 호출처 0 인지 확인**

Run: `grep -rn "drainAndReprocess\|reprocessDLQ\|resolveDLQ\|BatchReprocessResult\|ReprocessOptions\|dlq/reprocess" apps libs scripts --include=*.ts`
Expected: membership 컨트롤러·`dlq-handler.service.ts`·`dlq.types.ts`·`transport.port.ts` 주석·`consume-validation-readiness.ts` 만. 다른 호출처가 있으면 멈추고 보고한다

- [ ] **Step 2: membership 라우트 삭제**

`admin-operations.controller.ts` 에서 `reprocessDlq` 메서드와 그 위 JSDoc 블록을 지운다. 생성자의 `@Optional() private readonly dlqHandler?: DLQHandler,` 를 지운다. import 에서 `DLQHandler, createKafkaConfigFromEnv, getDLQTopicName` 를 지우고, `PAYMENT_STREAM`·`ServiceUnavailableException`·`Optional` 이 파일에서 더 쓰이지 않으면 함께 지운다(`grep -n "PAYMENT_STREAM\|ServiceUnavailableException\|@Optional" <파일>` 로 확인).

- [ ] **Step 3: 라이브러리 메서드 삭제**

`dlq-handler.service.ts` 에서 `reprocessDLQ`·`drainAndReprocess`·`resolveDLQ` 와 그 JSDoc, 쓰이지 않게 된 `Kafka`·`KafkaConfig`·`BatchReprocessResult` import 를 지운다. 클래스 머리 주석의 «DLQ 메시지 재처리» 줄을 «재처리는 원래 토픽 재발행이라 모든 구독자에게 중복을 낸다 — 지웠다(#1016 8번). 켠 앱은 `EventFailuresModule` 의 다시 넣기를 쓴다»로 바꾼다.

`dlq.types.ts` 에서 `ReprocessOptions`·`BatchReprocessResult` 를 지운다(호출처 0 확인 후).

`transport.port.ts` 의 `partition` 주석 «(`DLQHandler.reprocessDLQ` 만 명시적으로 쓴다.)» 를 «(지금 명시적으로 쓰는 곳은 없다.)» 로.

- [ ] **Step 4: 발행 경로 게이트 목록 정리**

`scripts/events/consume-validation-readiness.ts`:
- `SEND_PATHS` 배열에서 `site: 'libs/events/src/dlq/dlq-handler.service.ts'` 이고 `what` 이 `'DLQHandler.reprocessDLQ — …'` 인 항목을 지운다(`sendToDLQ` 항목은 남긴다)
- 머리 주석 «한계» 절의 «`DLQHandler.reprocessDLQ`(관리자 수동 재처리)가 이 한계와 같은 성질이라 아래에서 면제된다 — …» 두 줄을 지운다

Run: `npx jest scripts/events`
Expected: PASS — 게이트가 실제 `transport.send` 호출 지점 수와 목록을 대조한다. 실패하면 목록과 호출 지점이 어긋난 것이니 메시지대로 맞춘다

- [ ] **Step 5: 문서**

- ADR-0029 의 «`DLQHandler.reprocessDLQ` 는 명시적으로 면제한다» 문단 끝에 한 줄: «**2026-10 삭제(#1016 8번).** 원래 토픽 재발행은 모든 구독자에게 중복을 내서 지웠다 — 면제 목록에서도 빠졌다.»
- `docs/adr/0027-followups.md` 의 «DLQ reprocess topic 자유입력» 항목에 «→ 라우트 자체가 #1016 8번에서 삭제됨» 을 붙인다
- `libs/events/docs/first-look.md` 의 «재처리 로직 내장 (reprocessDLQ)» 를 «재처리: `EventFailuresModule` 을 켠 앱은 앱 DB 의 실패 행을 그 핸들러에만 다시 넣는다(원래 토픽 재발행은 없다)» 로
- `libs/events/docs/auto-dlq-guide.md` 에 절 하나: «실패 테이블 모드(#1016 8번) — `EventFailuresModule` 을 import 한 앱은 `.dlq` 토픽 대신 `event.dead_letters` 에 적는다. 같은 `aggregateId` 의 뒤 메시지는 보류된다. 출구는 앱의 `/event-failures` API» (그 문서의 기존 «DLQ 재처리» 서술이 `reprocessDLQ` 를 가리키면 함께 고친다)
- 스펙 머리의 «계획 단계 정정» 노트 아래에 이 계획의 «스펙과 달라진 점» 표를 한 줄씩 요약해 옮긴다(§6.6 스위치, §6.3-3 파싱 실패, §7.2 서버 참조, §9 channel-adapter 필터)

- [ ] **Step 6: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2`
Expected: 에러 0 · 실패 0

- [ ] **Step 7: 커밋**

```bash
git add apps/membership/src/controllers/admin-operations.controller.ts libs/events/src/dlq libs/events/src/transport/transport.port.ts \
  scripts/events/consume-validation-readiness.ts docs/adr/0029-events-module-registration-surfaces.md docs/adr/0027-followups.md \
  libs/events/docs docs/superpowers/specs/2026-10-15-event-failure-exits-design.md
git commit -m "refactor(events,membership)!: 원래 토픽 DLQ 재발행 API 삭제 — 모든 구독자에게 중복을 낸다 (#1016 8번)"
```

---

### Task 14: 배포 전 읽기 전용 확인 스크립트 + #1016 운영 체크박스 + 최종 게이트

**Files:**
- Create: `scripts/ops/1016-7-8-predeploy-check.js`
- (PR 본문·#1016 본문은 PR 을 열 때 고친다 — Step 4)

- [ ] **Step 1: 스크립트 작성**

`scripts/ops/1016-7-8-predeploy-check.js` — `1016-36-ambiguous-refund-preflight.js` 와 같은 실행 방식(사람이 `sst shell` 안에서):

```js
// scripts/ops/1016-7-8-predeploy-check.js
// READ ONLY. #1016 7·8번 배포 전 확인 (스펙 §11).
//   ① core·channel_adapter 의 outbox FAILED 목록 — sequenceByAggregate 를 켜는 순간 같은 주문의 새 이벤트를 막기 시작한다.
//      배포 직후 화면에서 다시 보내거나 종결한다
//   ② 새 선택 조건의 EXPLAIN ANALYZE — 수백 ms 를 넘으면 (topic, aggregate_id, created_at) 부분 인덱스를 먼저 더한다
//   ③ 상태별 건수
// 실행(사람): sst tunnel 을 띄운 뒤
//   cd deployments/lcnine/services && npx sst shell --stage live -- node -e "$(cat ../../../scripts/ops/1016-7-8-predeploy-check.js)"
const postgres = require('postgres');
const d = JSON.parse(process.env.SST_RESOURCE_Db);
const connect = (database) =>
  postgres({
    host: process.env.DB_TUNNEL_HOST || d.host,
    port: Number(process.env.DB_TUNNEL_PORT || d.port),
    username: d.username,
    password: d.password,
    database,
    ssl: 'require',
    max: 1,
  });

// 디스패처 acquireEventBatch 의 조건과 같아야 한다(outbox-dispatcher.service.ts)
const ACQUIRE_WITH_SEQUENCE = `
  explain analyze
  select id from event.outbox_events o
  where o.status = 'PENDING' and o.retry_count < 8 and o.next_attempt_at <= now()
    and not exists (
      select 1 from event.outbox_events previous
      where previous.topic = o.topic and previous.aggregate_id = o.aggregate_id
        and previous.status in ('PENDING', 'PROCESSING', 'FAILED')
        and (previous.created_at < o.created_at or (previous.created_at = o.created_at and previous.id < o.id))
    )
  order by o.created_at limit 100`;

(async () => {
  for (const database of ['core', 'channel_adapter']) {
    const sql = connect(database);
    try {
      console.log(`\n== ${database}`);
      const byStatus = await sql`select status, count(*)::int as n from event.outbox_events group by 1 order by 1`;
      console.log('③ 상태별:', byStatus.map((r) => `${r.status}=${r.n}`).join(' '));
      const failed = await sql`
        select id, topic, event_type, aggregate_id, retry_count,
               created_at at time zone 'Asia/Seoul' as created_kst, left(coalesce(error_message, ''), 160) as error
        from event.outbox_events where status = 'FAILED' order by created_at`;
      console.log(`① FAILED ${failed.length}건`);
      for (const row of failed) console.log('  ', JSON.stringify(row));
      const plan = await sql.unsafe(ACQUIRE_WITH_SEQUENCE);
      console.log('② 계획:');
      for (const row of plan) console.log('  ', row['QUERY PLAN']);
    } finally {
      await sql.end();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: 문법 확인 (DB 없이)**

Run: `node --check scripts/ops/1016-7-8-predeploy-check.js`
Expected: 출력 없음(문법 OK)

- [ ] **Step 3: 최종 게이트**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0

Run: `npm run test:core:integration:local -- "(libs/events)/.*integration"`
Expected: PASS — Task 2·4·8·9·10 의 통합 스펙 전부

Run: `npx jest scripts/security`
Expected: PASS

- [ ] **Step 4: 커밋 → PR → #1016 운영 체크박스**

```bash
git add scripts/ops/1016-7-8-predeploy-check.js
git commit -m "chore(ops): #1016 7·8번 배포 전 읽기 전용 확인 — 옛 outbox FAILED·선택 조건 계획"
```

PR 본문에 배포 절차를 적고(아래), 머지되면 #1016 본문 «## 남은 운영 작업»에 체크박스를 단다. **본문을 고칠 때 코드에서 도출되는 수치를 적지 않는다(CLAUDE.md «이슈 본문»)** — 스크립트 경로를 적는다.

```markdown
- [ ] 7·8번 배포 전 — #1074(#1073) 가 라이브인지 확인(컨슈머 커밋이 켜져 있어야 «기록 실패 → 다시 온다»가 참). `scripts/ops/1016-7-8-predeploy-check.js` ①②③ 실행: 옛 outbox `FAILED` 목록을 저장해 두고, ② 계획이 수백 ms 를 넘으면 배포를 멈추고 부분 인덱스를 먼저 더한다
- [ ] 7·8번 배포 — core·channel-adapter `db:migrate`(`add-event-dead-letters`) → `sst deploy`. **순서가 바뀌면 새 코드가 없는 테이블에 써서 컨슈머 실패 기록이 매번 실패하고 커밋이 멈춘다.** membership 은 라우트 삭제만이라 순서 무관. 배포 뒤 core 로그 `Consumer started` 와 `/metrics` 의 `events_dead_letters` 시리즈 확인
- [ ] 7·8번 배포 직후 — 위 ①의 옛 `FAILED` 를 화면(PR 2)이나 API(`POST /event-failures/outbox/:id/resend|discard`)로 처리. 처리 전까지 같은 주문의 새 이벤트가 그 뒤에 막힌다
- [ ] 7·8번 알림 — Grafana `events_outbox_failed_rows > 0`, `events_dead_letters{status="failed"} > 0`
```

---

## Self-Review 기록

1. **스펙 커버리지** — §5.1·5.2(Task 3), §5.3(Task 1 상태값), §6.1·6.2·6.4(Task 6), §6.3(Task 6·4, -3 은 «달라진 점»), §6.5(Task 11 + Task 6 의 카운터), §6.6(Task 7, 스위치 변경), §7.1~7.7(Task 8), §8.1·8.2(Task 1·2·12), §8.3~8.5(Task 9), §8.6(Task 9 — 메트릭 수집기가 `FAILED` 만 세므로 별도 작업 없음), §9(Task 10·12), §10(PR 2), §11(Task 14), §12(각 Task), §13 범위 밖 유지, D7(Task 13)
2. **플레이스홀더** — 없음. channel-adapter 컨트롤러는 core 와 같은 본문을 전부 적었다(라우트 모양이 같아야 admin-web 이 한 클라이언트를 쓴다)
3. **타입 일관성** — `DeadLetterRecorder`(Task 3) ↔ `DeadLetterStore`(Task 4) ↔ 인터셉터(Task 6) ↔ 배선(Task 7) 메서드 넷이 같다. `OutboxDispatchRow`(Task 9) 는 Task 9 에서 이름을 바꾸며 처음 export 한다. `handlerIdOf` 의 `클래스.메서드` 는 Task 7·8 테스트의 `'FailingConsumer.onCreated'`·`'C.on'` 과 같은 모양
4. **Review Focus** — 다섯 줄 각각 소유 Task 의 테스트로 들어갔다(1→Task 4 «재전달», 2·3→Task 6, 4→Task 8, 5→Task 2 + Task 14 ①)
