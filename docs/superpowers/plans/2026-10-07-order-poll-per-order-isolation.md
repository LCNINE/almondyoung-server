# 주문 수집의 주문 단위 격리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 주문이 수집 어느 단계(조회·번역·주문 적재·lifecycle 적재)에서 실패해도 채널 폴링이 멈추지 않고, 그 주문은 `order_collection_failures` 에 남아 상한 4회까지 자동 재시도된 뒤 사람 몫이 된다 (#1016 1번 행).

**Architecture:** 기존 폴링 루프의 항목 처리를 `try/catch` 로 감싸 실패를 새 사유 `order_collection_processing_failed` 행으로 기록하고 워터마크는 지나간다(기록 못 하면 지금처럼 멈춘다). provider 는 조회·번역 실패를 삼키지 않고 `processingFailures` 로 올린다. 채널 주기 끝에 `syncOrder` 와 같은 처리부(`processSyncFetch`)로 재시도한다. 정체 보드·배지는 «재시도를 다 쓴 행»만 센다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest(ts-jest), Next.js admin-web, `@app/events` outbox.

**Spec:** `docs/superpowers/specs/2026-10-07-order-poll-per-order-isolation-design.md`

## Global Constraints

- 검증 게이트: `npm run type-check` 에러 0, `npx jest` 실패 0, admin-web `(cd apps/admin-web && npx tsc --noEmit)` 에러 0.
- 상한: `PROCESSING_FAILURE_MAX_ATTEMPTS = 4`(최초 1회 + 자동 3회), 재시도 배치 `PROCESSING_FAILURE_RETRY_BATCH = 20`(채널당 주기마다).
- 새 reason 값은 정확히 `order_collection_processing_failed`. 단계 값은 정확히 `fetch` · `translate` · `enqueue_order` · `enqueue_lifecycle`.
- 마이그레이션은 컬럼 추가뿐(expand). 배포 순서 **`migrate → deploy`**. 생성된 SQL 은 손으로 고치지 않는다 — 틀렸으면 `git rm` 후 `schema.ts` 를 고쳐 재생성.
- `schema.ts` + 생성된 `drizzle/<timestamp>_*.sql` + `drizzle/meta/` 는 **한 커밋**.
- DB 통합 스펙은 `describeIfDb`(`process.env.DATABASE_URL`) 가드. 스펙 안에서 `dotenv.config()` 금지 — `.env` 는 바깥에서 주입한다.
- 프로덕션 코드에 `any`/`as` 캐스팅 금지(스펙 파일의 기존 `as any` 목 주입 관례는 그대로 따른다).
- 주석은 주변 코드처럼 한국어, «왜»만 쓴다.
- 커밋 메시지 끝에 `Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`.
- 브랜치: `feat/1016-row1-order-poll-isolation` (spec 커밋 `9362e9693` 이 이미 있다).

## Review Focus

1. **DB 시각 기준이 갈리는 경우** — `updated_at` 은 tz 없는 timestamp 다. 재시도 선별의 `updated_at < cycleStartedAt` 이 JS `Date` 와 같은 기준으로 비교돼야 「방금 실패한 행은 이번 주기에 다시 안 한다」가 성립한다. → Task 1 통합 스펙의 «1초 전/후» 테스트가 지킨다.
2. **한 주기에 실패한 주문 둘과 정상 주문의 lifecycle 이 섞이는 경우** — 실패한 주문의 lifecycle 만 건너뛰고 다른 주문의 lifecycle 은 정상 발행돼야 한다. → Task 3 테스트 «실패 주문의 lifecycle 만 건너뛴다».
3. **소진 순간 로그가 한 번만 나는가** — `exhaustedNow` 가 true 인 한 번만 `logger.error`, 그 뒤 수동 replay 실패(5회째)에선 안 난다. → Task 1(서비스 반환값) + Task 3(로그).
4. **syncable 이 아닌 provider** — 미래의 쿠팡처럼 `fetchOrderForSync` 가 없는 provider 는 재시도를 건너뛰고 행은 그대로 둔다(throw 하지 않는다). → Task 4 테스트.
5. **재시도 중 오류가 채널 sync 상태를 바꾸지 않는가** — 재시도 선별 쿼리가 throw 해도 `recordSyncFailure` 가 불리지 않고 `recordSyncComplete` 는 이미 불린 상태여야 한다. → Task 4 테스트.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `apps/channel-adapter/src/schema.ts` (수정) | `order_collection_failures` 에 `attempt_count`·`failed_stage`·`last_error` |
| `apps/channel-adapter/drizzle/<ts>_add-order-processing-failure-columns.sql` (생성) | 위 컬럼 추가 마이그레이션 |
| `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts` (수정) | 새 reason 상수, `OrderProcessingStage`, `OrderProcessingFailureItem`, `FetchOrdersResult.processingFailures` |
| `apps/channel-adapter/src/services/order-collection/order-processing-stage.error.ts` (생성) | 단계를 실어 나르는 내부 에러 + `errorMessage` 헬퍼 |
| `apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts` (수정) | 처리 실패 upsert·조회 4종, 요약에서 재시도 중 제외, `markReplayed` note |
| `apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts` (생성) | 위 서비스의 실 DB 동작 |
| `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts` (수정) | `WindowedFetchResult.fetchFailures` |
| `apps/channel-adapter/src/services/order-collection/naver-order.source.ts` (수정) | 단건 조회 실패를 `fetchFailures` 로 |
| `apps/channel-adapter/src/services/order-collection/translating-order.provider.ts` (수정) | 조회·번역 실패를 `processingFailures` 로, `fetchOrderForSync` 번역 실패에 단계 태그 |
| `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` (수정) | 루프 격리, 성공 시 닫기, 고아 행 전부 닫기, `processSyncFetch`, 재시도, 수동 replay |
| `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts` (수정) | 목 보강 + 격리·재시도 테스트 |
| `apps/channel-adapter/src/controllers/order-collection-failures.controller.ts` (수정) | Swagger enum, replay 안내 |
| `apps/admin-web/src/features/mall/quarantine/guidance.ts` (+spec) (수정) | 사유·단계·재시도 라벨, replay 메시지 |
| `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.shape.ts` (+spec) (수정) | DTO 필드, replay status, `formatQuarantineCount` 삭제 |
| `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.client.ts` (수정) | `formatQuarantineCount` 재수출 삭제 |
| `apps/admin-web/src/components/layout/quarantine-menu-badge.tsx` (수정) | 요약 엔드포인트로 |
| `apps/admin-web/src/features/mall/quarantine/components/quarantine-table/index.tsx` (수정) | 단계·재시도 표시 |
| `apps/admin-web/src/features/mall/quarantine/components/quarantine-detail-dialog/index.tsx` (수정) | 처리 실패 행의 단계·에러 표시 |

---

### Task 1: 실패 기록 모델 — 컬럼·사유·서비스

**Files:**
- Modify: `apps/channel-adapter/src/schema.ts` (`orderCollectionFailures`, `errorMessage` 바로 아래)
- Create: `apps/channel-adapter/drizzle/<timestamp>_add-order-processing-failure-columns.sql` (drizzle-kit 생성)
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts:13-19`, `:85-98`
- Modify: `apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts`
- Test: `apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts`

**Interfaces:**
- Produces:
  - `ORDER_COLLECTION_PROCESSING_FAILED = 'order_collection_processing_failed' as const`
  - `type OrderProcessingStage = 'fetch' | 'translate' | 'enqueue_order' | 'enqueue_lifecycle'`
  - `interface OrderProcessingFailureItem { externalOrderId: string; sourceUpdatedAt: string; stage: OrderProcessingStage; error: string; input: Record<string, unknown> }`
  - `FetchOrdersResult.processingFailures?: OrderProcessingFailureItem[]`
  - `PROCESSING_FAILURE_MAX_ATTEMPTS = 4`, `PROCESSING_FAILURE_RETRY_BATCH = 20` (failure service 파일에서 export)
  - `OrderCollectionFailureService.recordProcessingFailure(channel: string, failure: OrderProcessingFailureItem, tx?: DbTx): Promise<{ record: OrderCollectionFailure; exhaustedNow: boolean }>`
  - `findOpenProcessingFailures(channel: string, externalOrderIds: string[]): Promise<Map<string, OrderCollectionFailure>>`
  - `findRetryableProcessingFailures(channel: string, before: Date, limit?: number): Promise<OrderCollectionFailure[]>`
  - `findAllOpenByExternalOrderId(channel: string, externalOrderId: string): Promise<OrderCollectionFailure[]>`
  - `markReplayed(id: string, wmsOrderId?: string, note?: string): Promise<void>` (note 추가)
  - 행 타입 `OrderCollectionFailure` 에 `attemptCount: number`, `failedStage: string | null`, `lastError: string | null` 이 생긴다

- [ ] **Step 1: 로컬 DB 확인**

Run: `docker ps --format '{{.Names}}' | grep postgres`
Expected: `almondyoung-server-postgres-1` 이 보인다. 없으면 `npm run bootstrap:e2e:local` 로 띄운다.

- [ ] **Step 2: 실패하는 통합 테스트를 쓴다**

`apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts`:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import {
  OrderCollectionFailureService,
  PROCESSING_FAILURE_MAX_ATTEMPTS,
} from './order-collection-failure.service';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';

/**
 * 실행:
 *   npx dotenv -e apps/channel-adapter/.env -- npx jest --runInBand \
 *     apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('처리 실패 기록 (PostgreSQL integration, #1016 1번 행)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let service: OrderCollectionFailureService;
  const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client);
    service = new OrderCollectionFailureService({ db } as never);
  });
  afterEach(async () => {
    await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
  });
  afterAll(async () => {
    await client.end({ timeout: 0 });
  });

  const failure = (externalOrderId: string, overrides: Partial<OrderProcessingFailureItem> = {}): OrderProcessingFailureItem => ({
    externalOrderId,
    sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
    stage: 'enqueue_order',
    error: 'contract violation',
    input: { createPayload: { externalOrderId } },
    ...overrides,
  });
  const setUpdatedAt = (externalOrderId: string, at: Date) =>
    db
      .update(orderCollectionFailures)
      .set({ updatedAt: at })
      .where(and(eq(orderCollectionFailures.channel, channel), eq(orderCollectionFailures.externalOrderId, externalOrderId)));

  it('열린 행에 다시 실패하면 횟수를 누적하고 단계·에러·입력을 갱신한다', async () => {
    const first = await service.recordProcessingFailure(channel, failure('A'));
    const second = await service.recordProcessingFailure(
      channel,
      failure('A', { stage: 'enqueue_lifecycle', error: 'lifecycle broke', input: { eventKey: 'cancelled' } }),
    );

    expect(first.record.attemptCount).toBe(1);
    expect(second.record).toMatchObject({
      id: first.record.id,
      reason: ORDER_COLLECTION_PROCESSING_FAILED,
      status: 'quarantined',
      attemptCount: 2,
      failedStage: 'enqueue_lifecycle',
      lastError: 'lifecycle broke',
      rawOrder: { eventKey: 'cancelled' },
      errorMessage: null,
    });
  });

  it('exhaustedNow 는 횟수가 정확히 상한에 닿은 한 번만 true 다', async () => {
    const flags: boolean[] = [];
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS + 1; i++) {
      flags.push((await service.recordProcessingFailure(channel, failure('A'))).exhaustedNow);
    }
    expect(flags).toEqual([false, false, false, true, false]);
  });

  it('종결된 행이 다시 실패하면 새 사건이라 1 부터 다시 연다', async () => {
    const first = await service.recordProcessingFailure(channel, failure('A'));
    await service.recordProcessingFailure(channel, failure('A'));
    await service.markReplayed(first.record.id, undefined, '닫음');

    const reopened = await service.recordProcessingFailure(channel, failure('A'));

    expect(reopened.record).toMatchObject({ status: 'quarantined', attemptCount: 1, errorMessage: null, replayedAt: null });
  });

  it('markReplayed 의 note 는 error_message 에 남는다', async () => {
    const { record } = await service.recordProcessingFailure(channel, failure('A'));
    await service.markReplayed(record.id, undefined, '식별 실패 격리로 넘어감');
    await expect(service.findById(record.id)).resolves.toMatchObject({
      status: 'replayed',
      errorMessage: '식별 실패 격리로 넘어감',
    });
  });

  it('요약은 재시도가 남은 처리 실패를 빼고, 소진된 처리 실패와 다른 사유는 센다', async () => {
    await service.recordProcessingFailure(channel, failure('retrying'));
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS; i++) {
      await service.recordProcessingFailure(channel, failure('exhausted'));
    }
    await service.recordFailure(channel, {
      externalOrderId: 'identification',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });

    await expect(service.summarizeQuarantined({ channel })).resolves.toMatchObject({ quarantined: 2 });
  });

  it('재시도 대상은 열린·처리 실패·상한 미만·주기 시작 전 갱신 행이고, 오래된 순으로 상한까지만', async () => {
    const now = Date.now();
    await service.recordProcessingFailure(channel, failure('old'));
    await setUpdatedAt('old', new Date(now - 20 * 60_000));
    await service.recordProcessingFailure(channel, failure('older'));
    await setUpdatedAt('older', new Date(now - 30 * 60_000));
    for (let i = 0; i < PROCESSING_FAILURE_MAX_ATTEMPTS; i++) {
      await service.recordProcessingFailure(channel, failure('exhausted'));
    }
    await setUpdatedAt('exhausted', new Date(now - 30 * 60_000));
    const closed = await service.recordProcessingFailure(channel, failure('closed'));
    await service.markReplayed(closed.record.id);
    await setUpdatedAt('closed', new Date(now - 30 * 60_000));
    await service.recordFailure(channel, {
      externalOrderId: 'identification',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });
    await setUpdatedAt('identification', new Date(now - 30 * 60_000));
    await service.recordProcessingFailure(channel, failure('fresh')); // updated_at = 지금

    const before = new Date(now - 60_000);
    const rows = await service.findRetryableProcessingFailures(channel, before);
    expect(rows.map((row) => row.externalOrderId)).toEqual(['older', 'old']);

    const limited = await service.findRetryableProcessingFailures(channel, before, 1);
    expect(limited.map((row) => row.externalOrderId)).toEqual(['older']);
  });

  it('방금 갱신한 행은 1초 전 기준에선 빠지고 1초 뒤 기준에선 잡힌다 — JS Date 와 같은 시각 기준이다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));

    const excluded = await service.findRetryableProcessingFailures(channel, new Date(Date.now() - 1_000));
    const included = await service.findRetryableProcessingFailures(channel, new Date(Date.now() + 1_000));

    expect(excluded).toEqual([]);
    expect(included.map((row) => row.externalOrderId)).toEqual(['A']);
  });

  it('findOpenProcessingFailures 는 열린 처리 실패 행만 주문 id 로 묶어 준다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));
    const closed = await service.recordProcessingFailure(channel, failure('B'));
    await service.markReplayed(closed.record.id);

    const open = await service.findOpenProcessingFailures(channel, ['A', 'B', 'C']);

    expect([...open.keys()]).toEqual(['A']);
    await expect(service.findOpenProcessingFailures(channel, [])).resolves.toEqual(new Map());
  });

  it('findAllOpenByExternalOrderId 는 사유가 달라도 열린 행을 전부 준다', async () => {
    await service.recordProcessingFailure(channel, failure('A'));
    await service.recordFailure(channel, {
      externalOrderId: 'A',
      sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
    });

    const rows = await service.findAllOpenByExternalOrderId(channel, 'A');

    expect(rows.map((row) => row.reason).sort()).toEqual(
      [CHANNEL_PRODUCT_IDENTIFICATION_FAILED, ORDER_COLLECTION_PROCESSING_FAILED].sort(),
    );
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `npm run type-check 2>&1 | grep order-collection-failure-processing | head`
Expected: `ORDER_COLLECTION_PROCESSING_FAILED`·`recordProcessingFailure` 등이 없다는 TS 에러.

- [ ] **Step 4: 인터페이스 타입을 더한다**

`channel-order-provider.interface.ts` 의 상수·유니온(13-19행)을 다음으로 바꾼다:

```ts
export const CHANNEL_PRODUCT_IDENTIFICATION_FAILED = 'channel_product_identification_failed' as const;
export const COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED = 'collected_order_modification_not_accepted' as const;
/**
 * 수집 처리 중 주문 하나가 실패했다 (#1016 1번 행). 식별 실패와 달리 원인이 데이터·계약·일시 오류 무엇이든
 * 될 수 있어 `failed_stage`·`last_error` 가 원인을 들고, 상한까지 자동 재시도한다.
 */
export const ORDER_COLLECTION_PROCESSING_FAILED = 'order_collection_processing_failed' as const;

export type OrderCollectionFailureReason =
  | typeof CHANNEL_PRODUCT_IDENTIFICATION_FAILED
  | typeof COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED
  | typeof ORDER_COLLECTION_PROCESSING_FAILED;

/** 주문 하나가 실패한 단계. 격리 행의 `failed_stage` 값이다. */
export type OrderProcessingStage = 'fetch' | 'translate' | 'enqueue_order' | 'enqueue_lifecycle';

/**
 * 주문 하나의 처리 실패 (#1016 1번 행). 한 주문의 실패가 채널 폴링 전체를 멈추지 않도록 provider·오케스트레이터가
 * throw 대신 이 항목으로 기록한다. `input` 은 실패한 그 입력 — 원인이 행 안에서 보이게 하려는 것이고 되살릴 때는 쓰지 않는다.
 */
export interface OrderProcessingFailureItem {
  externalOrderId: string;
  /** 워터마크 근거. 조회 실패면 채널이 알려 준 변경 시각이다. */
  sourceUpdatedAt: string;
  stage: OrderProcessingStage;
  error: string;
  input: Record<string, unknown>;
}
```

`FetchOrdersResult` 에 필드를 더한다(`lifecycleEvents?` 바로 아래):

```ts
  /** 조회·번역 단계에서 실패한 주문 (#1016 1번 행). 오케스트레이터가 처리 실패 행으로 기록하고 지나간다. */
  processingFailures?: OrderProcessingFailureItem[];
```

- [ ] **Step 5: 스키마에 컬럼을 더한다**

`apps/channel-adapter/src/schema.ts` 의 `orderCollectionFailures` 에서 `errorMessage: text('error_message'),` 바로 아래에:

```ts
    /**
     * 처리 실패(`order_collection_processing_failed`) 행만 쓰는 세 칸 (#1016 1번 행). 다른 사유 행은 0·null 이다.
     * `error_message` 는 종결 사유 칸이라 실패 원인을 섞지 않는다.
     */
    attemptCount: integer('attempt_count').notNull().default(0),
    failedStage: varchar('failed_stage', { length: 30 }),
    lastError: text('last_error'),
```

(`integer`·`varchar`·`text` 는 이미 import 돼 있다.)

- [ ] **Step 6: 마이그레이션을 생성하고 검토한다**

Run: `npm run db:generate:channel-adapter -- --name add-order-processing-failure-columns`
Expected: `apps/channel-adapter/drizzle/<timestamp>_add-order-processing-failure-columns.sql` 생성. 내용은 정확히 이 셋뿐이어야 한다:

```sql
ALTER TABLE "order_collection_failures" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_collection_failures" ADD COLUMN "failed_stage" varchar(30);--> statement-breakpoint
ALTER TABLE "order_collection_failures" ADD COLUMN "last_error" text;
```

다른 테이블의 변경이 섞여 있으면 멈추고 보고한다(스냅샷 체인 문제다 — 손으로 지우지 않는다).

- [ ] **Step 7: 로컬 DB 에 적용한다**

Run: `npx drizzle-kit migrate --config apps/channel-adapter/drizzle.config.ts`
Expected: 새 마이그레이션 1건 적용, 에러 없음. (`drizzle.config.ts` 가 `apps/channel-adapter/.env` 의 `localhost` DB 를 쓴다.)

- [ ] **Step 8: 서비스를 구현한다**

`order-collection-failure.service.ts` 의 import 를 바꾸고 상수를 더한다:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, orderCollectionFailures } from '../../schema';
import { NewOrderCollectionFailure, OrderCollectionFailure, OrderCollectionFailureStatus } from '../../types';
import {
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderCollectionFailureItem,
  OrderCollectionFailureReason,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';

/** 최초 실패 1회 + 자동 재시도 3회. 이 횟수에 닿은 열린 처리 실패 행이 «사람 몫»이다 (#1016 1번 행 스펙 §4.5). */
export const PROCESSING_FAILURE_MAX_ATTEMPTS = 4;
/** 채널당 한 주기에 자동 재시도할 행 수 상한 — 네이버 API 호출량과 주기 길이의 상한이다 (스펙 §6.2). */
export const PROCESSING_FAILURE_RETRY_BATCH = 20;
```

`recordFailure` 아래에 추가:

```ts
  /**
   * 주문 하나의 처리 실패를 기록한다 (#1016 1번 행 스펙 §4.4).
   *
   * `recordFailure` 와 달리 **횟수를 누적한다** — 초기화하면 계속 바뀌는 주문이 영영 소진되지 않는다.
   * 종결된 행이 다시 실패하면 새 사건이라 1 부터 센다. 이어 세면 한 번 풀린 주문이 다음 실패에서
   * 자동 재시도 없이 곧바로 사람 몫이 된다.
   */
  async recordProcessingFailure(
    channel: string,
    failure: OrderProcessingFailureItem,
    tx?: DbTx,
  ): Promise<{ record: OrderCollectionFailure; exhaustedNow: boolean }> {
    const now = new Date();
    const values: NewOrderCollectionFailure = {
      channel,
      externalOrderId: failure.externalOrderId,
      reason: ORDER_COLLECTION_PROCESSING_FAILED,
      affectedLineIds: [],
      affectedLines: null,
      rawOrder: failure.input,
      sourceUpdatedAt: parseTimestamp(failure.sourceUpdatedAt),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      attemptCount: 1,
      failedStage: failure.stage,
      lastError: failure.error,
      updatedAt: now,
    };

    const exec = (trx: DbTx | DbService<typeof channelAdapterSchema>['db']) =>
      trx
        .insert(orderCollectionFailures)
        .values(values)
        .onConflictDoUpdate({
          target: [
            orderCollectionFailures.channel,
            orderCollectionFailures.externalOrderId,
            orderCollectionFailures.reason,
          ],
          set: {
            rawOrder: values.rawOrder,
            sourceUpdatedAt: values.sourceUpdatedAt,
            attemptCount: sql`CASE WHEN ${orderCollectionFailures.status} = 'quarantined' THEN ${orderCollectionFailures.attemptCount} + 1 ELSE 1 END`,
            failedStage: values.failedStage,
            lastError: values.lastError,
            status: 'quarantined',
            replayedAt: null,
            replayedWmsOrderId: null,
            errorMessage: null,
            updatedAt: now,
          },
        })
        .returning();

    const [record] = await exec(tx ?? this.db.db);
    // 정확히 상한에 닿은 한 번만 true — 소진 로그를 매 주기 반복하지 않기 위함이다(스펙 §6.4).
    return { record, exhaustedNow: record.attemptCount === PROCESSING_FAILURE_MAX_ATTEMPTS };
  }

  /** 이번 폴링 항목들의 주문 중 열린 처리 실패 행. 그 주문이 이번 주기에 성공하면 닫는 근거다 (스펙 §5.4). */
  async findOpenProcessingFailures(
    channel: string,
    externalOrderIds: string[],
  ): Promise<Map<string, OrderCollectionFailure>> {
    if (externalOrderIds.length === 0) {
      return new Map();
    }
    const rows = await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.reason, ORDER_COLLECTION_PROCESSING_FAILED),
          eq(orderCollectionFailures.status, 'quarantined'),
          inArray(orderCollectionFailures.externalOrderId, externalOrderIds),
        ),
      );
    return new Map(rows.map((row) => [row.externalOrderId, row]));
  }

  /**
   * 자동 재시도 대상 (스펙 §6.2). `before` 는 이번 주기 시작 시각이다 — 방금 실패한 행을 몇 초 뒤에 또 시도해
   * 한 주기에 횟수를 다 써 버리지 않게 막고, 그래서 «주기당 1회»가 성립한다.
   */
  async findRetryableProcessingFailures(
    channel: string,
    before: Date,
    limit: number = PROCESSING_FAILURE_RETRY_BATCH,
  ): Promise<OrderCollectionFailure[]> {
    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.reason, ORDER_COLLECTION_PROCESSING_FAILED),
          eq(orderCollectionFailures.status, 'quarantined'),
          lt(orderCollectionFailures.attemptCount, PROCESSING_FAILURE_MAX_ATTEMPTS),
          lt(orderCollectionFailures.updatedAt, before),
        ),
      )
      .orderBy(asc(orderCollectionFailures.updatedAt))
      .limit(limit);
  }

  /** 사유와 무관하게 그 주문의 열린 행 전부. 종결된 주문은 어느 사유로도 수집할 수 없다 (스펙 §5.5). */
  async findAllOpenByExternalOrderId(channel: string, externalOrderId: string): Promise<OrderCollectionFailure[]> {
    return await this.db.db
      .select()
      .from(orderCollectionFailures)
      .where(
        and(
          eq(orderCollectionFailures.channel, channel),
          eq(orderCollectionFailures.externalOrderId, externalOrderId),
          eq(orderCollectionFailures.status, 'quarantined'),
        ),
      );
  }
```

`summarizeQuarantined` 의 조건 배열을 바꾼다:

```ts
    const conditions: SQL[] = [
      eq(orderCollectionFailures.status, 'quarantined'),
      // 자동 재시도가 남은 처리 실패는 아직 사람 몫이 아니다 — 정체 보드 0단계와 배지가 같은 숫자를 본다 (스펙 §7.1).
      sql`(${orderCollectionFailures.reason} <> ${ORDER_COLLECTION_PROCESSING_FAILED} OR ${orderCollectionFailures.attemptCount} >= ${PROCESSING_FAILURE_MAX_ATTEMPTS})`,
    ];
```

`markReplayed` 를 바꾼다:

```ts
  async markReplayed(id: string, wmsOrderId?: string, note?: string): Promise<void> {
    await this.db.db
      .update(orderCollectionFailures)
      .set({
        status: 'replayed',
        replayedAt: new Date(),
        replayedWmsOrderId: wmsOrderId ?? null,
        // 매핑 없이 닫히는 경우(식별 실패 격리로 넘어감 등) 왜 닫혔는지가 여기 남는다.
        ...(note ? { errorMessage: note } : {}),
        updatedAt: new Date(),
      })
      .where(eq(orderCollectionFailures.id, id));
  }
```

- [ ] **Step 9: 통과를 확인한다**

Run: `npx dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts apps/channel-adapter/src/services/order-collection/order-collection-failure-summary.integration.spec.ts`
Expected: 두 파일 모두 PASS (기존 요약 스펙도 초록 — 식별 실패 행만 쓰므로 새 조건에 걸리지 않는다).

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 10: 커밋**

```bash
git add apps/channel-adapter/src/schema.ts apps/channel-adapter/drizzle \
  apps/channel-adapter/src/services/order-collection/channel-order-provider.interface.ts \
  apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts \
  apps/channel-adapter/src/services/order-collection/order-collection-failure-processing.integration.spec.ts
git commit -m "feat(channel-adapter): 주문 처리 실패 격리 기록 — 횟수 누적·재시도 선별·요약 제외 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 2: provider 는 조회·번역 실패를 올려 보낸다

**Files:**
- Create: `apps/channel-adapter/src/services/order-collection/order-processing-stage.error.ts`
- Modify: `apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts:156-160`
- Modify: `apps/channel-adapter/src/services/order-collection/naver-order.source.ts:71-101`, `:113-123` (주석)
- Modify: `apps/channel-adapter/src/services/order-collection/translating-order.provider.ts:39-65`, `:94-100`
- Test: `apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts`, `translating-order.provider.spec.ts`

**Interfaces:**
- Consumes: `OrderProcessingFailureItem`, `OrderProcessingStage` (Task 1)
- Produces:
  - `class OrderProcessingStageError extends Error { readonly stage: OrderProcessingStage; readonly original: unknown; readonly input: Record<string, unknown> }` — `constructor(stage, original, input)`
  - `function errorMessage(error: unknown): string`
  - `interface ChannelOrderFetchFailure { externalOrderId: string; changedAt: string; error: string }`, `WindowedFetchResult.fetchFailures: ChannelOrderFetchFailure[]`
  - `TranslatingOrderProvider.fetchOrders` 가 `processingFailures` 를 채운다
  - `ReplayableTranslatingOrderProvider.fetchOrderForSync` 는 번역 throw 를 `OrderProcessingStageError('translate', …)` 로 던진다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`naver-order.source.spec.ts` 의 «세 주문 중 하나의 상세가 깨져도…» 테스트(91행) 바로 아래에 추가:

```ts
  it('상세가 깨진 주문은 버리지 않고 fetchFailures 로 올린다 — 변경 시각을 실어 워터마크 근거가 된다 (#1016 1번 행)', async () => {
    client.getLastChangedStatuses.mockResolvedValue({
      data: { count: 2, lastChangeStatuses: [changed('po-1', 'ord-1'), changed('po-2', 'ord-2')] },
    });
    client.getProductOrderIdsByOrderId.mockImplementation(async (orderId: string) => ({
      data: [orderId === 'ord-1' ? 'po-1' : 'po-2'],
    }));
    client.getOrderDetails.mockImplementation(async (ids: string[]) => {
      const id = ids[0];
      if (id === 'po-2') return { data: [detail('po-2', 'ord-2', { quantity: undefined })] };
      return { data: [detail(id, 'ord-1')] };
    });

    const { snapshots, fetchFailures, completedWindowEnd } = await source.fetchOrdersInWindow(
      new Date('2026-08-19T00:00:00.000Z'),
    );

    expect(snapshots.map((s) => s.externalOrderId)).toEqual(['ord-1']);
    expect(fetchFailures).toEqual([
      { externalOrderId: 'ord-2', changedAt: '2026-08-19T01:00:00.000+09:00', error: expect.any(String) },
    ]);
    expect(completedWindowEnd).toBeNull();
  });
```

`translating-order.provider.spec.ts` 끝에 추가:

```ts
describe('TranslatingOrderProvider.fetchOrders — 주문 단위 실패 (#1016 1번 행)', () => {
  const snapshotA = { externalOrderId: 'A', sourceUpdatedAt: '2026-10-07T01:00:00.000Z', raw: { id: 'A' } };
  const snapshotB = { externalOrderId: 'B', sourceUpdatedAt: '2026-10-07T01:01:00.000Z', raw: { id: 'B' } };
  const orderOf = (externalOrderId: string) => ({
    outcome: { kind: 'order', order: { externalOrderId } },
    lifecycle: [],
  });

  it('스냅샷 하나의 번역이 throw 해도 나머지를 번역하고 그 주문을 translate 실패로 올린다', async () => {
    const source = { channel: 'medusa', fetchOrders: jest.fn().mockResolvedValue([snapshotA, snapshotB]) };
    const translator = {
      translate: jest.fn(async (_channel: string, snapshot: { externalOrderId: string }) => {
        if (snapshot.externalOrderId === 'A') throw new Error('translator broke');
        return orderOf(snapshot.externalOrderId);
      }),
    };
    // 테스트 목 — 번역기·source 의 나머지 표면은 이 경로가 쓰지 않는다.
    const provider = createOrderProvider(source as any, translator as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders.map((order) => order.externalOrderId)).toEqual(['B']);
    expect(result.processingFailures).toEqual([
      {
        externalOrderId: 'A',
        sourceUpdatedAt: '2026-10-07T01:00:00.000Z',
        stage: 'translate',
        error: 'translator broke',
        input: { id: 'A' },
      },
    ]);
  });

  it('창을 쓰는 source 의 조회 실패를 fetch 실패로 옮긴다 — 시각은 채널이 알려 준 변경 시각', async () => {
    const source = {
      channel: 'naver',
      fetchOrders: jest.fn(),
      fetchOrdersInWindow: jest.fn().mockResolvedValue({
        snapshots: [],
        completedWindowEnd: null,
        fetchFailures: [{ externalOrderId: 'ord-2', changedAt: '2026-08-19T01:00:00.000+09:00', error: 'naver 500' }],
      }),
    };
    const provider = createOrderProvider(source as any, { translate: jest.fn() } as any);

    const result = await provider.fetchOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result.processingFailures).toEqual([
      {
        externalOrderId: 'ord-2',
        sourceUpdatedAt: '2026-08-19T01:00:00.000+09:00',
        stage: 'fetch',
        error: 'naver 500',
        input: {},
      },
    ]);
  });
});

describe('ReplayableTranslatingOrderProvider.fetchOrderForSync — 번역 실패 단계 (#1016 1번 행)', () => {
  it('번역 throw 는 translate 단계를 실은 OrderProcessingStageError 로 던진다', async () => {
    const original = new Error('translator broke');
    const source = {
      channel: 'medusa',
      fetchOrders: jest.fn(),
      fetchOrder: jest.fn().mockResolvedValue({ externalOrderId: 'A', raw: { id: 'A' } }),
    };
    const translator = { translate: jest.fn().mockRejectedValue(original) };
    const provider = createOrderProvider(source as any, translator as any) as SyncableChannelOrderProvider;

    const error = await provider.fetchOrderForSync('A').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OrderProcessingStageError);
    expect(error).toMatchObject({ stage: 'translate', original, input: { id: 'A' }, message: 'translator broke' });
  });
});
```

그리고 파일 맨 위 import 에 `import { OrderProcessingStageError } from './order-processing-stage.error';` 를 더한다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts apps/channel-adapter/src/services/order-collection/translating-order.provider.spec.ts`
Expected: FAIL — `order-processing-stage.error` 모듈 없음 / `fetchFailures` undefined.

- [ ] **Step 3: 에러 클래스를 만든다**

`apps/channel-adapter/src/services/order-collection/order-processing-stage.error.ts`:

```ts
import type { OrderProcessingStage } from './channel-order-provider.interface';

/**
 * 주문 하나를 처리하다 실패한 **단계**를 실어 나르는 내부 에러 (#1016 1번 행 스펙 §6.3).
 *
 * 처리 실패 행의 `failed_stage` 를 채우려면 throw 지점이 단계를 알려 줘야 한다. 바깥 계약(`syncOrder` 의
 * 호출자 — HTTP·명령 소비자)에는 `original` 을 그대로 다시 던진다. 이 타입은 channel-adapter 밖으로 나가지 않는다.
 */
export class OrderProcessingStageError extends Error {
  constructor(
    readonly stage: OrderProcessingStage,
    readonly original: unknown,
    readonly input: Record<string, unknown>,
  ) {
    super(errorMessage(original));
    this.name = 'OrderProcessingStageError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 창 결과 타입에 조회 실패를 더한다**

`channel-order-source.interface.ts` 의 `WindowedFetchResult` 를 바꾼다:

```ts
/** 창 안에서 단건 조회에 실패한 주문 (#1016 1번 행). 삼키면 다른 주문이 워터마크를 밀어 그 주문이 조용히 사라진다. */
export interface ChannelOrderFetchFailure {
  externalOrderId: string;
  /** 변경 피드가 알려 준 그 주문의 변경 시각 — 워터마크 근거다. */
  changedAt: string;
  error: string;
}

export interface WindowedFetchResult {
  snapshots: ChannelOrderSnapshot[];
  fetchFailures: ChannelOrderFetchFailure[];
  /** 방금 **끝까지 훑은** 닫힌 창의 끝. 창이 열려 있거나 페이징이 잘렸으면 `null`. */
  completedWindowEnd: Date | null;
}
```

- [ ] **Step 5: 네이버 source 가 실패를 싣는다**

`naver-order.source.ts` 의 `fetchOrdersInWindow` 본문(72-101행)을 바꾼다. import 에 `ChannelOrderFetchFailure` 를 더한다.

```ts
  async fetchOrdersInWindow(since: Date | null): Promise<WindowedFetchResult> {
    const { changedAtByOrderId, completedWindowEnd } = await this.collectChangedOrderIds(since);
    const snapshots: ChannelOrderSnapshot[] = [];
    const fetchFailures: ChannelOrderFetchFailure[] = [];
    for (const [orderId, changedAt] of changedAtByOrderId) {
      try {
        // 🔴 채널이 말한 변경 시각을 그대로 싣는다. `now` 를 쓰면 워터마크가 조회 창을 건너뛰어
        // 그 사이 변경이 영영 조회 범위 밖으로 빠진다 (창 걷기가 무력화된다).
        const snapshot = await this.fetchSnapshot(orderId, changedAt);
        if (snapshot) snapshots.push(snapshot);
      } catch (error) {
        // 실패 단위는 주문 하나다, 사이클 전체가 아니다 (FIX 2). 그렇다고 삼키지도 않는다 — 같은 창의 다른 주문이
        // 워터마크를 이 주문의 변경 시각 뒤로 밀면 이 주문은 조회 범위 밖으로 빠져 영영 사라진다. 그래서 올려 보내고,
        // 오케스트레이터가 처리 실패 행으로 기록한 뒤 재시도한다 (#1016 1번 행).
        const message = error instanceof Error ? error.message : String(error);
        fetchFailures.push({ externalOrderId: orderId, changedAt, error: message });
        this.logger.error(`[naver] 주문 ${orderId} 수집 실패 — 처리 실패로 올린다: ${message}`);
      }
    }
    if (fetchFailures.length > 0) {
      this.logger.error(
        `[naver] 이번 주기 ${changedAtByOrderId.size}건 중 ${fetchFailures.length}건 수집 실패 — 개별 사유는 위 로그 참고.`,
      );
    }
    // 🔴 실패한 주문이 하나라도 있으면 창을 다 봤다고 말하지 않는다 (FIX F × FIX G). 실패가 항목으로 올라가므로
    // 지금은 이 값이 쓰이지 않지만(항목이 있으면 창의 끝을 보지 않는다), 기록이 빠지는 날의 마지막 방어선으로 둔다.
    return { snapshots, fetchFailures, completedWindowEnd: fetchFailures.length > 0 ? null : completedWindowEnd };
  }
```

`fetchSnapshot` 안의 빈 id 목록 주석(113-120행) 중 「`fetchOrders` 의 주문 단위 try/catch 가 다른 주문처럼 잡아 건너뛰고, 워터마크는 그 주문 시각 아래에 머문 채 다음 주기가 다시 시도한다(무손실).」 두 줄을 다음으로 바꾼다:

```ts
      // `fetchOrdersInWindow` 의 주문 단위 try/catch 가 잡아 처리 실패로 올리고, 오케스트레이터가 기록한 뒤
      // 재시도한다(#1016 1번 행) — 조용히 건너뛰면 다른 주문이 워터마크를 이 주문 너머로 민다.
```

- [ ] **Step 6: 번역 provider 가 실패를 올린다**

`translating-order.provider.ts` 상단 import 에 더한다:

```ts
import { OrderProcessingFailureItem } from './channel-order-provider.interface';
import { OrderProcessingStageError, errorMessage } from './order-processing-stage.error';
```

(기존 interface import 문에 `OrderProcessingFailureItem` 을 합쳐도 된다.) `fetchOrders` 를 바꾼다:

```ts
  async fetchOrders(since: Date | null): Promise<FetchOrdersResult> {
    // 닫힌 창을 쓰는 source 만 창의 끝을 보고한다. 열린 질의(Medusa)는 이 갈래를 타지 않으므로
    // `completedWindowEnd` 가 `undefined` 로 남고, 오케스트레이터의 워터마크 계산이 전과 같다.
    const { snapshots, completedWindowEnd, fetchFailures } = isWindowedSource(this.source)
      ? await this.source.fetchOrdersInWindow(since)
      : { snapshots: await this.source.fetchOrders(since), completedWindowEnd: undefined, fetchFailures: [] };

    const orders: OrderFetchItem[] = [];
    const failures: OrderCollectionFailureItem[] = [];
    const lifecycleEvents: OrderLifecycleEventItem[] = [];
    const processingFailures: OrderProcessingFailureItem[] = fetchFailures.map((failure) => ({
      externalOrderId: failure.externalOrderId,
      sourceUpdatedAt: failure.changedAt,
      stage: 'fetch',
      error: failure.error,
      input: {},
    }));

    for (const snapshot of snapshots) {
      let translated: Awaited<ReturnType<ChannelOrderTranslator['translate']>>;
      try {
        translated = await this.translator.translate(this.channel, snapshot);
      } catch (error) {
        // 스냅샷 하나의 번역이 `fetchOrders` 전체를 죽이면 그 채널 수집이 멈춘다 (#1016 1번 행).
        processingFailures.push({
          externalOrderId: snapshot.externalOrderId,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          stage: 'translate',
          error: errorMessage(error),
          input: snapshot.raw,
        });
        continue;
      }
      const { outcome, lifecycle } = translated;
      lifecycleEvents.push(...lifecycle);
      if (outcome.kind === 'failure') {
        failures.push(outcome.failure);
      } else {
        orders.push(outcome.order);
      }
    }

    return {
      orders,
      failures,
      lifecycleEvents,
      processingFailures,
      ...(completedWindowEnd !== undefined ? { completedWindowEnd } : {}),
    };
  }
```

(`ChannelOrderTranslator` 가 이 파일에 이미 import 돼 있는지 확인한다 — 생성자 인자 타입이므로 있다.)

`fetchOrderForSync` 를 바꾼다:

```ts
  async fetchOrderForSync(externalOrderId: string): Promise<OrderSyncFetch | null> {
    const snapshot = await this.replayableSource.fetchOrder(externalOrderId);
    if (!snapshot) {
      return null;
    }
    try {
      return await this.translator.translate(this.channel, snapshot);
    } catch (error) {
      // 재시도가 실패 단계를 «조회»와 «번역»으로 가르려면 여기서 태그해야 한다 (스펙 §6.3).
      throw new OrderProcessingStageError('translate', error, snapshot.raw);
    }
  }
```

- [ ] **Step 7: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/`
Expected: 이 디렉터리 전부 PASS. 통합 스펙은 skip(`DATABASE_URL` 미주입).

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 8: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection/order-processing-stage.error.ts \
  apps/channel-adapter/src/services/order-collection/channel-order-source.interface.ts \
  apps/channel-adapter/src/services/order-collection/naver-order.source.ts \
  apps/channel-adapter/src/services/order-collection/naver-order.source.spec.ts \
  apps/channel-adapter/src/services/order-collection/translating-order.provider.ts \
  apps/channel-adapter/src/services/order-collection/translating-order.provider.spec.ts
git commit -m "feat(channel-adapter): 조회·번역 실패를 삼키지 않고 주문 단위로 올린다 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 3: 폴링 루프의 주문 단위 격리

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` (`poll()` 98-287행, `resolveOrphanedQuarantine` 780-793행, `pollItemPriority`, 상단 타입·import, 파일 끝 헬퍼)
- Test: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 서비스 메서드·상수, Task 2 의 `errorMessage`, `FetchOrdersResult.processingFailures`
- Produces (Task 4 가 쓴다):
  - `private async recordProcessingFailure(channel: SalesChannel, failure: OrderProcessingFailureItem): Promise<void>` — 기록 + warn 로그 + 소진 시 error 로그 1회
  - 모듈 함수 `orderInput(item: OrderFetchItem): Record<string, unknown>`, `lifecycleInput(item: OrderLifecycleEventItem): Record<string, unknown>`
  - `poll()` 안의 `const cycleStartedAt = new Date()` (채널 try 블록 첫 줄)

- [ ] **Step 1: 스펙 목을 보강한다 (동작 변경 없음)**

`order-poller.orchestrator.spec.ts` 상단 import 를 바꾼다:

```ts
import { Logger } from '@nestjs/common';
import { Param, SQL } from 'drizzle-orm';
import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { OrderPollerOrchestrator } from './order-poller.orchestrator';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  ChannelOrderProvider,
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderLifecycleEventItem,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';
import { OrderProcessingStageError } from './order-processing-stage.error';
```

(`Logger`·`ORDER_STREAM`·`ORDER_COLLECTION_PROCESSING_FAILED`·`OrderProcessingStageError` 는 이 태스크와 Task 4 의 새 테스트가 쓴다. 이 단계에서 아직 안 쓰이면 lint 경고는 무시하고 진행한다.)

`makeOrder` 의 시그니처와 앞부분을 바꾼다 — 여러 주문을 한 주기에 섞으려면 id 가 달라야 한다:

```ts
function makeOrder(
  sourceUpdatedAt: string,
  overrides: {
    totalAmount?: number;
    eligibleForOrderCreation?: boolean;
    externalOrderId?: string;
    orderId?: string;
    createdAt?: string;
  } = {},
): OrderFetchItem {
  const totalAmount = overrides.totalAmount ?? 10000;
  const externalOrderId = overrides.externalOrderId ?? 'medusa_order_1';
  const orderId = overrides.orderId ?? '11111111-1111-4111-8111-111111111111';
```

그리고 반환 객체에서 `externalOrderId: 'medusa_order_1'`(두 곳)을 `externalOrderId`, `orderId: '11111111-…'` 를 `orderId`, `createdAt: '2026-05-26T00:00:00.000Z'` 를 `createdAt: overrides.createdAt ?? '2026-05-26T00:00:00.000Z'` 로 바꾼다.

`makeLifecycleEvent` 에 4번째 인자를 더한다: `externalOrderId = 'medusa_order_1'` 기본값, 그리고 본문의 `externalOrderId: 'medusa_order_1'`(payload 밖의 것과 `rawEvent` 안의 것 모두)을 그 변수로 바꾼다.

`makeFailureService` 반환 객체에 더한다:

```ts
    recordProcessingFailure: jest.fn(async (_channel: string, failure: OrderProcessingFailureItem) => ({
      record: { id: `processing_${failure.externalOrderId}`, externalOrderId: failure.externalOrderId, attemptCount: 1 },
      exhaustedNow: false,
    })),
    findOpenProcessingFailures: jest.fn().mockResolvedValue(new Map()),
    findRetryableProcessingFailures: jest.fn().mockResolvedValue([]),
    findAllOpenByExternalOrderId: jest.fn().mockResolvedValue([]),
```

`makeDb` 의 단건 조회가 **물은 주문의 매핑만** 돌려주게 바꾼다. 지금은 어떤 id 를 물었든 첫 행을 줘서, 한 주기에 주문 A·B 가 섞이면 B 가 A 의 매핑을 얻는다. 파일 끝에 헬퍼를 더한다:

```ts
/**
 * drizzle 조건식에 바인딩된 값들. 목이 «어느 주문을 물었나»를 알아내는 길이다 — `eq`·`and`·`inArray` 가
 * 만든 `SQL` 의 `queryChunks` 를 따라 내려가 `Param` 값을 모은다.
 */
function boundValues(node: unknown): unknown[] {
  if (node instanceof Param) return [node.value];
  if (Array.isArray(node)) return node.flatMap(boundValues);
  if (node instanceof SQL) return node.queryChunks.flatMap(boundValues);
  return [];
}
```

그리고 `makeDb` 의 `latestMapping` 정의를 지우고 `select` 를 바꾼다:

```ts
      select: () => ({
        from: () => ({
          // `.limit()` = 단건 매핑 조회(이 폴링에서 만들어진 것 중 물은 주문의 것만),
          // `await where()` = 배치 매핑 조회(시드 포함 — 호출부가 id 로 다시 거른다).
          where: (condition: unknown) =>
            Object.assign(Promise.resolve([...preexisting, ...Array.from(mappings.values())]), {
              limit: async () => {
                const asked = boundValues(condition);
                return Array.from(mappings.values())
                  .filter((mapping) => asked.includes(mapping.channelOrderId))
                  .slice(0, 1);
              },
            }),
        }),
      }),
```

`makeDb` 위의 주석 중 「이 목은 drizzle SQL 객체를 들여다볼 수 없어 술어를 흉내낼 수 없고, 단건 조회(`.limit(1)`)는 어떤 id 를 물었든 첫 행을 돌려준다.」 문장을 「단건 조회(`.limit(1)`)는 `boundValues` 로 물은 주문 id 를 꺼내 이 폴링의 매핑에서만 찾는다.」 로 바꾼다.

- [ ] **Step 2: 목 보강이 기존 동작을 안 바꿨는지 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`
Expected: 전부 PASS. 하나라도 빨개지면 그 테스트가 「아무 id 나 첫 매핑」에 기대고 있었다는 뜻이다 — 테스트의 주문 id 를 그 매핑과 맞춰 고치고, 고친 내용을 커밋 메시지에 적는다.

- [ ] **Step 3: 옛 «멈춘다» 테스트 둘을 새 동작으로 바꾸고, 격리 테스트를 쓴다**

537행 `it('does not advance the polling watermark when lifecycle recording fails', …)` 와 576행 `it('does not advance the polling watermark when processing fails before completion', …)` 두 테스트를 **지운다** — 그 동작(한 건 실패 = 주기 실패)이 이 행이 없애는 결함이다. 대신 1158행 테스트(`holds the watermark, then closes the orphaned quarantine…`)에서 

```ts
    failures.findOpenByExternalOrderId.mockResolvedValue({ id: 'failure_q', externalOrderId: 'medusa_order_q' });
```

를

```ts
    failures.findAllOpenByExternalOrderId.mockResolvedValue([{ id: 'failure_q', externalOrderId: 'medusa_order_q' }]);
```

로 바꾼다(`resolveOrphanedQuarantine` 이 열린 행을 전부 닫게 바뀐다).

그리고 첫 `describe('OrderPollerOrchestrator', …)` 블록이 끝난 바로 뒤(«채널 활성 게이트» 주석 위)에 새 블록을 더한다:

```ts
describe('OrderPollerOrchestrator — 주문 단위 격리 (#1016 1번 행)', () => {
  const ids = {
    A: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    B: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    C: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  } as const;
  const order = (key: keyof typeof ids, minute: string, overrides: { createdAt?: string } = {}) =>
    makeOrder(`2026-10-07T01:${minute}:00.000Z`, { externalOrderId: key, orderId: ids[key], ...overrides });
  const cancel = (key: keyof typeof ids, minute: string) =>
    makeLifecycleEvent('OrderCancelled', 'cancelled', `2026-10-07T01:${minute}:00.000Z`, key);

  /** 주어진 술어에 맞는 적재만 실패시키는 outbox. 성공한 적재는 `enqueued` 에 «주문:이벤트» 로 남는다. */
  function outboxFailingWhen(shouldFail: (event: { eventType: string; payload: { externalOrderId?: string } }) => boolean) {
    const enqueued: string[] = [];
    const enqueue = jest.fn(async (event: { eventType: string; payload: { externalOrderId?: string } }) => {
      if (shouldFail(event)) throw new Error(`contract violation: ${event.payload.externalOrderId}`);
      enqueued.push(`${event.payload.externalOrderId}:${event.eventType}`);
    });
    return { enqueue, enqueued };
  }

  function setup(fetchResult: object, outbox: { enqueue: jest.Mock }) {
    const db = makeDb();
    const provider: ChannelOrderProvider = { channel: 'medusa', fetchOrders: jest.fn().mockResolvedValue(fetchResult) };
    const syncStatus = makeSyncStatus();
    const failures = makeFailureService();
    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      makeHashService() as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa']) as any,
    );
    return { orchestrator, syncStatus, failures, db };
  }

  it('독이 든 주문 하나가 있어도 앞뒤 주문을 적재하고 워터마크를 끝까지 민다', async () => {
    const outbox = outboxFailingWhen((event) => event.payload.externalOrderId === 'B');
    const { orchestrator, syncStatus, failures, db } = setup(
      { orders: [order('A', '00'), order('B', '01'), order('C', '02')], failures: [], lifecycleEvents: [] },
      outbox,
    );

    await orchestrator.poll();

    expect(outbox.enqueued).toEqual(['A:OrderCreated', 'C:OrderCreated']);
    expect(failures.recordProcessingFailure).toHaveBeenCalledTimes(1);
    expect(failures.recordProcessingFailure).toHaveBeenCalledWith('medusa', {
      externalOrderId: 'B',
      sourceUpdatedAt: '2026-10-07T01:01:00.000Z',
      stage: 'enqueue_order',
      error: 'contract violation: B',
      input: expect.objectContaining({ createPayload: expect.objectContaining({ externalOrderId: 'B' }) }),
    });
    // B 의 매핑은 적재와 같은 트랜잭션이라 함께 롤백됐다 — 되살릴 때 처음부터 다시 만든다.
    expect([...db.mappings.values()].map((mapping) => mapping.channelOrderId).sort()).toEqual(['A', 'C']);
    expect(syncStatus.recordSyncFailure).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-10-07T01:02:00.000Z'));
  });

  it('lifecycle 적재가 실패해도 그 주문만 격리하고 다른 주문은 수집한다', async () => {
    const outbox = outboxFailingWhen((event) => event.eventType === 'OrderCancelled');
    const { orchestrator, syncStatus, failures } = setup(
      { orders: [order('A', '00'), order('B', '02')], failures: [], lifecycleEvents: [cancel('A', '01')] },
      outbox,
    );

    await orchestrator.poll();

    expect(outbox.enqueued).toEqual(['A:OrderCreated', 'B:OrderCreated']);
    expect(failures.recordProcessingFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'A',
        stage: 'enqueue_lifecycle',
        input: expect.objectContaining({ eventType: 'OrderCancelled', eventKey: 'cancelled' }),
      }),
    );
    expect(syncStatus.recordSyncFailure).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-10-07T01:02:00.000Z'));
  });

  it('실패한 주문의 같은 주기 lifecycle 은 건너뛰고, 방금 만든 실패 행을 고아로 닫지 않는다', async () => {
    const outbox = outboxFailingWhen((event) => event.payload.externalOrderId === 'A');
    const { orchestrator, failures, syncStatus } = setup(
      { orders: [order('A', '00')], failures: [], lifecycleEvents: [cancel('A', '00')] },
      outbox,
    );

    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(1); // OrderCreated 시도 1회 — lifecycle 은 시도조차 안 한다
    expect(failures.findAllOpenByExternalOrderId).not.toHaveBeenCalled();
    expect(failures.closeAsTerminalLifecycle).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-10-07T01:00:00.000Z'));
  });

  it('실패 주문의 lifecycle 만 건너뛰고 다른 주문의 lifecycle 은 낸다', async () => {
    const outbox = outboxFailingWhen((event) => event.payload.externalOrderId === 'A');
    const { orchestrator } = setup(
      { orders: [order('A', '00'), order('B', '00')], failures: [], lifecycleEvents: [cancel('A', '01'), cancel('B', '01')] },
      outbox,
    );

    await orchestrator.poll();

    expect(outbox.enqueued).toEqual(['B:OrderCreated', 'B:OrderCancelled']);
  });

  it('실패를 기록하지 못하면 지금처럼 주기 전체를 실패시키고 워터마크를 멈춘다', async () => {
    const outbox = outboxFailingWhen((event) => event.payload.externalOrderId === 'A');
    const { orchestrator, syncStatus, failures } = setup(
      { orders: [order('A', '00')], failures: [], lifecycleEvents: [] },
      outbox,
    );
    failures.recordProcessingFailure.mockRejectedValue(new Error('db down'));

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', { message: 'db down' });
    expect(syncStatus.lastSyncAt()).toBeNull();
  });

  it('provider 가 올린 조회·번역 실패를 기록하고 워터마크 근거로 쓴다', async () => {
    const fetchFailure: OrderProcessingFailureItem = {
      externalOrderId: 'B',
      sourceUpdatedAt: '2026-10-07T01:05:00.000Z',
      stage: 'fetch',
      error: 'naver 500',
      input: {},
    };
    const outbox = outboxFailingWhen(() => false);
    const { orchestrator, syncStatus, failures } = setup(
      { orders: [order('A', '00')], failures: [], lifecycleEvents: [], processingFailures: [fetchFailure] },
      outbox,
    );

    await orchestrator.poll();

    expect(outbox.enqueued).toEqual(['A:OrderCreated']);
    expect(failures.recordProcessingFailure).toHaveBeenCalledWith('medusa', fetchFailure);
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-10-07T01:05:00.000Z'));
  });

  it('열린 처리 실패 행이 있는 주문이 이번 주기에 성공하면 replayed 로 닫는다', async () => {
    const outbox = outboxFailingWhen(() => false);
    const { orchestrator, failures } = setup({ orders: [order('A', '00')], failures: [], lifecycleEvents: [] }, outbox);
    failures.findOpenProcessingFailures.mockResolvedValue(new Map([['A', { id: 'processing_A', externalOrderId: 'A' }]]));

    await orchestrator.poll();

    expect(failures.findOpenProcessingFailures).toHaveBeenCalledWith('medusa', ['A']);
    expect(failures.markReplayed).toHaveBeenCalledWith('processing_A', ids.A);
  });

  it('이번 주기에도 실패하면 열린 행을 닫지 않는다', async () => {
    const outbox = outboxFailingWhen(() => true);
    const { orchestrator, failures } = setup({ orders: [order('A', '00')], failures: [], lifecycleEvents: [] }, outbox);
    failures.findOpenProcessingFailures.mockResolvedValue(new Map([['A', { id: 'processing_A', externalOrderId: 'A' }]]));

    await orchestrator.poll();

    expect(failures.markReplayed).not.toHaveBeenCalled();
  });

  it('미수집 주문이 종결돼 수집 대상이 아니면 열린 처리 실패 행을 종결로 닫는다', async () => {
    const outbox = outboxFailingWhen(() => false);
    const terminal = makeOrder('2026-10-07T01:00:00.000Z', {
      externalOrderId: 'A',
      orderId: ids.A,
      eligibleForOrderCreation: false,
    });
    const { orchestrator, failures } = setup({ orders: [terminal], failures: [], lifecycleEvents: [] }, outbox);
    failures.findOpenProcessingFailures.mockResolvedValue(new Map([['A', { id: 'processing_A', externalOrderId: 'A' }]]));

    await orchestrator.poll();

    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('processing_A', expect.any(String));
    expect(failures.markReplayed).not.toHaveBeenCalled();
  });

  it('종결 관측이 고아 격리를 닫을 때 사유가 다른 열린 행까지 전부 닫는다', async () => {
    const outbox = outboxFailingWhen(() => false);
    const { orchestrator, failures } = setup({ orders: [], failures: [], lifecycleEvents: [cancel('A', '00')] }, outbox);
    failures.findAllOpenByExternalOrderId.mockResolvedValue([
      { id: 'identification_A', externalOrderId: 'A' },
      { id: 'processing_A', externalOrderId: 'A' },
    ]);

    await orchestrator.poll();

    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('identification_A', expect.any(String));
    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('processing_A', expect.any(String));
  });

  it('소진 순간에만 error 로그를 남긴다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const outbox = outboxFailingWhen((event) => event.payload.externalOrderId === 'A');
    const { orchestrator, failures } = setup({ orders: [order('A', '00')], failures: [], lifecycleEvents: [] }, outbox);
    failures.recordProcessingFailure.mockResolvedValueOnce({
      record: { id: 'processing_A', externalOrderId: 'A', attemptCount: 4 },
      exhaustedNow: true,
    });

    await orchestrator.poll();

    const exhaustedLogs = errorSpy.mock.calls.filter(([message]) => String(message).includes('소진'));
    expect(exhaustedLogs).toHaveLength(1);
    expect(String(exhaustedLogs[0][0])).toContain('A');
    errorSpy.mockRestore();
  });

  it('네이버 +09:00 시각처럼 계약을 못 통과하는 주문만 격리된다 — 실제 OrderCreated 스키마로 (2번 행 재현)', async () => {
    const schema = ORDER_STREAM.events.OrderCreated.schema;
    if (!schema) throw new Error('OrderCreated 계약 스키마가 없다');
    const enqueued: string[] = [];
    const outbox = {
      // 실제 발행기처럼 적재 시점에 계약으로 파싱한다(`StreamPublisher.buildEventEnvelope`).
      enqueue: jest.fn(async (event: { eventType: string; payload: { externalOrderId?: string } }) => {
        if (event.eventType === 'OrderCreated') schema.parse(event.payload);
        enqueued.push(`${event.payload.externalOrderId}:${event.eventType}`);
      }),
    };
    const { orchestrator, failures, syncStatus } = setup(
      {
        orders: [order('A', '00'), order('B', '01', { createdAt: '2026-08-19T00:00:00.000+09:00' }), order('C', '02')],
        failures: [],
        lifecycleEvents: [],
      },
      outbox,
    );

    await orchestrator.poll();

    expect(enqueued).toEqual(['A:OrderCreated', 'C:OrderCreated']);
    expect(failures.recordProcessingFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'B',
        stage: 'enqueue_order',
        input: expect.objectContaining({
          createPayload: expect.objectContaining({ createdAt: '2026-08-19T00:00:00.000+09:00' }),
        }),
      }),
    );
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-10-07T01:02:00.000Z'));
  });
});
```

- [ ] **Step 4: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts -t "주문 단위 격리"`
Expected: FAIL — 첫 테스트에서 `recordSyncFailure` 가 불리고 C 가 적재되지 않는다.

- [ ] **Step 5: 오케스트레이터 루프를 구현한다**

`order-poller.orchestrator.ts` 상단 import 를 더한다:

```ts
import {
  // …기존 항목 유지…
  ORDER_COLLECTION_PROCESSING_FAILED,
  OrderProcessingFailureItem,
} from './channel-order-provider.interface';
import { OrderCollectionFailureService, PROCESSING_FAILURE_MAX_ATTEMPTS } from './order-collection-failure.service';
import { errorMessage } from './order-processing-stage.error';
import { OrderCollectionFailure } from '../../types';
```

(`OrderCollectionFailureService` import 는 기존 줄을 위 줄로 바꾼다. `ORDER_COLLECTION_PROCESSING_FAILED` 는 Task 4 가 쓴다 — 지금 안 쓰여 lint 경고가 나면 Task 4 에서 사라진다.)

`OrderedPollItem` 에 갈래를 더한다:

```ts
type OrderedPollItem =
  | { kind: 'order'; item: OrderFetchItem }
  | { kind: 'failure'; item: OrderCollectionFailureItem }
  | { kind: 'processing_failure'; item: OrderProcessingFailureItem }
  | { kind: 'lifecycle'; item: OrderLifecycleEventItem };
```

`pollItemPriority` 를 바꾼다:

```ts
  private pollItemPriority(kind: OrderedPollItem['kind']): number {
    if (kind === 'order') return 0;
    if (kind === 'failure') return 1;
    if (kind === 'processing_failure') return 2;
    return 3;
  }
```

`poll()` 의 채널 `try {` 블록에서:

(a) 첫 줄로 `const cycleStartedAt = new Date();` 를 넣는다(Task 4 의 재시도가 쓴다 — 지금은 안 쓰여도 둔다. lint 의 unused 경고가 나면 Task 4 에서 사라진다).

(b) `provider.fetchOrders(since)` 구조분해에 `processingFailures = []` 를 더하고 `orderedItems` 에 `...processingFailures.map((item) => ({ kind: 'processing_failure' as const, item })),` 를 failures 와 lifecycle 사이에 넣는다.

(c) `collectedOrders` 조회 바로 아래에:

```ts
        // 이전 주기에 처리에 실패해 열려 있는 행. 이번 주기에 그 주문이 성공하면 닫는다 (#1016 1번 행 스펙 §5.4).
        const openProcessingFailures = await this.orderCollectionFailureService.findOpenProcessingFailures(
          provider.channel,
          [...new Set(orderedItems.map((entry) => entry.item.externalOrderId))],
        );
```

(d) `let lifecycleRecorded = 0;` 아래에:

```ts
        let processingFailed = 0;
        // 이번 주기에 처리에 실패한 주문. 같은 주문의 남은 항목은 건너뛴다 — 되살릴 때 주문과 lifecycle 을
        // 통째로 다시 가져오므로 잃지 않고, 건너뛰지 않으면 그 주문의 lifecycle 이 매핑을 못 찾아 «종결»로
        // 판정돼 방금 만든 실패 행을 닫아 버린다 (스펙 §5.2).
        const failedExternalOrderIds = new Set<string>();
        // 이번 주기에 항목이 성공한 주문. 열린 처리 실패 행을 닫는 근거다.
        const succeededOrders = new Map<string, { wmsOrderId?: string; terminal: boolean }>();
        const noteSucceeded = (externalOrderId: string, wmsOrderId: string | undefined, terminal: boolean) => {
          const previous = succeededOrders.get(externalOrderId);
          succeededOrders.set(externalOrderId, {
            wmsOrderId: wmsOrderId ?? previous?.wmsOrderId,
            terminal: terminal || (previous?.terminal ?? false),
          });
        };
```

(e) `advanceWatermark`·`holdWatermark` 정의 아래에:

```ts
        // 기록했으면 지나간다. 기록이 throw 하면 그대로 바깥 catch 로 가서 주기 전체가 실패하고 워터마크가
        // 멈춘다 — 그때는 DB 장애라 멈추는 게 맞다 (스펙 D4).
        const recordItemFailure = async (failure: OrderProcessingFailureItem) => {
          await this.recordProcessingFailure(provider.channel, failure);
          failedExternalOrderIds.add(failure.externalOrderId);
          processingFailed++;
          advanceWatermark(failure.sourceUpdatedAt);
        };
```

(f) `for (const orderedItem of orderedItems) {` 루프 본문의 **맨 앞**에:

```ts
          if (failedExternalOrderIds.has(orderedItem.item.externalOrderId)) {
            advanceWatermark(orderedItem.item.sourceUpdatedAt);
            continue;
          }

          if (orderedItem.kind === 'processing_failure') {
            await recordItemFailure(orderedItem.item);
            continue;
          }
```

(g) lifecycle 갈래의 `const result = await this.processLifecycleItem(provider, orderedItem.item);` 를 바꾼다:

```ts
            let result: ProcessPollItemResult;
            try {
              result = await this.processLifecycleItem(provider, orderedItem.item);
            } catch (error) {
              await recordItemFailure({
                externalOrderId: orderedItem.item.externalOrderId,
                sourceUpdatedAt: orderedItem.item.sourceUpdatedAt,
                stage: 'enqueue_lifecycle',
                error: errorMessage(error),
                input: lifecycleInput(orderedItem.item),
              });
              continue;
            }
            if (result.recorded) {
              noteSucceeded(orderedItem.item.externalOrderId, result.wmsOrderId, false);
            }
```

(나머지 lifecycle 갈래 — `emitted +=` 부터 `continue;` 까지 — 는 그대로.)

(h) 주문 갈래(루프 끝의 `const result = await this.processOrderItem(...)` 네 줄)를 바꾼다:

```ts
          let result: ProcessPollItemResult;
          try {
            result = await this.processOrderItem(provider, orderedItem.item);
          } catch (error) {
            await recordItemFailure({
              externalOrderId: orderedItem.item.externalOrderId,
              sourceUpdatedAt: orderedItem.item.sourceUpdatedAt,
              stage: 'enqueue_order',
              error: errorMessage(error),
              input: orderInput(orderedItem.item),
            });
            continue;
          }
          emitted += result.emitted;
          dedupedUnchanged += result.dedupedUnchanged;
          noteSucceeded(
            orderedItem.item.externalOrderId,
            result.wmsOrderId,
            orderedItem.item.eligibleForOrderCreation === false,
          );
          advanceWatermark(orderedItem.item.sourceUpdatedAt);
```

(i) 루프가 끝난 바로 뒤(«조용한 창» 주석 위)에:

```ts
        await this.closeRecoveredProcessingFailures(openProcessingFailures, failedExternalOrderIds, succeededOrders);
```

(j) `if (quarantined > 0) { … }` 아래에:

```ts
        if (processingFailed > 0) {
          this.logger.warn(
            `[${provider.channel}] ${processingFailed}건의 주문이 처리에 실패해 그 주문만 격리했다 — 나머지는 수집했다 (#1016 1번 행)`,
          );
        }
```

그리고 마지막 `Polled …` 로그 문자열 끝의 `skippedAlreadyCollected: ${skippedAlreadyCollected})` 를 `skippedAlreadyCollected: ${skippedAlreadyCollected}, processingFailed: ${processingFailed})` 로 바꾼다.

클래스에 메서드 둘을 더한다(`closeOpenQuarantineAsCollected` 위):

```ts
  /** 처리 실패를 기록하고 로그를 남긴다. 루프와 재시도가 같이 쓴다 (스펙 §5.3·§6.4). */
  private async recordProcessingFailure(channel: SalesChannel, failure: OrderProcessingFailureItem): Promise<void> {
    const { exhaustedNow } = await this.orderCollectionFailureService.recordProcessingFailure(channel, failure);
    this.logger.warn(
      `[${channel}] 주문 ${failure.externalOrderId} 처리 실패(${failure.stage}) — 그 주문만 격리하고 계속한다: ${failure.error}`,
    );
    if (exhaustedNow) {
      this.logger.error(
        `[${channel}] 주문 ${failure.externalOrderId} 자동 재시도 ${PROCESSING_FAILURE_MAX_ATTEMPTS}회 소진 — 격리 화면에서 조치가 필요하다 (${failure.stage}): ${failure.error}`,
      );
    }
  }

  /**
   * 다음 폴링이 우연히 그 주문을 다시 가져와 성공한 경우 열린 처리 실패 행을 닫는다 (스펙 §5.4).
   * 채널은 주문을 다시 내보낼 때 그 주문의 lifecycle 도 함께 내보내므로 주문 항목의 성공이 곧 그 주문 전체의 성공이다.
   */
  private async closeRecoveredProcessingFailures(
    open: Map<string, OrderCollectionFailure>,
    failed: Set<string>,
    succeeded: Map<string, { wmsOrderId?: string; terminal: boolean }>,
  ): Promise<void> {
    for (const [externalOrderId, row] of open) {
      if (failed.has(externalOrderId)) continue;
      const success = succeeded.get(externalOrderId);
      if (!success) continue;
      if (success.wmsOrderId) {
        await this.orderCollectionFailureService.markReplayed(row.id, success.wmsOrderId);
      } else if (success.terminal) {
        await this.orderCollectionFailureService.closeAsTerminalLifecycle(
          row.id,
          `Closed on poll: order ${externalOrderId} reached a terminal lifecycle before collection`,
        );
      }
    }
  }
```

`resolveOrphanedQuarantine` 를 바꾼다:

```ts
  private async resolveOrphanedQuarantine(channel: string, item: OrderLifecycleEventItem): Promise<void> {
    // 열린 행을 **전부** 닫는다 — 식별 실패와 처리 실패가 함께 열려 있을 수 있고, 종결된 주문은 어느 사유로도
    // 수집할 수 없다 (#1016 1번 행 스펙 §5.5).
    const open = await this.orderCollectionFailureService.findAllOpenByExternalOrderId(channel, item.externalOrderId);
    for (const row of open) {
      await this.orderCollectionFailureService.closeAsTerminalLifecycle(
        row.id,
        `Closed by ${item.eventType} (${item.eventKey}): order reached a terminal lifecycle before collection`,
      );
    }
    if (open.length > 0) {
      this.logger.warn(
        `[${channel}] Closed ${open.length} orphaned quarantine(s) for ${item.externalOrderId} after ${item.eventType}; order is no longer collectable`,
      );
    }
  }
```

파일 끝(클래스 밖)에 헬퍼를 더한다:

```ts
/** 주문 적재 실패 행의 `raw_order` — zod 가 거부한 그 값이 행 안에서 보이게 한다 (스펙 §4.3). */
function orderInput(item: OrderFetchItem): Record<string, unknown> {
  return { createPayload: item.createPayload, modification: item.modification };
}

/** lifecycle 적재 실패 행의 `raw_order`. */
function lifecycleInput(item: OrderLifecycleEventItem): Record<string, unknown> {
  return { eventType: item.eventType, eventKey: item.eventKey, payload: item.payload };
}
```

- [ ] **Step 6: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`
Expected: 전부 PASS (옛 테스트 + 새 «주문 단위 격리» 12건).

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 7: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts \
  apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts
git commit -m "fix(channel-adapter): 주문 하나의 적재 실패가 채널 폴링을 멈추지 않는다 — 주문 단위 격리 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 4: 되살리기 — `processSyncFetch`·자동 재시도·수동 replay

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts` (`syncOrder` 320-344행, `replayFailure` 346-460행, `syncFetched` 704-727행, `poll()` 의 `recordSyncComplete` 뒤)
- Test: `apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts`

**Interfaces:**
- Consumes: Task 1 `findRetryableProcessingFailures`·`markReplayed(id, wmsOrderId?, note?)`·`closeAsTerminalLifecycle`·`PROCESSING_FAILURE_RETRY_BATCH`, Task 2 `OrderProcessingStageError`, Task 3 `recordProcessingFailure`·`orderInput`·`lifecycleInput`·`cycleStartedAt`
- Produces:
  - `type SyncFetchResult = { outcome: OrderSyncOutcome; emitted: number; dedupedUnchanged: number; wmsOrderId?: string }`
  - `type ProcessingRetryStatus = 'replayed' | 'already_processed' | 'closed_terminal' | 'moved_to_identification_quarantine' | 'still_quarantined'`
  - `replayFailure` 응답 status 유니온에 `'moved_to_identification_quarantine'` (admin-web Task 5 가 문구를 단다)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

Task 3 의 새 `describe` 블록 뒤에 더한다:

```ts
describe('OrderPollerOrchestrator — 처리 실패 되살리기 (#1016 1번 행)', () => {
  const ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const retryRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'processing_A',
    channel: 'medusa',
    externalOrderId: 'A',
    reason: ORDER_COLLECTION_PROCESSING_FAILED,
    status: 'quarantined',
    attemptCount: 1,
    sourceUpdatedAt: new Date('2026-10-07T01:00:00.000Z'),
    ...overrides,
  });
  const orderA = () => makeOrder('2026-10-07T01:00:00.000Z', { externalOrderId: 'A', orderId: ORDER_ID });

  function setup(options: { syncable?: boolean; fetchOrders?: jest.Mock } = {}) {
    const db = makeDb();
    const provider = {
      channel: 'medusa' as const,
      fetchOrders: options.fetchOrders ?? jest.fn().mockResolvedValue({ orders: [], failures: [], lifecycleEvents: [] }),
      ...(options.syncable === false ? {} : { fetchOrderForSync: jest.fn() }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const failures = makeFailureService();
    const orchestrator = new OrderPollerOrchestrator(
      [provider as any],
      syncStatus as any,
      outbox as any,
      makeHashService() as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa']) as any,
    );
    const eventTypes = () => outbox.enqueue.mock.calls.map(([event]) => event.eventType);
    return { orchestrator, provider, syncStatus, outbox, failures, eventTypes };
  }

  it('채널 주기 끝에 이번 주기 시작 시각과 상한 20 으로 대상을 고른다', async () => {
    const { orchestrator, failures } = setup();
    const before = Date.now();

    await orchestrator.poll();

    expect(failures.findRetryableProcessingFailures).toHaveBeenCalledWith('medusa', expect.any(Date), 20);
    const [, cycleStartedAt] = failures.findRetryableProcessingFailures.mock.calls[0];
    expect(cycleStartedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(cycleStartedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('성공하면 주문과 lifecycle 을 다시 내고 replayed 로 닫는다 — lifecycle 저장본 없이 스냅샷에서 되살아난다', async () => {
    const { orchestrator, provider, failures, eventTypes } = setup();
    failures.findRetryableProcessingFailures.mockResolvedValue([retryRow()]);
    provider.fetchOrderForSync!.mockResolvedValue({
      outcome: { kind: 'order', order: orderA() },
      lifecycle: [makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-10-07T01:00:00.000Z', 'A')],
    });

    await orchestrator.poll();

    expect(eventTypes()).toEqual(['OrderCreated', 'OrderCancelled']);
    expect(failures.markReplayed).toHaveBeenCalledWith('processing_A', ORDER_ID);
    expect(failures.recordProcessingFailure).not.toHaveBeenCalled();
  });

  it('종결돼 수집 대상이 아니면 closed_lifecycle 로 닫는다', async () => {
    const { orchestrator, provider, failures } = setup();
    failures.findRetryableProcessingFailures.mockResolvedValue([retryRow()]);
    provider.fetchOrderForSync!.mockResolvedValue({
      outcome: {
        kind: 'order',
        order: makeOrder('2026-10-07T01:00:00.000Z', { externalOrderId: 'A', orderId: ORDER_ID, eligibleForOrderCreation: false }),
      },
      lifecycle: [],
    });

    await orchestrator.poll();

    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('processing_A', expect.any(String));
    expect(failures.markReplayed).not.toHaveBeenCalled();
  });

  it('식별 실패로 바뀌면 식별 격리를 기록하고 이 행은 메모와 함께 replayed 로 닫는다', async () => {
    const { orchestrator, provider, failures } = setup();
    failures.findRetryableProcessingFailures.mockResolvedValue([retryRow()]);
    provider.fetchOrderForSync!.mockResolvedValue({
      outcome: { kind: 'failure', failure: { ...makeFailure('2026-10-07T01:00:00.000Z'), externalOrderId: 'A' } },
      lifecycle: [],
    });

    await orchestrator.poll();

    expect(failures.recordFailure).toHaveBeenCalledWith('medusa', expect.objectContaining({ externalOrderId: 'A' }));
    expect(failures.markReplayed).toHaveBeenCalledWith('processing_A', undefined, expect.stringContaining('식별'));
  });

  it('채널에서 못 찾으면 바로 닫지 않고 fetch 실패 1회로 센다', async () => {
    const { orchestrator, provider, failures } = setup();
    failures.findRetryableProcessingFailures.mockResolvedValue([retryRow()]);
    provider.fetchOrderForSync!.mockResolvedValue(null);

    await orchestrator.poll();

    expect(failures.recordProcessingFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({ externalOrderId: 'A', stage: 'fetch', sourceUpdatedAt: '2026-10-07T01:00:00.000Z' }),
    );
    expect(failures.markReplayed).not.toHaveBeenCalled();
    expect(failures.closeAsTerminalLifecycle).not.toHaveBeenCalled();
  });

  it('실패 단계를 그대로 기록한다 — 조회 throw 는 fetch, 번역 태그는 translate, 적재는 enqueue_order', async () => {
    const { orchestrator, provider, failures, outbox } = setup();
    failures.findRetryableProcessingFailures.mockResolvedValue([
      retryRow({ id: 'p1', externalOrderId: 'A' }),
      retryRow({ id: 'p2', externalOrderId: 'B' }),
      retryRow({ id: 'p3', externalOrderId: 'C' }),
    ]);
    provider.fetchOrderForSync!.mockImplementation(async (externalOrderId: string) => {
      if (externalOrderId === 'A') throw new Error('naver 500');
      if (externalOrderId === 'B') throw new OrderProcessingStageError('translate', new Error('translator broke'), { id: 'B' });
      return { outcome: { kind: 'order', order: makeOrder('2026-10-07T01:00:00.000Z', { externalOrderId: 'C', orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }) }, lifecycle: [] };
    });
    outbox.enqueue.mockRejectedValue(new Error('contract violation'));

    await orchestrator.poll();

    const stages = failures.recordProcessingFailure.mock.calls.map(([, failure]) => `${failure.externalOrderId}:${failure.stage}`);
    expect(stages).toEqual(['A:fetch', 'B:translate', 'C:enqueue_order']);
  });

  it('syncable 이 아닌 provider 는 재시도를 건너뛴다', async () => {
    const { orchestrator, failures } = setup({ syncable: false });

    await orchestrator.poll();

    expect(failures.findRetryableProcessingFailures).not.toHaveBeenCalled();
  });

  it('본 루프가 실패한 주기에는 재시도하지 않는다', async () => {
    const { orchestrator, failures } = setup({ fetchOrders: jest.fn().mockRejectedValue(new Error('medusa down')) });

    await orchestrator.poll();

    expect(failures.findRetryableProcessingFailures).not.toHaveBeenCalled();
  });

  it('재시도가 터져도 채널 sync 상태를 실패로 바꾸지 않는다', async () => {
    const { orchestrator, failures, syncStatus } = setup();
    failures.findRetryableProcessingFailures.mockRejectedValue(new Error('db blip'));

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).toHaveBeenCalledTimes(1);
    expect(syncStatus.recordSyncFailure).not.toHaveBeenCalled();
  });

  it('수동 replay 는 상한을 다 쓴 행도 되살린다', async () => {
    const { orchestrator, provider, failures } = setup();
    failures.findById.mockResolvedValue(retryRow({ attemptCount: 4 }));
    provider.fetchOrderForSync!.mockResolvedValue({ outcome: { kind: 'order', order: orderA() }, lifecycle: [] });

    const result = await orchestrator.replayFailure('processing_A');

    expect(result).toEqual({
      status: 'replayed',
      failureId: 'processing_A',
      externalOrderId: 'A',
      emitted: 1,
      dedupedUnchanged: 0,
    });
    expect(failures.markReplayed).toHaveBeenCalledWith('processing_A', ORDER_ID);
  });

  it('syncOrder 의 호출자는 단계 태그가 아니라 원래 에러를 받는다', async () => {
    const { orchestrator, provider } = setup();
    const original = new Error('translator broke');
    provider.fetchOrderForSync!.mockRejectedValue(new OrderProcessingStageError('translate', original, {}));

    await expect(orchestrator.syncOrder('medusa', 'A')).rejects.toBe(original);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts -t "되살리기"`
Expected: FAIL — `findRetryableProcessingFailures` 가 불리지 않는다.

- [ ] **Step 3: 처리부를 뽑고 재시도·replay 를 구현한다**

`order-poller.orchestrator.ts` 의 import 를 더한다:

```ts
import { OrderCollectionFailureService, PROCESSING_FAILURE_MAX_ATTEMPTS, PROCESSING_FAILURE_RETRY_BATCH } from './order-collection-failure.service';
import { OrderProcessingStageError, errorMessage } from './order-processing-stage.error';
```

그리고 interface import 에 `OrderSyncFetch` 를 더한다.

`OrderSyncOutcome` 타입 아래에 더한다:

```ts
/** 즉시 끌어오기·재시도·replay 가 함께 쓰는 처리부의 결과. */
type SyncFetchResult = { outcome: OrderSyncOutcome; emitted: number; dedupedUnchanged: number; wmsOrderId?: string };

/** 처리 실패 행 하나를 되살린 결과 — `replayFailure` 응답 status 와 같은 어휘다 (스펙 §6.3). */
type ProcessingRetryStatus =
  | 'replayed'
  | 'already_processed'
  | 'closed_terminal'
  | 'moved_to_identification_quarantine'
  | 'still_quarantined';
```

`poll()` 에서 `recordSyncComplete(…)` 호출과 `Polled …` 로그 **뒤**, 채널 `try` 블록이 닫히기 전에:

```ts
        // 워터마크를 확정한 **뒤**에 돈다. 재시도가 터져도 이 채널의 sync 상태가 «실패»로 바뀌지 않는다 (스펙 §6.1).
        try {
          await this.retryProcessingFailures(provider, cycleStartedAt);
        } catch (error) {
          this.logger.error(`[${provider.channel}] 처리 실패 자동 재시도 중단: ${errorMessage(error)}`);
        }
```

`syncOrder` 의 `const fetched = …` 부터 `return { outcome };` 까지를 바꾼다:

```ts
    try {
      const fetched = await provider.fetchOrderForSync(externalOrderId);
      if (!fetched) {
        return { outcome: 'not_found' };
      }
      const { outcome } = await this.processSyncFetch(provider, fetched, options);
      return { outcome };
    } catch (error) {
      // 단계 태그는 처리 실패 행을 채우는 내부 용도다 — 호출자(HTTP·명령 소비자)는 원래 에러를 본다 (스펙 §6.3).
      throw error instanceof OrderProcessingStageError ? error.original : error;
    }
```

`syncFetched` 의 반환 타입과 끝부분을 바꾼다:

```ts
  /** 폴링 루프의 failure·order 갈래와 같은 처리. 워터마크 계산만 없다. */
  private async syncFetched(
    provider: ChannelOrderProvider,
    fetched: OrderFetchOutcome,
    options: { force?: boolean },
  ): Promise<SyncFetchResult> {
    if (fetched.kind === 'failure') {
      // …기존 본문 그대로…
      return { outcome: 'identification_failed', emitted: 0, dedupedUnchanged: 0 };
    }
    const result = await this.processOrderItem(provider, fetched.order, options);
    const counts = { emitted: result.emitted, dedupedUnchanged: result.dedupedUnchanged, wmsOrderId: result.wmsOrderId };
    if (result.created) return { outcome: 'created', ...counts };
    if (!result.wmsOrderId) {
      return { outcome: fetched.order.eligibleForOrderCreation === false ? 'not_eligible' : 'unchanged', ...counts };
    }
    return { outcome: result.emitted > 0 ? 'emitted' : 'unchanged', ...counts };
  }
```

`syncFetched` 위에 처리부를 더한다:

```ts
  /**
   * 즉시 끌어오기·자동 재시도·수동 replay 가 함께 쓰는 처리부 — 같은 주문을 되살리는 길이 하나다 (스펙 §6.3).
   * 주문을 먼저 처리해야 그 주문의 lifecycle 이 매핑을 찾는다(폴링 정렬의 order < lifecycle 과 같다).
   * 실패는 단계를 실은 `OrderProcessingStageError` 로 던진다.
   */
  private async processSyncFetch(
    provider: ChannelOrderProvider,
    fetched: OrderSyncFetch,
    options: { force?: boolean },
  ): Promise<SyncFetchResult> {
    let result: SyncFetchResult;
    try {
      result = await this.syncFetched(provider, fetched.outcome, options);
    } catch (error) {
      const input = fetched.outcome.kind === 'order' ? orderInput(fetched.outcome.order) : fetched.outcome.failure.rawOrder;
      throw new OrderProcessingStageError('enqueue_order', error, input);
    }
    for (const lifecycle of fetched.lifecycle) {
      let lifecycleResult: ProcessPollItemResult;
      try {
        lifecycleResult = await this.processLifecycleItem(provider, lifecycle);
      } catch (error) {
        throw new OrderProcessingStageError('enqueue_lifecycle', error, lifecycleInput(lifecycle));
      }
      result = {
        ...result,
        emitted: result.emitted + lifecycleResult.emitted,
        dedupedUnchanged: result.dedupedUnchanged + lifecycleResult.dedupedUnchanged,
        wmsOrderId: result.wmsOrderId ?? lifecycleResult.wmsOrderId,
      };
    }
    return result;
  }

  /** 채널 주기 끝의 자동 재시도 (스펙 §6.1·§6.2). syncable 이 아닌 provider 는 행을 그대로 둔다. */
  private async retryProcessingFailures(provider: ChannelOrderProvider, cycleStartedAt: Date): Promise<void> {
    if (!this.isSyncableProvider(provider)) {
      return;
    }
    const rows = await this.orderCollectionFailureService.findRetryableProcessingFailures(
      provider.channel,
      cycleStartedAt,
      PROCESSING_FAILURE_RETRY_BATCH,
    );
    for (const row of rows) {
      const { status } = await this.retryProcessingFailure(provider, row);
      this.logger.log(
        `[${provider.channel}] 처리 실패 ${row.externalOrderId} 자동 재시도(${row.attemptCount}/${PROCESSING_FAILURE_MAX_ATTEMPTS} 뒤): ${status}`,
      );
    }
  }

  /**
   * 처리 실패 행 하나를 되살린다 — 자동 재시도와 수동 replay 가 같이 쓴다 (스펙 §6.3·§6.5). 상한은 부르는 쪽이 본다.
   * 「못 찾음」은 바로 닫지 않고 실패 1회로 센다 — 일시 오류일 수 있고, 소진되면 사람이 판단한다.
   */
  private async retryProcessingFailure(
    provider: SyncableChannelOrderProvider,
    row: OrderCollectionFailure,
  ): Promise<{ status: ProcessingRetryStatus; emitted: number; dedupedUnchanged: number }> {
    const fail = async (stage: OrderProcessingStage, error: string, input: Record<string, unknown>) => {
      await this.recordProcessingFailure(provider.channel, {
        externalOrderId: row.externalOrderId,
        sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
        stage,
        error,
        input,
      });
      return { status: 'still_quarantined' as const, emitted: 0, dedupedUnchanged: 0 };
    };

    let fetched: OrderSyncFetch | null;
    try {
      fetched = await provider.fetchOrderForSync(row.externalOrderId);
    } catch (error) {
      return error instanceof OrderProcessingStageError
        ? fail(error.stage, error.message, error.input)
        : fail('fetch', errorMessage(error), {});
    }
    if (!fetched) {
      return fail('fetch', `채널에서 주문을 찾지 못했다: ${row.externalOrderId}`, {});
    }

    let result: SyncFetchResult;
    try {
      result = await this.processSyncFetch(provider, fetched, {});
    } catch (error) {
      if (!(error instanceof OrderProcessingStageError)) throw error;
      return fail(error.stage, error.message, error.input);
    }

    if (result.outcome === 'identification_failed') {
      await this.orderCollectionFailureService.markReplayed(row.id, undefined, '식별 실패 격리로 넘어감 — 그 행에서 조치한다');
      return { status: 'moved_to_identification_quarantine', emitted: 0, dedupedUnchanged: 0 };
    }
    if (result.outcome === 'not_eligible') {
      await this.orderCollectionFailureService.closeAsTerminalLifecycle(
        row.id,
        `Closed on retry: order ${row.externalOrderId} reached a terminal lifecycle and is no longer collectable`,
      );
      return { status: 'closed_terminal', emitted: 0, dedupedUnchanged: 0 };
    }
    await this.orderCollectionFailureService.markReplayed(row.id, result.wmsOrderId);
    return {
      status: result.emitted > 0 ? 'replayed' : 'already_processed',
      emitted: result.emitted,
      dedupedUnchanged: result.dedupedUnchanged,
    };
  }
```

interface import 에 `OrderProcessingStage` 도 더한다.

`replayFailure` 의 반환 status 유니온에 `| 'moved_to_identification_quarantine'` 를 더하고, `if (failure.reason === COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED) { … }` 블록 바로 아래에:

```ts
    if (failure.reason === ORDER_COLLECTION_PROCESSING_FAILED) {
      const provider = this.providers.find((candidate) => candidate.channel === failure.channel);
      if (!provider || !this.isSyncableProvider(provider)) {
        throw new Error(`No syncable order provider registered for channel: ${failure.channel}`);
      }
      // 수동 replay 는 상한을 보지 않는다 — 소진된 행을 사람이 되살리는 길이다 (스펙 §6.5).
      const result = await this.retryProcessingFailure(provider, failure);
      return { ...result, failureId, externalOrderId: failure.externalOrderId };
    }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts apps/channel-adapter/src/consumers apps/channel-adapter/src/controllers apps/channel-adapter/src/services/order-cancel`
Expected: 전부 PASS — 특히 기존 `syncOrder` 테스트 8건과 `syncOrder` 를 부르는 명령 소비자·취소 매니저·컨트롤러 스펙.

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.ts \
  apps/channel-adapter/src/services/order-collection/order-poller.orchestrator.spec.ts
git commit -m "feat(channel-adapter): 처리 실패 주문을 주기마다 되살린다 — 상한 4회, 수동 replay 는 상한 무시 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 5: 화면·보드 — 사람 몫은 한 숫자

**Files:**
- Modify: `apps/channel-adapter/src/controllers/order-collection-failures.controller.ts` (`@ApiQuery` reason enum, `buildReplayPath`)
- Modify: `apps/admin-web/src/features/mall/quarantine/guidance.ts`, `guidance.spec.ts`
- Modify: `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.shape.ts`, `order-collection-failures.shape.spec.ts`, `order-collection-failures.client.ts`
- Modify: `apps/admin-web/src/components/layout/quarantine-menu-badge.tsx`
- Modify: `apps/admin-web/src/features/mall/quarantine/components/quarantine-table/index.tsx`
- Modify: `apps/admin-web/src/features/mall/quarantine/components/quarantine-detail-dialog/index.tsx`

**Interfaces:**
- Consumes: 서버 행 필드 `attemptCount`·`failedStage`·`lastError`(Task 1), replay status `moved_to_identification_quarantine`(Task 4), 요약 엔드포인트(이미 있음, Task 1 이 정의를 좁힘)
- Produces: `stageLabel(stage: string | null | undefined): string | null`, `retryProgressLabel(row: { reason: string; status: string; attemptCount?: number }): string | null`, `isProcessingFailure(reason: string): boolean`

- [ ] **Step 1: 실패하는 admin-web 테스트를 쓴다**

`guidance.spec.ts` 의 import 를 `actionForCause, canReplay, isProcessingFailure, reasonLabel, replayResultMessage, retryProgressLabel, stageLabel` 로 바꾸고 끝에 더한다:

```ts
describe('수집 처리 실패 (#1016 1번 행)', () => {
  it('사유 라벨이 있다', () => {
    expect(reasonLabel('order_collection_processing_failed')).toBe('수집 처리 실패');
    expect(isProcessingFailure('order_collection_processing_failed')).toBe(true);
    expect(isProcessingFailure('channel_product_identification_failed')).toBe(false);
  });

  it('재처리할 수 있다 — 재시도 중이어도 사람이 먼저 누를 수 있다', () => {
    expect(canReplay('quarantined', 'order_collection_processing_failed')).toBe(true);
  });

  it('단계 라벨을 옮기고, 모르는 값은 원문, 없으면 null', () => {
    expect(stageLabel('fetch')).toBe('조회 실패');
    expect(stageLabel('translate')).toBe('변환 실패');
    expect(stageLabel('enqueue_order')).toBe('주문 적재 실패');
    expect(stageLabel('enqueue_lifecycle')).toBe('취소·환불 적재 실패');
    expect(stageLabel('mystery')).toBe('mystery');
    expect(stageLabel(null)).toBeNull();
    expect(stageLabel(undefined)).toBeNull();
  });

  it('재시도 중일 때만 진행 라벨을 준다 — 소진·종결·다른 사유는 null', () => {
    const row = { reason: 'order_collection_processing_failed', status: 'quarantined' };
    expect(retryProgressLabel({ ...row, attemptCount: 1 })).toBe('자동 재시도 중 (1/4)');
    expect(retryProgressLabel({ ...row, attemptCount: 3 })).toBe('자동 재시도 중 (3/4)');
    expect(retryProgressLabel({ ...row, attemptCount: 4 })).toBeNull();
    expect(retryProgressLabel({ ...row, status: 'replayed', attemptCount: 1 })).toBeNull();
    expect(retryProgressLabel({ reason: 'channel_product_identification_failed', status: 'quarantined', attemptCount: 0 })).toBeNull();
  });

  it('식별 실패로 넘어간 replay 결과에 문구가 있다', () => {
    expect(replayResultMessage('moved_to_identification_quarantine')).toBe(
      '상품 식별 실패로 넘어갔습니다. 식별 실패 격리 행에서 조치하세요.'
    );
  });
});
```

`order-collection-failures.shape.spec.ts` 에서 `formatQuarantineCount` import 와 `describe('formatQuarantineCount', …)` 블록(118행 부근)을 지운다 — 배지가 요약으로 옮겨 가서 쓰는 곳이 없어진다.

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run test:admin-web -- guidance`
Expected: FAIL — `stageLabel` 등이 없다.

- [ ] **Step 3: guidance 를 구현한다**

`guidance.ts`:

`QuarantineReason` 에 `| 'order_collection_processing_failed'`, `ReplayStatus` 에 `| 'moved_to_identification_quarantine'` 를 더한다.

`REPLAY_MESSAGES` 에 더한다:

```ts
  moved_to_identification_quarantine:
    '상품 식별 실패로 넘어갔습니다. 식별 실패 격리 행에서 조치하세요.',
```

`REASON_LABELS` 에 더한다:

```ts
  order_collection_processing_failed: '수집 처리 실패',
```

파일 끝에 더한다:

```ts
const PROCESSING_FAILURE_REASON = 'order_collection_processing_failed';

/**
 * 서버 상한과 같은 값이어야 한다 — apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts
 * 의 `PROCESSING_FAILURE_MAX_ATTEMPTS`. 정체 보드·배지가 «사람 몫»으로 세는 기준이 이 값이다.
 */
const PROCESSING_FAILURE_MAX_ATTEMPTS = 4;

const STAGE_LABELS: Record<string, string> = {
  fetch: '조회 실패',
  translate: '변환 실패',
  enqueue_order: '주문 적재 실패',
  enqueue_lifecycle: '취소·환불 적재 실패',
};

export function isProcessingFailure(reason: string): boolean {
  return reason === PROCESSING_FAILURE_REASON;
}

/** 처리 실패 행의 단계 라벨. 모르는 값은 원문을 보여 준다(조사 단서를 잃지 않기 위함 — `reasonLabel` 과 같은 이유). */
export function stageLabel(stage: string | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LABELS[stage] ?? stage;
}

/**
 * 자동 재시도가 아직 남은 처리 실패에만 진행 라벨을 준다. 소진된 행·종결 행·다른 사유는 null —
 * 정상 상태에 글씨를 더하지 않는다.
 */
export function retryProgressLabel(row: {
  reason: string;
  status: string;
  attemptCount?: number;
}): string | null {
  if (!isProcessingFailure(row.reason) || row.status !== 'quarantined') return null;
  const attempts = row.attemptCount ?? 0;
  if (attempts >= PROCESSING_FAILURE_MAX_ATTEMPTS) return null;
  return `자동 재시도 중 (${attempts}/${PROCESSING_FAILURE_MAX_ATTEMPTS})`;
}
```

- [ ] **Step 4: DTO·클라이언트를 맞춘다**

`order-collection-failures.shape.ts`:

`OrderCollectionFailureDto` 의 `errorMessage` 아래에:

```ts
  /** 처리 실패(`order_collection_processing_failed`) 행만 의미가 있다. 옛 서버 응답엔 없으므로 선택 필드다. */
  attemptCount?: number;
  failedStage?: string | null;
  lastError?: string | null;
```

`ReplayResultStatus` 에 `| 'moved_to_identification_quarantine'` 를 더한다. `formatQuarantineCount` 함수와 그 위 주석을 지운다.

`order-collection-failures.client.ts` 의 `export { QUARANTINE_LIST_LIMIT, formatQuarantineCount, } from …` 를 `export { QUARANTINE_LIST_LIMIT } from './order-collection-failures.shape';` 로 바꾼다.

- [ ] **Step 5: 배지를 요약으로 옮긴다**

`quarantine-menu-badge.tsx` 전체:

```tsx
'use client';

// src/components/layout/quarantine-menu-badge.tsx
// 사이드바 "채널 노출 관리" 메뉴 항목 옆에 격리 큐 건수를 보여준다. `menu.ts` 의
// `hasQuarantineBadge` 플래그가 붙은 항목에서만 마운트된다 — 모든 메뉴 항목마다 훅을
// 호출하지 않기 위함이다. count 가 0 이거나 로딩 중이면 아무것도 그리지 않는다: 격리가
// 없을 때도 배지가 보이면 운영자가 오해한다.
//
// 정체 보드 0단계와 **같은 요약**을 쓴다(#1016 1번 행). 목록 건수를 세면 자동 재시도 중인 처리 실패까지
// 세어 «보드는 0, 배지는 빨강»으로 갈린다. 요약은 서버가 «사람 몫»만 센 진짜 건수다(목록 상한 200 도 없다).

import { Badge } from '@/components/ui/badge';
import { useQuarantineSummary } from '@/lib/services/channel/queries';

export function QuarantineMenuBadge() {
  const { data, isLoading } = useQuarantineSummary();
  const count = data?.quarantined ?? 0;

  if (isLoading || count === 0) return null;

  return (
    <Badge
      variant="destructive"
      className="ml-auto text-xs group-data-[collapsible=icon]:hidden"
      aria-label={`격리 ${count}건`}
    >
      {count}
    </Badge>
  );
}
```

- [ ] **Step 6: 표·상세에 단계와 에러를 보여 준다**

`quarantine-table/index.tsx`: import 를 `import { canReplay, reasonLabel, retryProgressLabel, stageLabel } from '../../guidance';` 로 바꾸고, 사유 셀을 바꾼다:

```tsx
                    <TableCell className="text-xs">
                      {reasonLabel(row.reason)}
                      {stageLabel(row.failedStage) && (
                        <div className="text-muted-foreground">
                          {[stageLabel(row.failedStage), retryProgressLabel(row)]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </TableCell>
```

`quarantine-detail-dialog/index.tsx`: import 에 `isProcessingFailure, stageLabel` 을 더하고(`actionForCause, isProcessingFailure, replayResultMessage, stageLabel`), `<div className="space-y-3 text-sm">` 안의 삼항 전체를 다음으로 감싼다:

```tsx
                {isProcessingFailure(failure.reason) ? (
                  // 처리 실패는 라인 사유가 없다 — 단계와 마지막 에러가 원인이다(#1016 1번 행).
                  <div className="space-y-2">
                    <div className="font-medium">
                      {stageLabel(failure.failedStage) ?? '처리 실패'}
                    </div>
                    {failure.lastError && (
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {failure.lastError}
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      원인을 고친 뒤 재처리하세요.
                    </p>
                  </div>
                ) : !lines || lines.length === 0 ? (
```

(기존 `!lines || lines.length === 0 ? ( … ) : ( <ul>…</ul> )` 는 그대로 이어진다 — 앞에 갈래 하나가 더해질 뿐이다.)

- [ ] **Step 7: 서버 컨트롤러의 안내를 맞춘다**

`order-collection-failures.controller.ts` import 에 `ORDER_COLLECTION_PROCESSING_FAILED` 를 더하고, `list` 의 `@ApiQuery({ name: 'reason', … enum: [...] })` 배열에 `ORDER_COLLECTION_PROCESSING_FAILED` 를 더한다. `buildReplayPath` 의 마지막 `return { fix: …, endpoint: … }` 의 `fix` 삼항을 바꾼다:

```ts
  return {
    fix: replayFix(reason),
    endpoint: `POST /adapter/order-collection-failures/${id}/replay`,
  };
}

function replayFix(reason: string): string {
  if (reason === CHANNEL_PRODUCT_IDENTIFICATION_FAILED) {
    return 'Set pimVariantId on the affected Medusa variant metadata, then replay this failure.';
  }
  if (reason === ORDER_COLLECTION_PROCESSING_FAILED) {
    return 'Retried automatically each poll up to 4 attempts. Fix the cause in last_error, then replay this failure.';
  }
  return 'Collected Medusa order changes are not replayable. Handle this as a separate CS/order amendment workflow.';
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npm run test:admin-web -- quarantine order-collection-failures`
Expected: PASS.

Run: `(cd apps/admin-web && npx tsc --noEmit)`
Expected: 에러 0 (`formatQuarantineCount` 를 아직 import 하는 곳이 남아 있으면 여기서 잡힌다 — 지운다).

Run: `npm run type-check`
Expected: 에러 0.

- [ ] **Step 9: 커밋**

```bash
git add apps/channel-adapter/src/controllers/order-collection-failures.controller.ts \
  apps/admin-web/src/features/mall/quarantine apps/admin-web/src/lib/api/domains/channel \
  apps/admin-web/src/components/layout/quarantine-menu-badge.tsx
git commit -m "feat(admin-web): 수집 처리 실패를 격리 화면에 보이고, 배지는 정체 보드와 같은 «사람 몫» 요약을 센다 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 6: 전체 게이트와 문서 동기화

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-order-poll-per-order-isolation-design.md` (구현 중 바뀐 점이 있을 때만)

- [ ] **Step 1: 전체 게이트를 돌린다**

Run: `npm run type-check`
Expected: 에러 0.

Run: `npx jest --maxWorkers=2`
Expected: 실패 0. (`--maxWorkers=2` 는 이 저장소에서 jest OOM 을 피하려는 것이다.)

Run: `(cd apps/admin-web && npx tsc --noEmit) && npm run test:admin-web`
Expected: 에러 0, 실패 0.

Run: `npx dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure`
Expected: 처리 실패·요약·cause 통합 스펙 전부 PASS.

Run: `npx eslint apps/channel-adapter/src/services/order-collection apps/channel-adapter/src/controllers/order-collection-failures.controller.ts`
Expected: 에러 0 (Task 3 에서 남은 unused 경고가 없어야 한다).

- [ ] **Step 2: spec 과 구현을 대조한다**

spec §4~§7 을 다시 읽고 구현과 다른 곳이 있으면 spec 을 고친다(구현이 spec 보다 나은 근거가 있을 때만 — 아니면 구현을 고친다). 고쳤으면:

```bash
git add docs/superpowers/specs/2026-10-07-order-poll-per-order-isolation-design.md
git commit -m "docs(spec): 구현과 맞춘다 (#1016 1번 행)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

- [ ] **Step 3: PR 설명에 배포 순서를 적는다**

PR 본문에 반드시 넣는다: **`migrate → deploy`** (channel-adapter `db:migrate` 를 `sst deploy` 보다 먼저), 새 마이그레이션 파일 이름, 그리고 「2번 행(네이버 `+09:00`)은 고치지 않았다 — 이 PR 뒤 그 주문은 채널을 멈추지 않고 소진·격리된다」.

- [ ] **Step 4: #1016 본문 1번 행을 고친다 (PR 머지 뒤)**

머지 커밋 해시가 생긴 뒤에만 한다. 1번 행의 «문제» 칸을 범위가 넓어진 대로 고치고(「주문 1건의 수집 처리(조회·번역·주문 적재·lifecycle 적재) 실패가 …」), «해결» 칸에 머지 커밋 해시, «문서» 칸에 spec·plan 경로를 적는다. 코멘트는 달지 않는다(이슈 규칙).
