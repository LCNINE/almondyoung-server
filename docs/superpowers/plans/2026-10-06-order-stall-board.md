# 정체 보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매주문마다 «지금 단계·진입 시각»을 1분마다 투영(`order_progress`)하고, admin-web 정체 보드가 단계별 진행·갇힘 건수와 체류순 목록을 보여 준다.

**Architecture:** core 에 `order-progress` 모듈을 둔다. 판정은 SQL 한 벌(`judgedRowsSql`)이고, 1분 `@CronOnce` 가 후보 주문만 판정해 `INSERT … ON CONFLICT` 한 문장으로 upsert 한다(단계가 같으면 진입 시각 유지). API 둘(`summary`·`orders`)은 투영만 읽는다. 0단계는 admin-web 이 channel-adapter 의 새 요약 엔드포인트를 직접 부른다.

**Tech Stack:** NestJS 11 · Drizzle ORM(postgres.js) · `@app/cron-once` · Next.js(admin-web) · TanStack Query · Jest

**Spec:** `docs/superpowers/specs/2026-10-06-order-stall-board-design.md` (목업 `…-mockup.html`)

## Global Constraints

- 판정 SQL 은 `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts` 한 곳에만 둔다. 리컨실러가 이걸 읽는다(스펙 §4)
- 갇힘 = **단계** 체류 > 기준. 세부 상태가 바뀌어도 `stage_entered_at` 을 바꾸지 않는다(스펙 D5)
- 기준 시간은 `order-progress.thresholds.ts` 상수 한 파일(스펙 §6 표 값 그대로)
- 단계·결과 칸은 `varchar` + TS 유니온. pgEnum 금지(스펙 §4.1)
- 판매주문 `status` 가 `shipped`·`delivered` 면 종료 `external_shipped`(스펙 D3)
- core 는 channel-adapter 를 부르지 않는다. 0단계는 admin-web 이 직접(스펙 D9)
- 조치 버튼 없음(스펙 D8). 7단계 채널 통지 실패 제외(D10)
- raw SQL 에 `Date` 를 바인딩하지 않는다 — 항상 `toISOString()` + `::timestamptz`. 시각을 SQL 에서 꺼낼 때는 `to_char(… AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
- Service 는 위임만, 검증·SQL 은 Reader/Manager. `HttpException` 은 컨트롤러 경계 입력 검사에만
- admin-web 화면 판정(단계 이름·체류 표기·갇힘·갱신 경고)은 `.ts` 순수 함수 + 스펙. 설명·범례 문구를 깔지 않는다
- 게이트: `npm run type-check` 0 · `npx jest` 0 · `cd apps/admin-web && npx tsc --noEmit` 0
- 커밋 메시지 끝: `Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo`

## Review Focus

1. **한 상자가 두 판매주문에 걸침**(합포장): 상자는 두 주문 모두의 판정에 들어가야 한다 → Task 3 에 테스트
2. **회수(recall) 뒤 다시 계획된 상자**에 옛 `completed` 작업 항목이 남음: «발송 대기»가 아니라 송장/배치 대기로 보여야 한다(`completed_at >= planned_at` 조건) → Task 3 에 테스트
3. **`GET …/order-collection-failures/summary` 가 `:id` 라우트에 먹힘**: summary 는 `:id` 보다 먼저 선언해야 한다 → Task 6 에 supertest
4. **첫 백필이 1분을 넘김**: 같은 프로세스에서 다음 틱이 겹치면 건너뛴다 → Task 4 에 테스트
5. **투영이 아직 비었을 때(`evaluatedAt = null`)** 화면이 «갇힘 0»을 초록불처럼 보이면 안 된다 → «판정 전» 경고 → Task 7 에 테스트

---

## File Structure

**core — 새 모듈 `apps/core/src/modules/fulfillment/order-progress/`**

| 파일 | 책임 |
| --- | --- |
| `order-progress.thresholds.ts` | 단계·결과 상수, 기준 시간, `isStuck`·`stuckCutoff` |
| `order-progress.cursor.ts` | 목록 커서 인코딩·디코딩 |
| `order-progress.summary.ts` | 요약 행 → 응답 조립(0건 단계 채우기) |
| `order-progress.judge-sql.ts` | 판정 SQL(`judgedRowsSql`)과 후보 SQL(`candidateIdsSql`) |
| `order-progress.reader.ts` | 판정 실행(`judge`), 요약·목록 조회 |
| `order-progress.manager.ts` | 갱신(후보 → 판정 → upsert 한 문장) |
| `order-progress.refresh.job.ts` | `@CronOnce` 1분, 겹침 건너뛰기 |
| `order-progress.service.ts` · `order-progress.controller.ts` · `dto/*` | API |
| `order-progress.module.ts` | 배선 |
| `__support__/order-progress.fixtures.ts` | 통합 스펙 픽스처 |

수정: `apps/core/src/modules/inventory/schema/inventory.schema.ts`(테이블), `apps/core/src/app.module.ts`(모듈), `apps/core/drizzle/*`(생성 마이그).

**channel-adapter:** `order-collection-failure.service.ts`(요약), `order-collection-failures.controller.ts`(라우트).

**admin-web:** `lib/api/domains/orders/order-progress.{shape,client}.ts`, `lib/api/domains/channel/order-collection-failures.{shape,client}.ts`(요약), `lib/services/orders/{query-keys,queries}.ts`, `lib/services/channel/{query-keys,queries}.ts`, `features/order/stall-board/**`, `app/(admin)/order/stall-board/page.tsx`, `lib/utils/menu.ts`, `features/order/history/{contexts/filter.context.tsx,utils/pointed-order.ts}`.

---

### Task 1: 단계 상수·기준 시간·커서·요약 조립 (core, 순수)

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.cursor.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.cursor.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`

**Interfaces:**
- Produces:
  - `ORDER_PROGRESS_STAGES` (readonly tuple), `type OrderProgressStage`
  - `ORDER_PROGRESS_OUTCOMES`, `type OrderProgressOutcome`
  - `isOrderProgressStage(value: string): value is OrderProgressStage`
  - `STUCK_AFTER_MS: Record<OrderProgressStage, number>`
  - `stuckCutoff(stage: OrderProgressStage, now: Date): Date`
  - `isStuck(stage: OrderProgressStage, enteredAt: Date, now: Date): boolean`
  - `encodeCursor(at: Date, id: string): string`, `decodeCursor(cursor: string): { at: Date; id: string }`(형식이 틀리면 `BadRequestError`)
  - `type SummaryRow = { stage: string; state: string; open: number; stuck: number; oldest: string | null }`
  - `type OrderProgressSummary = { evaluatedAt: string | null; stages: StageSummary[] }`, `type StageSummary = { stage: OrderProgressStage; open: number; stuck: number; oldestEnteredAt: string | null; states: { state: string; open: number; stuck: number }[] }`
  - `assembleSummary(rows: SummaryRow[], evaluatedAt: string | null): OrderProgressSummary`

- [ ] **Step 1: 실패하는 테스트 작성**

`order-progress.thresholds.spec.ts`:

```ts
import { ORDER_PROGRESS_STAGES, STUCK_AFTER_MS, isStuck, stuckCutoff } from './order-progress.thresholds';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('order-progress thresholds', () => {
  it('스펙 §6 표의 기준을 그대로 갖는다', () => {
    expect(STUCK_AFTER_MS).toEqual({
      accept: HOUR,
      fo: DAY,
      reserve: 3 * DAY,
      plan: DAY,
      waybill: HOUR,
      pick: 12 * HOUR,
      dispatch: HOUR,
      track: 5 * DAY,
      cancel: HOUR,
      return_exchange: 7 * DAY,
      unclassified: 0,
    });
  });

  it('모든 단계에 기준이 있다', () => {
    for (const stage of ORDER_PROGRESS_STAGES) expect(typeof STUCK_AFTER_MS[stage]).toBe('number');
  });

  it('기준을 «넘겨야» 갇힘이다 — 같으면 아니다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('accept', new Date(now.getTime() - HOUR), now)).toBe(false);
    expect(isStuck('accept', new Date(now.getTime() - HOUR - 1), now)).toBe(true);
  });

  it('unclassified 는 들어온 순간부터 갇힘이다', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(isStuck('unclassified', new Date(now.getTime() - 1), now)).toBe(true);
  });

  it('stuckCutoff 는 now − 기준', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(stuckCutoff('fo', now).toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });
});
```

`order-progress.cursor.spec.ts`:

```ts
import { BadRequestError } from '@app/shared';
import { decodeCursor, encodeCursor } from './order-progress.cursor';

describe('order-progress cursor', () => {
  const id = '0b5c8f8e-3c1a-4d7e-9f00-1234567890ab';

  it('왕복한다', () => {
    const at = new Date('2026-10-06T01:02:03.456Z');
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ at, id });
  });

  it.each([['구분자 없음', id], ['시각이 아님', `nope|${id}`], ['uuid 아님', '2026-10-06T00:00:00.000Z|x']])(
    '%s 는 BadRequestError',
    (_label, cursor) => {
      expect(() => decodeCursor(cursor)).toThrow(BadRequestError);
    },
  );
});
```

`order-progress.summary.spec.ts`:

```ts
import { ORDER_PROGRESS_STAGES } from './order-progress.thresholds';
import { assembleSummary } from './order-progress.summary';

describe('assembleSummary', () => {
  it('0건 단계도 빠짐없이, 단계 순서대로 낸다', () => {
    const out = assembleSummary([], null);
    expect(out.evaluatedAt).toBeNull();
    expect(out.stages.map((s) => s.stage)).toEqual([...ORDER_PROGRESS_STAGES]);
    expect(out.stages.every((s) => s.open === 0 && s.stuck === 0 && s.oldestEnteredAt === null)).toBe(true);
  });

  it('세부 상태를 단계로 합치고 최장(가장 이른) 진입 시각을 고른다', () => {
    const out = assembleSummary(
      [
        { stage: 'fo', state: 'awaiting_matching', open: 10, stuck: 9, oldest: '2026-07-16T00:00:00.000Z' },
        { stage: 'fo', state: 'failed', open: 2, stuck: 2, oldest: '2026-09-01T00:00:00.000Z' },
      ],
      '2026-10-06T00:00:00.000Z',
    );
    const fo = out.stages.find((s) => s.stage === 'fo')!;
    expect(fo).toEqual({
      stage: 'fo',
      open: 12,
      stuck: 11,
      oldestEnteredAt: '2026-07-16T00:00:00.000Z',
      states: [
        { state: 'awaiting_matching', open: 10, stuck: 9 },
        { state: 'failed', open: 2, stuck: 2 },
      ],
    });
    expect(out.evaluatedAt).toBe('2026-10-06T00:00:00.000Z');
  });

  it('세부 상태는 건수 내림차순', () => {
    const out = assembleSummary(
      [
        { stage: 'pick', state: 'queued', open: 1, stuck: 0, oldest: null },
        { stage: 'pick', state: 'awaiting_batch', open: 5, stuck: 0, oldest: null },
      ],
      null,
    );
    expect(out.stages.find((s) => s.stage === 'pick')!.states.map((s) => s.state)).toEqual(['awaiting_batch', 'queued']);
  });

  it('알 수 없는 단계 행은 unclassified 로 모은다', () => {
    const out = assembleSummary([{ stage: 'mystery', state: 'x', open: 1, stuck: 1, oldest: null }], null);
    expect(out.stages.find((s) => s.stage === 'unclassified')!.open).toBe(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress`
Expected: FAIL — `Cannot find module './order-progress.thresholds'` 등

- [ ] **Step 3: 구현**

`order-progress.thresholds.ts`:

```ts
/**
 * 정체 보드의 단계·결과·갇힘 기준(스펙 §4.1·§6). 리컨실러도 이 파일을 읽는다 — 기준을 두 벌 두지 않는다.
 * 단계·결과는 DB 에서 varchar 다(pgEnum 은 값을 더할 때마다 마이그가 필요하고 같은 실행에서 새 값을 못 쓴다).
 */
export const ORDER_PROGRESS_STAGES = [
  'accept',
  'fo',
  'reserve',
  'plan',
  'waybill',
  'pick',
  'dispatch',
  'track',
  'cancel',
  'return_exchange',
  'unclassified',
] as const;
export type OrderProgressStage = (typeof ORDER_PROGRESS_STAGES)[number];

export const ORDER_PROGRESS_OUTCOMES = ['delivered', 'external_shipped', 'not_required', 'cancelled'] as const;
export type OrderProgressOutcome = (typeof ORDER_PROGRESS_OUTCOMES)[number];

export function isOrderProgressStage(value: string): value is OrderProgressStage {
  return (ORDER_PROGRESS_STAGES as readonly string[]).includes(value);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 달력 시간. 주말·공휴일을 빼지 않는다(스펙 D6). */
export const STUCK_AFTER_MS: Record<OrderProgressStage, number> = {
  accept: HOUR,
  fo: DAY,
  reserve: 3 * DAY,
  plan: DAY,
  waybill: HOUR,
  pick: 12 * HOUR,
  dispatch: HOUR,
  track: 5 * DAY,
  cancel: HOUR,
  return_exchange: 7 * DAY,
  unclassified: 0,
};

export function stuckCutoff(stage: OrderProgressStage, now: Date): Date {
  return new Date(now.getTime() - STUCK_AFTER_MS[stage]);
}

export function isStuck(stage: OrderProgressStage, enteredAt: Date, now: Date): boolean {
  return enteredAt.getTime() < stuckCutoff(stage, now).getTime();
}
```

`order-progress.cursor.ts`:

```ts
import { BadRequestError } from '@app/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 키셋 커서 `ISO시각|uuid`. 정렬 키(진입 시각 또는 주문일)와 동률을 가르는 id. */
export function encodeCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  const sep = cursor.lastIndexOf('|');
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (sep < 0 || Number.isNaN(at.getTime()) || !UUID.test(id)) throw new BadRequestError('Invalid cursor');
  return { at, id };
}
```

`order-progress.summary.ts`:

```ts
import { ORDER_PROGRESS_STAGES, OrderProgressStage, isOrderProgressStage } from './order-progress.thresholds';

export type SummaryRow = { stage: string; state: string; open: number; stuck: number; oldest: string | null };
export type StageSummary = {
  stage: OrderProgressStage;
  open: number;
  stuck: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number }[];
};
export type OrderProgressSummary = { evaluatedAt: string | null; stages: StageSummary[] };

/** 0건 단계도 채워 보낸다 — 화면이 단계 목록을 따로 들지 않게(스펙 §7.1). */
export function assembleSummary(rows: SummaryRow[], evaluatedAt: string | null): OrderProgressSummary {
  const byStage = new Map<OrderProgressStage, StageSummary>(
    ORDER_PROGRESS_STAGES.map((stage) => [stage, { stage, open: 0, stuck: 0, oldestEnteredAt: null, states: [] }]),
  );
  for (const row of rows) {
    const stage: OrderProgressStage = isOrderProgressStage(row.stage) ? row.stage : 'unclassified';
    const acc = byStage.get(stage)!;
    acc.open += row.open;
    acc.stuck += row.stuck;
    if (row.oldest !== null && (acc.oldestEnteredAt === null || row.oldest < acc.oldestEnteredAt)) {
      acc.oldestEnteredAt = row.oldest;
    }
    acc.states.push({ state: row.state, open: row.open, stuck: row.stuck });
  }
  for (const acc of byStage.values()) acc.states.sort((a, b) => b.open - a.open);
  return { evaluatedAt, stages: [...byStage.values()] };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress`
Expected: PASS (3 suites)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress
git commit -m "feat(core): 정체 보드 단계·갇힘 기준·커서·요약 조립 (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 2: `order_progress` 테이블과 마이그레이션

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts` (테이블 정의 + `wmsTables` 등록 + 타입)
- Create(생성): `apps/core/drizzle/<timestamp>_add-order-progress.sql`, `apps/core/drizzle/meta/*`

**Interfaces:**
- Produces: `wmsTables.orderProgress` (drizzle 테이블; 칸 `salesOrderId, salesChannel, orderedAt, stage, state, stageEnteredAt, outcome, closedAt, evaluatedAt`), `type OrderProgressRow = InferSelectModel<typeof orderProgress>`

⚠️ `db:generate` 는 대화형이라 **서브에이전트가 돌리지 못한다.** 서브에이전트는 Step 1~2 까지만 하고 멈추며, 컨트롤러(메인 세션)가 Step 3 을 실행한다.

- [ ] **Step 1: 스키마 추가**

`inventory.schema.ts` 에서 `fulfillmentOrderCreationBacklogs` 정의 바로 뒤에:

```ts
/**
 * 정체 보드 진행 투영 (스펙 docs/superpowers/specs/2026-10-06-order-stall-board-design.md §5).
 * 판매주문당 한 행. 1분 크론(order-progress-refresh)만 쓴다 — 원천은 판매주문·FO·상자·송장·작업 항목이고
 * 이 테이블은 그 판정 결과의 캐시이자 «단계에 들어온 시각»의 유일한 기록이다.
 * stage·outcome 은 varchar 다(pgEnum 은 값을 더할 때마다 마이그가 필요하다). 값 목록은 order-progress.thresholds.ts.
 */
export const orderProgress = pgTable(
  'order_progress',
  {
    salesOrderId: uuid('sales_order_id')
      .primaryKey()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    salesChannel: salesChannelEnum('sales_channel').notNull(),
    orderedAt: timestamp('ordered_at', { withTimezone: true }).notNull(),
    // NULL = 종료(outcome 이 있다)
    stage: varchar('stage', { length: 32 }),
    state: varchar('state', { length: 64 }),
    // 갇힘 판정은 이 칸만 본다. 단계가 같으면 세부 상태가 바뀌어도 그대로 둔다(스펙 D5).
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull(),
    // NULL = 진행 중
    outcome: varchar('outcome', { length: 32 }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    // 요약 집계·단계별 체류순 목록·갇힘 필터를 이 하나가 받는다(스펙 §5.1).
    idxOrderProgressOpenStage: index('idx_order_progress_open_stage')
      .on(t.stage, t.stageEnteredAt)
      .where(sql`${t.outcome} IS NULL`),
  }),
);
```

`wmsTables` 객체에서 `salesOrderAmendments,` 줄 다음에 `orderProgress,` 를 더한다. 타입 블록(`export type SalesOrderAmendment = …` 근처)에:

```ts
export type OrderProgressRow = InferSelectModel<typeof orderProgress>;
```

- [ ] **Step 2: 타입체크**

Run: `npm run type-check`
Expected: 에러 0

- [ ] **Step 3: 마이그레이션 생성 (메인 세션)**

Run: `npm run db:generate:core -- --name add-order-progress`
Expected: `apps/core/drizzle/<timestamp>_add-order-progress.sql` 이 생기고 내용은 `CREATE TABLE "order_progress"` + FK + `CREATE INDEX "idx_order_progress_open_stage" … WHERE "order_progress"."outcome" IS NULL` **뿐**이다. 다른 테이블의 DROP/ALTER 가 섞이면 스냅샷 체인이 어긋난 것이니 `git rm` 하고 멈춘다(사람에게 보고).

- [ ] **Step 4: 로컬 적용 확인**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core npx drizzle-kit migrate --config apps/core/drizzle.config.ts`
Expected: exit 0. (로컬 core DB 에 다른 브랜치 마이그 잔재가 있어 exit 1 이면 임시 DB `core_op_tmp` 를 만들어 거기에 적용하고, 이후 통합 테스트는 `LOCAL_PG` 대신 그 DB URL 로 돌린다.)

- [ ] **Step 5: 커밋 (schema.ts + SQL + meta 를 한 커밋에)**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle
git commit -m "feat(core): order_progress 투영 테이블 (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 3: 판정 SQL 과 reader.judge (통합 스펙)

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts` (이 태스크는 `judge` 만)
- Create: `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `OrderProgressStage`, `OrderProgressOutcome`
- Produces:
  - `judgedRowsSql(scope: SQL, nowIso: string): SQL` — 열: `sales_order_id, sales_channel, ordered_at, stage, state, outcome, estimated_entered_at`
  - `candidateIdsSql(sinceIso: string | null): SQL` — 한 열(`id`)
  - `type JudgedRow = { salesOrderId: string; salesChannel: string; stage: OrderProgressStage | null; state: string | null; outcome: OrderProgressOutcome | null; estimatedEnteredAt: string }`
  - `OrderProgressReader.judge(salesOrderIds: string[], now: Date, tx?: DbTx): Promise<JudgedRow[]>`
  - 픽스처: `seedOrder`, `seedBacklog`, `seedFo`, `seedBox`, `seedWorkItem`, `seedWaybill`, `seedConfirmedReservation`, `seedCancellation`, `seedReturn` (시그니처는 아래 코드)

- [ ] **Step 1: 픽스처 작성**

`__support__/order-progress.fixtures.ts`:

```ts
import { randomUUID } from 'crypto';
import { DbTx, returnRequests, wmsTables } from '../../../inventory/schema/inventory.schema';

/** 정체 보드 판정 스펙 전용 — 판정이 읽는 칸만 채운다(실제 흐름 서비스는 부르지 않는다). */
export type World = { warehouseId: string; skuId: string };

export async function seedWorld(tx: DbTx): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `op-wh-${suffix}`, supportedPickingStrategies: ['discrete'], isSellable: true })
    .returning();
  const [holder] = await tx.insert(wmsTables.holders).values({ name: `op-holder-${suffix}` }).returning();
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'op-sku', code: `OP-${randomUUID().toUpperCase()}`, holderId: holder.id })
    .returning();
  return { warehouseId: wh.id, skuId: sku.id };
}

export async function seedOrder(
  tx: DbTx,
  args: { status?: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled'; createdAt?: Date } = {},
): Promise<{ salesOrderId: string; lineId: string }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `OP-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: args.status ?? 'confirmed',
      shippingAddress: { name: 'OP', address1: 'x' },
      orderDate: args.createdAt ?? new Date(),
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({ salesOrderId: so.id, variantId: randomUUID(), productName: 'OP', quantity: 1, unitPrice: 1000 })
    .returning();
  return { salesOrderId: so.id, lineId: line.id };
}

export async function seedBacklog(
  tx: DbTx,
  salesOrderId: string,
  status: 'pending' | 'processing' | 'awaiting_matching' | 'completed' | 'not_required' | 'failed',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({ salesOrderId, status, createdAt });
}

export async function seedFo(
  tx: DbTx,
  w: World,
  order: { salesOrderId: string; lineId: string },
  args: {
    status?: 'created' | 'partially_reserved' | 'ready' | 'processing' | 'completed';
    dropShip?: 'pending' | 'forwarded' | 'completed' | 'canceled';
    createdAt?: Date;
  } = {},
): Promise<{ foId: string; foItemId: string }> {
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({
      salesOrderId: order.salesOrderId,
      warehouseId: w.warehouseId,
      status: args.status ?? 'ready',
      fulfillmentMode: args.dropShip ? 'drop_ship' : 'in_house',
      directShipStatus: args.dropShip ?? null,
      totalQty: 1,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fo.id,
      salesOrderId: order.salesOrderId,
      salesOrderLineId: order.lineId,
      skuId: w.skuId,
      qty: 1,
    })
    .returning();
  return { foId: fo.id, foItemId: item.id };
}

export async function seedBox(
  tx: DbTx,
  w: World,
  foItemIds: string[],
  args: {
    status: 'draft' | 'planned' | 'shipped' | 'in_transit' | 'delivered' | 'failed' | 'canceled' | 'recovery_required';
    recoveryCode?: string;
    openedAt?: Date;
    plannedAt?: Date;
    shippedAt?: Date;
  },
): Promise<{ shipmentId: string; lineIds: string[] }> {
  const [s] = await tx
    .insert(wmsTables.shipments)
    .values({
      warehouseId: w.warehouseId,
      status: args.status,
      recoveryCode: args.recoveryCode ?? null,
      openedAt: args.openedAt ?? new Date(),
      plannedAt: args.plannedAt ?? null,
      shippedAt: args.shippedAt ?? null,
    })
    .returning();
  const lineIds: string[] = [];
  for (const fulfillmentOrderItemId of foItemIds) {
    const [l] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: s.id, fulfillmentOrderItemId, skuId: w.skuId, qty: 1 })
      .returning();
    lineIds.push(l.id);
  }
  return { shipmentId: s.id, lineIds };
}

export async function seedWorkItem(
  tx: DbTx,
  w: World,
  shipmentId: string,
  args: { status: 'queued' | 'picking' | 'packing' | 'completed' | 'excluded'; completedAt?: Date; pickerClaimedAt?: Date },
): Promise<void> {
  const [batch] = await tx
    .insert(wmsTables.outboundBatches)
    .values({ batchNumber: `OP-B-${randomUUID()}`, warehouseId: w.warehouseId, pickingMethod: 'individual' })
    .returning();
  await tx.insert(wmsTables.outboundBatchWorkItems).values({
    batchId: batch.id,
    shipmentId,
    status: args.status,
    completedAt: args.completedAt ?? null,
    pickerClaimedAt: args.pickerClaimedAt ?? null,
  });
}

export async function seedWaybill(
  tx: DbTx,
  shipmentId: string,
  status: 'pending' | 'allocated' | 'registered' | 'used' | 'voided',
): Promise<void> {
  await tx.insert(wmsTables.waybills).values({
    shipmentId,
    source: 'manual',
    carrier: 'HANJIN',
    status,
    trackingNo: status === 'registered' || status === 'used' ? `T${Date.now()}` : null,
    manifestVersion: 1,
    recipientHash: 'x'.repeat(64),
  });
}

export async function seedConfirmedReservation(
  tx: DbTx,
  w: World,
  args: { foId: string; foItemId: string; shipmentLineId: string },
): Promise<void> {
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: args.foId,
    fulfillmentOrderItemId: args.foItemId,
    shipmentLineId: args.shipmentLineId,
    skuId: w.skuId,
    warehouseId: w.warehouseId,
    quantity: 1,
    status: 'confirmed',
  });
}

export async function seedCancellation(tx: DbTx, salesOrderId: string, occurredAt: Date): Promise<void> {
  await tx.insert(wmsTables.salesOrderCancellations).values({ salesOrderId, occurredAt, reasonCode: 'customer' });
}

export async function seedReturn(
  tx: DbTx,
  salesOrderId: string,
  status: 'requested' | 'collection_pending' | 'completed' | 'rejected',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(returnRequests).values({ salesOrderId, status, reasonCode: 'defective', createdAt });
}
```

(`salesOrderCancellations` 의 `reasonCode`·`cancelledBy` 는 nullable 이다. `stockReservations` 에 위 말고 NOT NULL·CHECK 제약이 걸리면 `inventory.schema.ts:1640` 정의를 보고 최소값을 채운다 — 픽스처는 판정이 읽는 칸 + 제약을 만족하는 최소값만 넣는다.)

- [ ] **Step 2: 실패하는 통합 스펙 작성**

`order-progress.judge.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressReader, JudgedRow } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('order-progress 판정 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let reader: OrderProgressReader;
  const now = new Date('2026-10-06T03:00:00.000Z');

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    reader = new OrderProgressReader(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  /** 시나리오를 롤백 트랜잭션 안에서 만들고 판정한다. */
  async function judgeIn(build: (tx: DbTx, w: f.World) => Promise<string[]>): Promise<JudgedRow[]> {
    let rows: JudgedRow[] = [];
    await expect(
      db.transaction(async (tx) => {
        const w = await f.seedWorld(tx as unknown as DbTx);
        const ids = await build(tx as unknown as DbTx, w);
        rows = await reader.judge(ids, now, tx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
    return rows;
  }
  const one = async (build: (tx: DbTx, w: f.World) => Promise<string>) =>
    (await judgeIn(async (tx, w) => [await build(tx, w)]))[0];

  it('backlog 없음 → accept/no_backlog, 진입 = 판매주문 created_at', async () => {
    const created = new Date('2026-10-06T02:00:00.000Z');
    const r = await one(async (tx) => (await f.seedOrder(tx, { createdAt: created })).salesOrderId);
    expect(r).toMatchObject({ stage: 'accept', state: 'no_backlog', outcome: null, estimatedEnteredAt: created.toISOString() });
  });

  it('backlog awaiting_matching → fo, 진입 = backlog created_at', async () => {
    const at = new Date('2026-07-16T00:00:00.000Z');
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'fo', state: 'awaiting_matching', estimatedEnteredAt: at.toISOString() });
  });

  it('backlog not_required → 종료 not_required', async () => {
    const r = await one(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'not_required');
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'not_required' });
  });

  it('판매주문 shipped(셀메이트) → 종료 external_shipped, 상자가 draft 여도', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'shipped' });
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o);
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'external_shipped' });
  });

  it('draft + FO partially_reserved → reserve, 진입 = FO created_at', async () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'partially_reserved', createdAt: at });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'reserve', state: 'partially_reserved', estimatedEnteredAt: at.toISOString() });
  });

  it('draft + FO ready → plan/awaiting_plan, 진입 = opened_at', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft', openedAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan', state: 'awaiting_plan', estimatedEnteredAt: at.toISOString() });
  });

  it('planned + 송장 없음 → waybill/none / registered → pick/awaiting_batch', async () => {
    const plannedAt = new Date('2026-10-05T10:00:00.000Z');
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', plannedAt });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fb.foItemId], { status: 'planned', plannedAt });
      await f.seedWaybill(tx, box.shipmentId, 'registered');
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['waybill', 'none'],
        ['pick', 'awaiting_batch'],
      ]),
    );
  });

  it('작업 중 → pick/<작업 상태>, completed 이고 아직 planned → dispatch', async () => {
    const plannedAt = new Date('2026-10-05T10:00:00.000Z');
    const doneAt = new Date('2026-10-05T11:00:00.000Z');
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      const ba = await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', plannedAt });
      await f.seedWorkItem(tx, w, ba.shipmentId, { status: 'picking', pickerClaimedAt: doneAt });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      const bb = await f.seedBox(tx, w, [fb.foItemId], { status: 'planned', plannedAt });
      await f.seedWorkItem(tx, w, bb.shipmentId, { status: 'completed', completedAt: doneAt });
      return [a.salesOrderId, b.salesOrderId];
    });
    const byStage = Object.fromEntries(rows.map((r) => [r.stage, r]));
    expect(byStage.pick).toMatchObject({ state: 'picking', estimatedEnteredAt: doneAt.toISOString() });
    expect(byStage.dispatch).toMatchObject({ state: 'awaiting_dispatch', estimatedEnteredAt: doneAt.toISOString() });
  });

  // Review Focus 2
  it('회수 뒤 다시 계획된 상자의 옛 completed 작업 항목은 dispatch 로 보지 않는다', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], {
        status: 'planned',
        plannedAt: new Date('2026-10-05T12:00:00.000Z'),
      });
      await f.seedWorkItem(tx, w, box.shipmentId, { status: 'completed', completedAt: new Date('2026-10-04T00:00:00.000Z') });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'waybill', state: 'none' });
  });

  it('상자 둘 중 하나만 발송 → 뒤처진 쪽(plan)', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'shipped', shippedAt: new Date('2026-10-05T00:00:00.000Z') });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'plan' });
  });

  it('상자 전부 delivered → 종료 delivered', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'delivered' });
  });

  it('shipped·in_transit → track, 진입 = shipped_at', async () => {
    const at = new Date('2026-10-04T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'in_transit', shippedAt: at });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'track', state: 'in_transit', estimatedEnteredAt: at.toISOString() });
  });

  it('직배 pending → dispatch/drop_ship_pending, forwarded → track', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      await f.seedFo(tx, w, a, { dropShip: 'pending' });
      const b = await f.seedOrder(tx);
      await f.seedFo(tx, w, b, { dropShip: 'forwarded' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['dispatch', 'drop_ship_pending'],
        ['track', 'drop_ship_forwarded'],
      ]),
    );
  });

  it('취소됐는데 상자가 남음 → cancel/open_shipment, 진입 = 마지막 취소 시각', async () => {
    const at = new Date('2026-09-01T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', plannedAt: at });
      await f.seedCancellation(tx, o.salesOrderId, at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'open_shipment', estimatedEnteredAt: at.toISOString() });
  });

  it('취소됐고 상자는 닫혔는데 확정 예약이 남음 → cancel/open_reservation', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'canceled' });
      await f.seedConfirmedReservation(tx, w, { foId: fo.foId, foItemId: fo.foItemId, shipmentLineId: box.lineIds[0] });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'open_reservation' });
  });

  it('취소됐고 남은 게 없음 → 종료 cancelled', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx, { status: 'cancelled' });
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'canceled' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: null, outcome: 'cancelled' });
  });

  it('살아 있는 주문의 상자가 CANCEL_REPLAN_PENDING → cancel/<코드>', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'planned', recoveryCode: 'CANCEL_REPLAN_PENDING' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'cancel', state: 'CANCEL_REPLAN_PENDING' });
  });

  it('CONSOLIDATION_PENDING → pick, 모르는 복구 코드 → unclassified', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      await f.seedBox(tx, w, [fa.foItemId], { status: 'planned', recoveryCode: 'CONSOLIDATION_PENDING' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      await f.seedBox(tx, w, [fb.foItemId], { status: 'recovery_required', recoveryCode: 'SOMETHING_NEW' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows.map((r) => [r.stage, r.state])).toEqual(
      expect.arrayContaining([
        ['pick', 'CONSOLIDATION_PENDING'],
        ['unclassified', 'SOMETHING_NEW'],
      ]),
    );
  });

  it('배송완료 뒤 열린 반품 → return_exchange/return:requested', async () => {
    const at = new Date('2026-10-05T00:00:00.000Z');
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await f.seedReturn(tx, o.salesOrderId, 'requested', at);
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'return_exchange', state: 'return:requested', estimatedEnteredAt: at.toISOString() });
  });

  it('FO 는 있는데 세는 상자가 없음 → unclassified/no_units', async () => {
    const r = await one(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'completed');
      await f.seedFo(tx, w, o, { status: 'ready' });
      return o.salesOrderId;
    });
    expect(r).toMatchObject({ stage: 'unclassified', state: 'no_units' });
  });

  // Review Focus 1
  it('한 상자에 두 판매주문(합포장) → 두 주문 모두 그 상자로 판정', async () => {
    const rows = await judgeIn(async (tx, w) => {
      const a = await f.seedOrder(tx);
      const fa = await f.seedFo(tx, w, a, { status: 'ready' });
      const b = await f.seedOrder(tx);
      const fb = await f.seedFo(tx, w, b, { status: 'ready' });
      await f.seedBox(tx, w, [fa.foItemId, fb.foItemId], { status: 'draft' });
      return [a.salesOrderId, b.salesOrderId];
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.stage === 'plan')).toBe(true);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test:core:integration:local -- order-progress.judge`
Expected: FAIL — `Cannot find module './order-progress.reader'`

- [ ] **Step 4: 판정 SQL 구현**

`order-progress.judge-sql.ts`:

```ts
import { SQL, sql } from 'drizzle-orm';

/**
 * 주문의 «지금 단계» 판정(스펙 §4). 정체 보드의 투영과 리컨실러가 함께 읽는 유일한 판정이다.
 * 집합 SQL 한 벌로 계산한다 — 행별 루프면 첫 백필(수만 건)이 크론 주기를 넘긴다.
 *
 * scope 는 판매주문 id 한 열을 돌려주는 SELECT. nowIso 는 추정 시각이 없을 때 쓰는 «지금»(ISO 문자열).
 * 결과 열: sales_order_id, sales_channel, ordered_at, stage, state, outcome, estimated_entered_at
 */
export function judgedRowsSql(scope: SQL, nowIso: string): SQL {
  const now = sql`${nowIso}::timestamptz`;
  return sql`
    WITH so AS (
      SELECT s.id, s.status::text AS status, s.sales_channel::text AS sales_channel,
             s.order_date, s.created_at, s.updated_at
        FROM sales_orders s
       WHERE s.id IN (${scope})
    ),
    bl AS (
      SELECT DISTINCT ON (b.sales_order_id) b.sales_order_id, b.status::text AS status, b.created_at
        FROM fulfillment_order_creation_backlogs b
        JOIN so ON so.id = b.sales_order_id
       ORDER BY b.sales_order_id, b.created_at DESC
    ),
    fo AS (
      SELECT f.id, f.sales_order_id, f.status::text AS status, f.fulfillment_mode::text AS mode,
             f.direct_ship_status::text AS ds, f.created_at, f.updated_at
        FROM fulfillment_orders f
        JOIN so ON so.id = f.sales_order_id
    ),
    -- 상자 하나 × 그 상자에 라인이 있는 판매주문 하나. 합포장 상자는 주문마다 한 행씩 나온다.
    box AS (
      SELECT fo.sales_order_id, s.id AS shipment_id, s.status::text AS status, s.recovery_code,
             s.opened_at, s.planned_at, s.shipped_at,
             bool_or(fo.status IN ('created', 'partially_reserved')) AS under_reserved,
             bool_or(fo.status = 'partially_reserved') AS partially_reserved,
             min(fo.created_at) AS fo_created_at
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fo ON fo.id = foi.fulfillment_order_id
       WHERE s.status NOT IN ('canceled', 'superseded')
       GROUP BY fo.sales_order_id, s.id
    ),
    -- 활성 작업 항목이 있으면 그것, 없으면 마지막 completed. excluded(배치에서 빠짐)는 보지 않는다.
    wi AS (
      SELECT DISTINCT ON (w.shipment_id) w.shipment_id, w.status::text AS status, w.picker_claimed_at, w.completed_at
        FROM outbound_batch_work_items w
       WHERE w.shipment_id IN (SELECT shipment_id FROM box) AND w.status <> 'excluded'
       ORDER BY w.shipment_id, (w.status = 'completed') ASC, w.created_at DESC
    ),
    -- 활성 송장 = 종결 상태(voided·failed·abandoned)가 아닌 것(waybill.constants WAYBILL_TERMINAL_STATUSES).
    wb AS (
      SELECT DISTINCT ON (x.shipment_id) x.shipment_id, x.status::text AS status
        FROM waybills x
       WHERE x.shipment_id IN (SELECT shipment_id FROM box) AND x.status NOT IN ('voided', 'failed', 'abandoned')
       ORDER BY x.shipment_id, x.created_at DESC
    ),
    box_kind AS (
      SELECT b.*, wi.status AS wi_status, wi.picker_claimed_at, wi.completed_at, wb.status AS wb_status,
             CASE
               WHEN b.status IN ('draft', 'planned', 'recovery_required') AND b.recovery_code = 'CANCEL_REPLAN_PENDING' THEN 'cancel_replan'
               WHEN b.status IN ('draft', 'planned', 'recovery_required') AND b.recovery_code = 'CONSOLIDATION_PENDING' THEN 'consolidation'
               WHEN b.status = 'recovery_required'
                 OR (b.status IN ('draft', 'planned') AND b.recovery_code IS NOT NULL) THEN 'recovery_unknown'
               WHEN b.status = 'draft' AND b.under_reserved THEN 'reserve'
               WHEN b.status = 'draft' THEN 'plan'
               WHEN b.status = 'planned'
                 AND wi.status IN ('queued', 'picking', 'ready_to_pack', 'packing', 'withdrawing', 'short_pick_recovery') THEN 'picking'
               -- 회수 뒤 다시 계획된 상자의 옛 completed 는 세지 않는다(완료가 이번 계획보다 뒤여야 한다)
               WHEN b.status = 'planned' AND wi.status = 'completed'
                 AND wi.completed_at >= coalesce(b.planned_at, '-infinity'::timestamptz) THEN 'dispatch'
               WHEN b.status = 'planned' AND (wb.status IS NULL OR wb.status NOT IN ('registered', 'used')) THEN 'waybill'
               WHEN b.status = 'planned' THEN 'awaiting_batch'
               WHEN b.status IN ('shipped', 'in_transit', 'failed') THEN 'track'
               WHEN b.status = 'delivered' THEN 'done'
               ELSE 'recovery_unknown'
             END AS kind
        FROM box b
        LEFT JOIN wi ON wi.shipment_id = b.shipment_id
        LEFT JOIN wb ON wb.shipment_id = b.shipment_id
    ),
    units AS (
      SELECT k.sales_order_id,
             CASE k.kind
               WHEN 'cancel_replan' THEN 'cancel' WHEN 'consolidation' THEN 'pick' WHEN 'recovery_unknown' THEN 'unclassified'
               WHEN 'reserve' THEN 'reserve' WHEN 'plan' THEN 'plan' WHEN 'picking' THEN 'pick'
               WHEN 'dispatch' THEN 'dispatch' WHEN 'waybill' THEN 'waybill' WHEN 'awaiting_batch' THEN 'pick'
               WHEN 'track' THEN 'track' ELSE 'done'
             END AS stage,
             CASE k.kind
               WHEN 'cancel_replan' THEN k.recovery_code WHEN 'consolidation' THEN k.recovery_code
               WHEN 'recovery_unknown' THEN coalesce(k.recovery_code, k.status)
               WHEN 'reserve' THEN CASE WHEN k.partially_reserved THEN 'partially_reserved' ELSE 'created' END
               WHEN 'plan' THEN 'awaiting_plan' WHEN 'picking' THEN k.wi_status
               WHEN 'dispatch' THEN 'awaiting_dispatch' WHEN 'waybill' THEN coalesce(k.wb_status, 'none')
               WHEN 'awaiting_batch' THEN 'awaiting_batch' WHEN 'track' THEN k.status ELSE NULL
             END AS state,
             CASE k.kind
               WHEN 'reserve' THEN k.fo_created_at WHEN 'plan' THEN k.opened_at
               WHEN 'picking' THEN coalesce(k.picker_claimed_at, k.planned_at)
               WHEN 'dispatch' THEN k.completed_at
               WHEN 'waybill' THEN k.planned_at WHEN 'awaiting_batch' THEN k.planned_at
               WHEN 'consolidation' THEN k.planned_at
               WHEN 'track' THEN k.shipped_at ELSE NULL
             END AS est
        FROM box_kind k
      UNION ALL
      SELECT fo.sales_order_id,
             CASE fo.ds WHEN 'pending' THEN 'dispatch' WHEN 'forwarded' THEN 'track' ELSE 'done' END,
             'drop_ship_' || fo.ds,
             CASE fo.ds WHEN 'pending' THEN fo.created_at ELSE fo.updated_at END
        FROM fo
       WHERE fo.mode = 'drop_ship' AND fo.ds IS NOT NULL AND fo.ds <> 'canceled'
    ),
    -- 주문의 대표 단위: 분류 안 됨 > 취소 > 가장 뒤처진 단계, 같은 단계면 가장 오래된 것
    rep AS (
      SELECT DISTINCT ON (u.sales_order_id) u.sales_order_id, u.stage, u.state, u.est
        FROM units u
       ORDER BY u.sales_order_id,
                CASE u.stage
                  WHEN 'unclassified' THEN 0 WHEN 'cancel' THEN 1 WHEN 'reserve' THEN 2 WHEN 'plan' THEN 3
                  WHEN 'waybill' THEN 4 WHEN 'pick' THEN 5 WHEN 'dispatch' THEN 6 WHEN 'track' THEN 7 ELSE 99
                END,
                u.est ASC NULLS LAST
    ),
    open_box AS (
      SELECT DISTINCT sales_order_id FROM box WHERE status IN ('draft', 'planned', 'recovery_required')
    ),
    -- 상자 상태와 무관하게(취소된 상자 포함) 그 주문 라인에 걸린 확정 예약
    open_res AS (
      SELECT DISTINCT fo.sales_order_id
        FROM stock_reservations r
        JOIN shipment_lines sl ON sl.id = r.shipment_line_id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fo ON fo.id = foi.fulfillment_order_id
       WHERE r.status = 'confirmed'
    ),
    last_cancel AS (
      SELECT c.sales_order_id, max(c.occurred_at) AS at
        FROM sales_order_cancellations c
        JOIN so ON so.id = c.sales_order_id
       GROUP BY c.sales_order_id
    ),
    rx AS (
      SELECT DISTINCT ON (x.sales_order_id) x.sales_order_id, x.kind || ':' || x.status AS state, x.created_at
        FROM (
          SELECT r.sales_order_id, 'return' AS kind, r.status::text AS status, r.created_at
            FROM return_requests r JOIN so ON so.id = r.sales_order_id
           WHERE r.status NOT IN ('completed', 'rejected', 'cancelled')
          UNION ALL
          SELECT e.sales_order_id, 'exchange', e.status::text, e.created_at
            FROM exchange_requests e JOIN so ON so.id = e.sales_order_id
           WHERE e.status NOT IN ('completed', 'rejected', 'cancelled')
        ) x
       ORDER BY x.sales_order_id, x.created_at ASC
    ),
    has_fo AS (SELECT DISTINCT sales_order_id FROM fo),
    decided AS (
      SELECT so.id, so.sales_channel, so.order_date, so.created_at AS so_created_at, so.updated_at AS so_updated_at,
             bl.status AS bl_status, bl.created_at AS bl_created_at,
             rep.stage AS rep_stage, rep.state AS rep_state, rep.est AS rep_est,
             lc.at AS cancel_at, rx.state AS rx_state, rx.created_at AS rx_at,
             (ob.sales_order_id IS NOT NULL) AS has_open_box,
             (hf.sales_order_id IS NOT NULL) AS has_fo,
             CASE
               WHEN so.status IN ('shipped', 'delivered') THEN 'external_shipped'
               WHEN so.status IN ('cancelled', 'timeout')
                 AND (ob.sales_order_id IS NOT NULL OR orr.sales_order_id IS NOT NULL) THEN 'cancel_open'
               WHEN so.status IN ('cancelled', 'timeout') THEN 'cancelled'
               WHEN rx.sales_order_id IS NOT NULL THEN 'return_exchange'
               WHEN bl.status = 'not_required' THEN 'not_required'
               WHEN hf.sales_order_id IS NULL AND bl.sales_order_id IS NULL THEN 'accept'
               WHEN hf.sales_order_id IS NULL AND bl.status <> 'completed' THEN 'fo'
               WHEN rep.stage IS NULL THEN 'unclassified'
               WHEN rep.stage = 'done' THEN 'delivered'
               ELSE 'unit'
             END AS rule
        FROM so
        LEFT JOIN bl ON bl.sales_order_id = so.id
        LEFT JOIN rep ON rep.sales_order_id = so.id
        LEFT JOIN open_box ob ON ob.sales_order_id = so.id
        LEFT JOIN open_res orr ON orr.sales_order_id = so.id
        LEFT JOIN last_cancel lc ON lc.sales_order_id = so.id
        LEFT JOIN rx ON rx.sales_order_id = so.id
        LEFT JOIN has_fo hf ON hf.sales_order_id = so.id
    )
    SELECT d.id AS sales_order_id,
           d.sales_channel,
           d.order_date AS ordered_at,
           CASE d.rule
             WHEN 'cancel_open' THEN 'cancel' WHEN 'return_exchange' THEN 'return_exchange'
             WHEN 'accept' THEN 'accept' WHEN 'fo' THEN 'fo' WHEN 'unclassified' THEN 'unclassified'
             WHEN 'unit' THEN d.rep_stage ELSE NULL
           END AS stage,
           CASE d.rule
             WHEN 'cancel_open' THEN coalesce(
               CASE WHEN d.rep_stage = 'cancel' THEN d.rep_state END,
               CASE WHEN d.has_open_box THEN 'open_shipment' ELSE 'open_reservation' END)
             WHEN 'return_exchange' THEN d.rx_state
             WHEN 'accept' THEN 'no_backlog'
             WHEN 'fo' THEN d.bl_status
             WHEN 'unclassified' THEN CASE WHEN d.has_fo THEN 'no_units' ELSE 'fo_missing' END
             WHEN 'unit' THEN d.rep_state ELSE NULL
           END AS state,
           CASE d.rule
             WHEN 'external_shipped' THEN 'external_shipped' WHEN 'cancelled' THEN 'cancelled'
             WHEN 'not_required' THEN 'not_required' WHEN 'delivered' THEN 'delivered' ELSE NULL
           END AS outcome,
           to_char(
             (CASE d.rule
                WHEN 'cancel_open' THEN coalesce(d.cancel_at, d.so_updated_at)
                WHEN 'return_exchange' THEN d.rx_at
                WHEN 'accept' THEN d.so_created_at
                WHEN 'fo' THEN d.bl_created_at
                WHEN 'unit' THEN coalesce(d.rep_est, ${now})
                ELSE ${now}
              END) AT TIME ZONE 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
           ) AS estimated_entered_at
      FROM decided d
  `;
}

/**
 * 갱신 대상(스펙 §5.2): 진행 중 행 + 행 없는 판매주문 + 직전 주기 뒤 판매주문·반품·교환·취소가 바뀐 주문.
 * sinceIso 가 null 이면(첫 실행) 전 판매주문. 2분 겹침은 직전 주기의 스냅샷 뒤·evaluated_at 앞에 커밋된 변경을 놓치지 않기 위해서다.
 */
export function candidateIdsSql(sinceIso: string | null): SQL {
  if (sinceIso === null) return sql`SELECT s.id FROM sales_orders s`;
  const since = sql`(${sinceIso}::timestamptz - interval '2 minutes')`;
  return sql`
    SELECT s.id
      FROM sales_orders s
      LEFT JOIN order_progress p ON p.sales_order_id = s.id
     WHERE p.sales_order_id IS NULL OR p.outcome IS NULL OR s.updated_at > ${since}
    UNION SELECT r.sales_order_id FROM return_requests r WHERE r.updated_at > ${since}
    UNION SELECT e.sales_order_id FROM exchange_requests e WHERE e.updated_at > ${since}
    UNION SELECT c.sales_order_id FROM sales_order_cancellations c WHERE c.updated_at > ${since}
  `;
}
```

`order-progress.reader.ts`(이 태스크 분):

```ts
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { judgedRowsSql } from './order-progress.judge-sql';
import { OrderProgressOutcome, OrderProgressStage } from './order-progress.thresholds';

export type JudgedRow = {
  salesOrderId: string;
  salesChannel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimatedEnteredAt: string;
};

type RawJudged = {
  sales_order_id: string;
  sales_channel: string;
  stage: OrderProgressStage | null;
  state: string | null;
  outcome: OrderProgressOutcome | null;
  estimated_entered_at: string;
};

@Injectable()
export class OrderProgressReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 지정한 판매주문들을 판정한다. 투영에 쓰지 않는다 — 리컨실러·스펙이 «지금 판정»을 볼 때 쓴다. */
  async judge(salesOrderIds: string[], now: Date, tx?: DbTx): Promise<JudgedRow[]> {
    if (salesOrderIds.length === 0) return [];
    return this.dbService.run(async (trx) => {
      const scope = sql`SELECT unnest(ARRAY[${sql.join(
        salesOrderIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}])`;
      const result = await trx.execute(judgedRowsSql(scope, now.toISOString()));
      // execute() 원시 결과 타이핑 — demand-series.writer.ts 와 같은 문서화된 캐스트.
      return (result as unknown as RawJudged[]).map((r) => ({
        salesOrderId: r.sales_order_id,
        salesChannel: r.sales_channel,
        stage: r.stage,
        state: r.state,
        outcome: r.outcome,
        estimatedEnteredAt: r.estimated_entered_at,
      }));
    }, tx);
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test:core:integration:local -- order-progress.judge`
Expected: PASS (전 시나리오). 실패하면 SQL 을 고치고 테스트 기대값은 스펙 §4 와 대조만 한다 — 스펙과 다른 기대값으로 테스트를 바꾸지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress
git commit -m "feat(core): 주문 «지금 단계» 판정 SQL (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 4: 갱신(upsert)과 1분 크론

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.manager.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.job.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.integration.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.job.spec.ts`

**Interfaces:**
- Consumes: Task 3 `judgedRowsSql`, `candidateIdsSql`; Task 2 `wmsTables.orderProgress`
- Produces:
  - `OrderProgressManager.refresh(now: Date, tx?: DbTx): Promise<{ upserted: number }>`
  - `OrderProgressManager.refreshScope(scope: SQL, now: Date, tx?: DbTx): Promise<{ upserted: number }>` (스펙이 범위를 좁혀 부를 수 있게)
  - `OrderProgressRefreshJob.runOnce(now?: Date): Promise<'ran' | 'skipped' | 'failed'>`

- [ ] **Step 1: 실패하는 테스트 작성**

`order-progress.refresh.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { sql, eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('order-progress 갱신 upsert (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let manager: OrderProgressManager;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    manager = new OrderProgressManager(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function inTx(body: (tx: DbTx, w: f.World) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await body(tx as unknown as DbTx, await f.seedWorld(tx as unknown as DbTx));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }
  const only = (id: string) => sql`SELECT ${id}::uuid`;
  const read = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.orderProgress).where(eq(wmsTables.orderProgress.salesOrderId, id)))[0];

  it('처음 넣을 때는 추정 시각, 단계가 같으면 세부 상태가 바뀌어도 진입 시각 유지', async () => {
    await inTx(async (tx) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date('2026-07-16T00:00:00.000Z'));
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      const first = await read(tx, o.salesOrderId);
      expect(first).toMatchObject({ stage: 'fo', state: 'awaiting_matching', outcome: null });
      expect(first.stageEnteredAt.toISOString()).toBe('2026-07-16T00:00:00.000Z');

      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'failed' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:01:00.000Z'), tx);
      const second = await read(tx, o.salesOrderId);
      expect(second.state).toBe('failed');
      expect(second.stageEnteredAt.toISOString()).toBe('2026-07-16T00:00:00.000Z');
      expect(second.evaluatedAt.toISOString()).toBe('2026-10-06T00:01:00.000Z');
    });
  });

  it('단계가 바뀌면 진입 시각 = 그 주기의 now', async () => {
    await inTx(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'pending');
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'completed' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:05:00.000Z'), tx);
      const row = await read(tx, o.salesOrderId);
      expect(row.stage).toBe('plan');
      expect(row.stageEnteredAt.toISOString()).toBe('2026-10-06T00:05:00.000Z');
    });
  });

  it('종료되면 outcome·closed_at, 다시 열리면 비우고 진입 = now', async () => {
    await inTx(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      const closed = await read(tx, o.salesOrderId);
      expect(closed).toMatchObject({ stage: null, outcome: 'delivered' });
      expect(closed.closedAt?.toISOString()).toBe('2026-10-06T00:00:00.000Z');

      await f.seedReturn(tx, o.salesOrderId, 'requested');
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-07T00:00:00.000Z'), tx);
      const reopened = await read(tx, o.salesOrderId);
      expect(reopened).toMatchObject({ stage: 'return_exchange', outcome: null, closedAt: null });
      expect(reopened.stageEnteredAt.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    });
  });
});
```

`order-progress.refresh.job.spec.ts`(Review Focus 4):

```ts
import { OrderProgressRefreshJob } from './order-progress.refresh.job';
import { OrderProgressManager } from './order-progress.manager';

describe('OrderProgressRefreshJob', () => {
  it('앞 실행이 끝나기 전 틱은 건너뛴다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const manager = { refresh: jest.fn(async () => { await gate; return { upserted: 1 }; }) };
    const job = new OrderProgressRefreshJob(manager as unknown as OrderProgressManager);

    const first = job.runOnce();
    await expect(job.runOnce()).resolves.toBe('skipped');
    release();
    await expect(first).resolves.toBe('ran');
    expect(manager.refresh).toHaveBeenCalledTimes(1);
  });

  it('실패해도 던지지 않고 다음 틱이 다시 돈다', async () => {
    const manager = { refresh: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ upserted: 0 }) };
    const job = new OrderProgressRefreshJob(manager as unknown as OrderProgressManager);
    await expect(job.runOnce()).resolves.toBe('failed');
    await expect(job.runOnce()).resolves.toBe('ran');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.job.spec.ts && npm run test:core:integration:local -- order-progress.refresh`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`order-progress.manager.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { candidateIdsSql, judgedRowsSql } from './order-progress.judge-sql';

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;

/**
 * 진행 투영 갱신(스펙 §5.2). 후보 → 판정 → upsert 를 한 문장으로 한다 — 원천은 읽기만 하고 잠그지 않는다.
 * 단계가 같으면 stage_entered_at 을 유지한다(세부 상태 변화로 시계를 되돌리지 않는다, 스펙 D5).
 */
@Injectable()
export class OrderProgressManager {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async refresh(now: Date, tx?: DbTx): Promise<{ upserted: number }> {
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(
        sql.raw(`SELECT to_char(max(evaluated_at) AT TIME ZONE 'UTC', ${ISO}) AS since FROM order_progress`),
      );
      const since = (result as unknown as { since: string | null }[])[0]?.since ?? null;
      return this.refreshScope(candidateIdsSql(since), now, trx);
    }, tx);
  }

  async refreshScope(scope: SQL, now: Date, tx?: DbTx): Promise<{ upserted: number }> {
    const nowIso = now.toISOString();
    const at = sql`${nowIso}::timestamptz`;
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(sql`
        INSERT INTO order_progress AS p
          (sales_order_id, sales_channel, ordered_at, stage, state, stage_entered_at, outcome, closed_at, evaluated_at)
        SELECT j.sales_order_id, j.sales_channel::sales_channel, j.ordered_at, j.stage, j.state,
               j.estimated_entered_at::timestamptz, j.outcome,
               CASE WHEN j.outcome IS NULL THEN NULL ELSE ${at} END,
               ${at}
          FROM (${judgedRowsSql(scope, nowIso)}) j
        ON CONFLICT (sales_order_id) DO UPDATE SET
          stage = EXCLUDED.stage,
          state = EXCLUDED.state,
          stage_entered_at = CASE WHEN p.stage IS NOT DISTINCT FROM EXCLUDED.stage THEN p.stage_entered_at ELSE ${at} END,
          outcome = EXCLUDED.outcome,
          closed_at = CASE
                        WHEN EXCLUDED.outcome IS NULL THEN NULL
                        WHEN p.outcome IS NOT DISTINCT FROM EXCLUDED.outcome THEN p.closed_at
                        ELSE ${at}
                      END,
          evaluated_at = EXCLUDED.evaluated_at
      `);
      // postgres.js 결과의 count = 영향받은 행 수
      return { upserted: (result as unknown as { count: number }).count ?? 0 };
    }, tx);
  }
}
```

`order-progress.refresh.job.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { CronOnce } from '@app/cron-once';
import { OrderProgressManager } from './order-progress.manager';

/**
 * 정체 보드 투영 1분 갱신. CronOnce 가 주기당 클러스터 한 번을 보장하고, 같은 프로세스 안에서 앞 실행이
 * 1분을 넘기면(첫 백필) 다음 틱을 건너뛴다. 실패는 로그만 남긴다 — 화면이 evaluatedAt 으로 멈춤을 드러낸다(스펙 §8.1).
 */
@Injectable()
export class OrderProgressRefreshJob {
  private readonly logger = new Logger(OrderProgressRefreshJob.name);
  private running = false;

  constructor(private readonly manager: OrderProgressManager) {}

  @CronOnce('* * * * *', { name: 'order-progress-refresh' })
  async tick(): Promise<void> {
    await this.runOnce();
  }

  async runOnce(now: Date = new Date()): Promise<'ran' | 'skipped' | 'failed'> {
    if (this.running) return 'skipped';
    this.running = true;
    const started = Date.now();
    try {
      const { upserted } = await this.manager.refresh(now);
      this.logger.log(`order-progress refresh: ${upserted} rows in ${Date.now() - started}ms`);
      return 'ran';
    } catch (error) {
      this.logger.error(
        `order-progress refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'failed';
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress && npm run test:core:integration:local -- order-progress`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress
git commit -m "feat(core): 진행 투영 1분 갱신 — 단계가 같으면 진입 시각 유지 (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 5: 요약·목록 API 와 모듈 배선

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts` (summary·listOrders 추가)
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.service.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.controller.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/dto/list-order-progress.dto.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/dto/order-progress-response.dto.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.module.ts`
- Modify: `apps/core/src/app.module.ts` (imports 에 `OrderProgressModule`)
- Test: `apps/core/src/modules/fulfillment/order-progress/dto/list-order-progress.dto.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 전부, Task 2 테이블, Task 4 `OrderProgressManager.refreshScope`, `OrderProgressRefreshJob`
- Produces:
  - `GET /order-progress/summary` → `OrderProgressSummary`(Task 1)
  - `GET /order-progress/orders?stage&state&stuck&channel&sort&limit&cursor` → `OrderProgressPage`
  - `type OrderProgressItem = { salesOrderId: string; orderNo: string; channelOrderId: string; salesChannel: string; customerName: string | null; orderedAt: string; state: string | null; stageEnteredAt: string; stuck: boolean }`
  - `type OrderProgressPage = { items: OrderProgressItem[]; nextCursor: string | null }`
  - `OrderProgressReader.summary(now: Date): Promise<OrderProgressSummary>`
  - `OrderProgressReader.listOrders(query: ListQuery, now: Date): Promise<OrderProgressPage>` — `ListQuery = { stage: OrderProgressStage; state?: string; stuck?: boolean; channel?: string; sort: 'dwell' | 'ordered'; limit: number; cursor?: string }`

- [ ] **Step 1: 실패하는 테스트 작성**

`dto/list-order-progress.dto.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListOrderProgressQueryDto } from './list-order-progress.dto';

const errorsOf = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(ListOrderProgressQueryDto, q)).map((e) => e.property);

describe('ListOrderProgressQueryDto', () => {
  it('stage 는 필수이고 알려진 값만', () => {
    expect(errorsOf({})).toContain('stage');
    expect(errorsOf({ stage: 'nope' })).toContain('stage');
    expect(errorsOf({ stage: 'fo' })).toEqual([]);
  });

  it('stuck 은 문자열 true/false 를 불리언으로', () => {
    const dto = plainToInstance(ListOrderProgressQueryDto, { stage: 'fo', stuck: 'true' });
    expect(dto.stuck).toBe(true);
    expect(plainToInstance(ListOrderProgressQueryDto, { stage: 'fo', stuck: 'false' }).stuck).toBe(false);
  });

  it('sort 는 dwell|ordered, limit 은 1~200', () => {
    expect(errorsOf({ stage: 'fo', sort: 'x' })).toContain('sort');
    expect(errorsOf({ stage: 'fo', limit: '201' })).toContain('limit');
  });
});
```

`order-progress.board.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('정체 보드 요약·목록 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  it('갇힘 수·체류순·커서·필터', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        // 이 트랜잭션 안의 행만 보이도록 다른 행을 지우지는 않는다 — 대신 우리 주문 id 로 걸러 검증한다.
        const now = new Date('2026-10-06T00:00:00.000Z');
        const ids: string[] = [];
        for (const at of ['2026-07-16T00:00:00.000Z', '2026-10-05T12:00:00.000Z', '2026-10-05T23:30:00.000Z']) {
          const o = await f.seedOrder(tx);
          await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date(at));
          ids.push(o.salesOrderId);
        }
        await manager.refreshScope(
          sql`SELECT unnest(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          now,
          tx,
        );

        const ours = (items: { salesOrderId: string }[]) => items.filter((i) => ids.includes(i.salesOrderId));

        // 체류순: 가장 오래된 것부터
        const first = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 200 }, now, tx);
        expect(ours(first.items).map((i) => i.salesOrderId)).toEqual(ids);
        expect(ours(first.items).map((i) => i.stuck)).toEqual([true, false, false]); // fo 기준 24시간

        // 갇힘만
        const stuck = await reader.listOrders({ stage: 'fo', stuck: true, sort: 'dwell', limit: 200 }, now, tx);
        expect(ours(stuck.items).map((i) => i.salesOrderId)).toEqual([ids[0]]);

        // 커서: 한 장씩 넘겨도 순서가 같다
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 1, cursor }, now, tx);
          seen.push(...page.items.map((i) => i.salesOrderId));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(seen.filter((id) => ids.includes(id))).toEqual(ids);

        // 요약: 우리 셋이 fo 에 더해져 있다
        const summary = await reader.summary(now, tx);
        const fo = summary.stages.find((s) => s.stage === 'fo')!;
        expect(fo.open).toBeGreaterThanOrEqual(3);
        expect(fo.stuck).toBeGreaterThanOrEqual(1);
        expect(summary.evaluatedAt).toBe('2026-10-06T00:00:00.000Z');
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
```

(주: `summary.evaluatedAt` 은 `max(evaluated_at)` 이다. 로컬 DB 에 실제 크론이 남긴 더 늦은 행이 있으면 이 단언이 깨질 수 있다 — 그럴 때는 로컬 `order_progress` 를 비우고 다시 돌린다. 테스트를 느슨하게 고치지 않는다.)

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/dto && npm run test:core:integration:local -- order-progress.board`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: DTO 구현**

`dto/list-order-progress.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { salesChannelEnum } from '../../../inventory/schema/inventory.schema';
import { ORDER_PROGRESS_STAGES, OrderProgressStage } from '../order-progress.thresholds';

export class ListOrderProgressQueryDto {
  @ApiProperty({ enum: ORDER_PROGRESS_STAGES })
  @IsIn(ORDER_PROGRESS_STAGES)
  stage!: OrderProgressStage;

  @ApiPropertyOptional({ description: '세부 상태(요약의 states[].state)' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: '기준 시간을 넘긴 주문만' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  stuck?: boolean;

  @ApiPropertyOptional({ enum: salesChannelEnum.enumValues })
  @IsOptional()
  @IsIn(salesChannelEnum.enumValues)
  channel?: string;

  @ApiPropertyOptional({ enum: ['dwell', 'ordered'], default: 'dwell' })
  @IsOptional()
  @IsIn(['dwell', 'ordered'])
  sort?: 'dwell' | 'ordered';

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: '다음 쪽 커서 = 응답의 nextCursor' })
  @IsOptional()
  @IsString()
  @Matches(/^[^|]+\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  cursor?: string;
}
```

`dto/order-progress-response.dto.ts`(Swagger 용 — 중첩은 별도 클래스):

```ts
import { ApiProperty } from '@nestjs/swagger';
import { ORDER_PROGRESS_STAGES } from '../order-progress.thresholds';

export class OrderProgressStateSummaryDto {
  @ApiProperty() state!: string;
  @ApiProperty() open!: number;
  @ApiProperty() stuck!: number;
}

export class OrderProgressStageSummaryDto {
  @ApiProperty({ enum: ORDER_PROGRESS_STAGES }) stage!: string;
  @ApiProperty() open!: number;
  @ApiProperty() stuck!: number;
  @ApiProperty({ nullable: true, type: String }) oldestEnteredAt!: string | null;
  @ApiProperty({ type: [OrderProgressStateSummaryDto] }) states!: OrderProgressStateSummaryDto[];
}

export class OrderProgressSummaryResponseDto {
  @ApiProperty({ nullable: true, type: String, description: '가장 최근 판정 시각. 5분 넘게 멈추면 화면이 경고한다' })
  evaluatedAt!: string | null;
  @ApiProperty({ type: [OrderProgressStageSummaryDto] }) stages!: OrderProgressStageSummaryDto[];
}

export class OrderProgressItemDto {
  @ApiProperty() salesOrderId!: string;
  @ApiProperty({ description: 'display_order_no ?? channel_order_id' }) orderNo!: string;
  @ApiProperty() channelOrderId!: string;
  @ApiProperty() salesChannel!: string;
  @ApiProperty({ nullable: true, type: String }) customerName!: string | null;
  @ApiProperty() orderedAt!: string;
  @ApiProperty({ nullable: true, type: String }) state!: string | null;
  @ApiProperty() stageEnteredAt!: string;
  @ApiProperty() stuck!: boolean;
}

export class OrderProgressPageDto {
  @ApiProperty({ type: [OrderProgressItemDto] }) items!: OrderProgressItemDto[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
```

- [ ] **Step 4: reader 에 요약·목록 추가**

`order-progress.reader.ts` 에 import 와 메서드를 더한다:

```ts
import { and, asc, desc, eq, isNull, lt, sql, SQL } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { decodeCursor, encodeCursor } from './order-progress.cursor';
import { OrderProgressSummary, assembleSummary } from './order-progress.summary';
import { ORDER_PROGRESS_STAGES, isStuck, stuckCutoff } from './order-progress.thresholds';

export type ListQuery = {
  stage: OrderProgressStage;
  state?: string;
  stuck?: boolean;
  channel?: string;
  sort: 'dwell' | 'ordered';
  limit: number;
  cursor?: string;
};
export type OrderProgressItem = {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  customerName: string | null;
  orderedAt: string;
  state: string | null;
  stageEnteredAt: string;
  stuck: boolean;
};
export type OrderProgressPage = { items: OrderProgressItem[]; nextCursor: string | null };

const isoOf = (expr: SQL) => sql<string | null>`to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
```

클래스 안:

```ts
  async summary(now: Date, tx?: DbTx): Promise<OrderProgressSummary> {
    const t = wmsTables.orderProgress;
    // 단계별 갇힘 기준선을 CASE 하나로 — 기준은 thresholds 한 곳에서만 온다
    const cutoff = sql`CASE ${t.stage} ${sql.join(
      ORDER_PROGRESS_STAGES.map((s) => sql`WHEN ${s} THEN ${stuckCutoff(s, now).toISOString()}::timestamptz`),
      sql` `,
    )} ELSE ${now.toISOString()}::timestamptz END`;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          stage: sql<string>`coalesce(${t.stage}, 'unclassified')`,
          state: sql<string>`coalesce(${t.state}, '')`,
          open: sql<number>`count(*)::int`,
          stuck: sql<number>`(count(*) FILTER (WHERE ${t.stageEnteredAt} < ${cutoff}))::int`,
          oldest: isoOf(sql`min(${t.stageEnteredAt})`),
        })
        .from(t)
        .where(isNull(t.outcome))
        .groupBy(t.stage, t.state);
      const [ev] = await trx.select({ at: isoOf(sql`max(${t.evaluatedAt})`) }).from(t);
      return assembleSummary(rows, ev?.at ?? null);
    }, tx);
  }

  async listOrders(query: ListQuery, now: Date, tx?: DbTx): Promise<OrderProgressPage> {
    const t = wmsTables.orderProgress;
    const so = wmsTables.salesOrders;
    const conds: SQL[] = [isNull(t.outcome), eq(t.stage, query.stage)];
    if (query.state) conds.push(eq(t.state, query.state));
    if (query.channel) conds.push(sql`${t.salesChannel}::text = ${query.channel}`);
    if (query.stuck === true) conds.push(lt(t.stageEnteredAt, stuckCutoff(query.stage, now)));
    if (query.stuck === false) conds.push(sql`${t.stageEnteredAt} >= ${stuckCutoff(query.stage, now).toISOString()}::timestamptz`);
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      conds.push(
        query.sort === 'dwell'
          ? sql`(${t.stageEnteredAt}, ${t.salesOrderId}) > (${c.at.toISOString()}::timestamptz, ${c.id}::uuid)`
          : sql`(${t.orderedAt}, ${t.salesOrderId}) < (${c.at.toISOString()}::timestamptz, ${c.id}::uuid)`,
      );
    }
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select({
          salesOrderId: t.salesOrderId,
          salesChannel: t.salesChannel,
          orderedAt: t.orderedAt,
          state: t.state,
          stageEnteredAt: t.stageEnteredAt,
          displayOrderNo: so.displayOrderNo,
          channelOrderId: so.channelOrderId,
          customerName: so.customerName,
        })
        .from(t)
        .innerJoin(so, eq(so.id, t.salesOrderId))
        .where(and(...conds))
        .orderBy(
          ...(query.sort === 'dwell'
            ? [asc(t.stageEnteredAt), asc(t.salesOrderId)]
            : [desc(t.orderedAt), desc(t.salesOrderId)]),
        )
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({
          salesOrderId: r.salesOrderId,
          orderNo: r.displayOrderNo ?? r.channelOrderId,
          channelOrderId: r.channelOrderId,
          salesChannel: r.salesChannel,
          customerName: r.customerName ?? null,
          orderedAt: r.orderedAt.toISOString(),
          state: r.state ?? null,
          stageEnteredAt: r.stageEnteredAt.toISOString(),
          stuck: isStuck(query.stage, r.stageEnteredAt, now),
        })),
        nextCursor:
          rows.length > query.limit && last
            ? encodeCursor(query.sort === 'dwell' ? last.stageEnteredAt : last.orderedAt, last.salesOrderId)
            : null,
      };
    }, tx);
  }
```

- [ ] **Step 5: service·controller·module**

`order-progress.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ListQuery, OrderProgressPage, OrderProgressReader } from './order-progress.reader';
import { OrderProgressSummary } from './order-progress.summary';

@Injectable()
export class OrderProgressService {
  constructor(private readonly reader: OrderProgressReader) {}

  summary(): Promise<OrderProgressSummary> {
    return this.reader.summary(new Date());
  }

  listOrders(query: ListQuery): Promise<OrderProgressPage> {
    return this.reader.listOrders(query, new Date());
  }
}
```

`order-progress.controller.ts`:

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ListOrderProgressQueryDto } from './dto/list-order-progress.dto';
import { OrderProgressPageDto, OrderProgressSummaryResponseDto } from './dto/order-progress-response.dto';
import { OrderProgressService } from './order-progress.service';

/** 정체 보드(스펙 2026-10-06). 전역 가드(admin·master)만 — 스펙 D11. */
@ApiTags('Order Progress')
@Controller('order-progress')
export class OrderProgressController {
  constructor(private readonly service: OrderProgressService) {}

  @Get('summary')
  @ApiOperation({ summary: '정체 보드 요약 — 단계별 진행·갇힘·최장 진입 시각' })
  @ApiResponse({ status: 200, type: OrderProgressSummaryResponseDto })
  summary() {
    return this.service.summary();
  }

  @Get('orders')
  @ApiOperation({ summary: '정체 보드 단계별 주문 목록' })
  @ApiResponse({ status: 200, type: OrderProgressPageDto })
  orders(@Query() q: ListOrderProgressQueryDto) {
    return this.service.listOrders({
      stage: q.stage,
      state: q.state,
      stuck: q.stuck,
      channel: q.channel,
      sort: q.sort ?? 'dwell',
      limit: q.limit ?? 50,
      cursor: q.cursor,
    });
  }
}
```

`order-progress.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrderProgressController } from './order-progress.controller';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import { OrderProgressRefreshJob } from './order-progress.refresh.job';
import { OrderProgressService } from './order-progress.service';

/**
 * 정체 보드 — 주문 진행 투영(스펙 docs/superpowers/specs/2026-10-06-order-stall-board-design.md).
 * 원천 모듈을 import 하지 않는다: 판정은 원천 테이블을 SQL 로 읽기만 한다. DbModule 은 전역.
 * 리컨실러는 OrderProgressReader 를 export 받아 쓴다.
 */
@Module({
  controllers: [OrderProgressController],
  providers: [OrderProgressReader, OrderProgressManager, OrderProgressRefreshJob, OrderProgressService],
  exports: [OrderProgressReader],
})
export class OrderProgressModule {}
```

`apps/core/src/app.module.ts`: import 줄 `import { OrderProgressModule } from './modules/fulfillment/order-progress/order-progress.module';` 을 더하고 `imports` 배열의 `WaybillModule,` 다음에 `OrderProgressModule,` 를 넣는다.

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress libs/cron-once && npm run test:core:integration:local -- order-progress && npm run type-check`
Expected: PASS, 타입 에러 0. (`libs/cron-once` 가드 스펙이 새 `@CronOnce` 이름 중복·모듈 누락을 본다.)

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress apps/core/src/app.module.ts
git commit -m "feat(core): 정체 보드 요약·목록 API (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 6: channel-adapter 격리 요약 엔드포인트

**Files:**
- Modify: `apps/channel-adapter/src/services/order-collection/order-collection-failure.service.ts`
- Modify: `apps/channel-adapter/src/controllers/order-collection-failures.controller.ts`
- Test: `apps/channel-adapter/src/controllers/order-collection-failures.summary.spec.ts`
- Test: `apps/channel-adapter/src/services/order-collection/order-collection-failure-summary.integration.spec.ts`

**Interfaces:**
- Produces:
  - `OrderCollectionFailureService.summarizeQuarantined(options?: { channel?: string }): Promise<{ quarantined: number; oldestCreatedAt: string | null }>`
  - `GET /adapter/order-collection-failures/summary?channel=` → `{ success: true, data: { quarantined, oldestCreatedAt }, timestamp }`

- [ ] **Step 1: 실패하는 테스트 작성**

`order-collection-failures.summary.spec.ts`(Review Focus 3):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { OrderCollectionFailuresController } from './order-collection-failures.controller';
import { OrderCollectionFailureService } from '../services/order-collection/order-collection-failure.service';
import { OrderPollerOrchestrator } from '../services/order-collection/order-poller.orchestrator';

describe('GET /adapter/order-collection-failures/summary', () => {
  let app: INestApplication;
  const failures = {
    summarizeQuarantined: jest.fn().mockResolvedValue({ quarantined: 3, oldestCreatedAt: '2026-10-01T00:00:00.000Z' }),
    get: jest.fn(),
    inspect: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OrderCollectionFailuresController],
      providers: [
        { provide: OrderCollectionFailureService, useValue: failures },
        { provide: OrderPollerOrchestrator, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it(':id 라우트가 아니라 요약으로 간다', async () => {
    const res = await request(app.getHttpServer()).get('/adapter/order-collection-failures/summary?channel=medusa');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ quarantined: 3, oldestCreatedAt: '2026-10-01T00:00:00.000Z' });
    expect(failures.summarizeQuarantined).toHaveBeenCalledWith({ channel: 'medusa' });
  });
});
```

(구현자 확인: 컨트롤러의 `:id` 핸들러가 부르는 서비스 메서드 이름을 열어 보고 mock 에 같은 이름을 둔다. 요점은 summarizeQuarantined 가 불렸는지다.)

`order-collection-failure-summary.integration.spec.ts`:

```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { OrderCollectionFailureService } from './order-collection-failure.service';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';
import { orderCollectionFailures } from '../../schema';

/**
 * 실행:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter \
 *   npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-summary.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('격리 요약 (PostgreSQL integration)', () => {
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
  afterAll(async () => {
    await db.delete(orderCollectionFailures).where(eq(orderCollectionFailures.channel, channel));
    await client.end({ timeout: 0 });
  });

  const insert = (externalOrderId: string, status: string, createdAt: string) =>
    db.insert(orderCollectionFailures).values({
      channel,
      externalOrderId,
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: [],
      rawOrder: {},
      sourceUpdatedAt: new Date(),
      status,
      createdAt: sql`${createdAt}::timestamp`,
    });

  it('quarantined 만 세고 가장 이른 created_at 을 준다', async () => {
    await insert('A', 'quarantined', '2026-10-01 00:00:00');
    await insert('B', 'quarantined', '2026-10-03 00:00:00');
    await insert('C', 'replayed', '2026-09-01 00:00:00');

    await expect(service.summarizeQuarantined({ channel })).resolves.toEqual({
      quarantined: 2,
      oldestCreatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('없으면 0 과 null', async () => {
    await expect(service.summarizeQuarantined({ channel: `${channel}-none` })).resolves.toEqual({
      quarantined: 0,
      oldestCreatedAt: null,
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/channel-adapter/src/controllers/order-collection-failures.summary.spec.ts`
Expected: FAIL — 404 또는 `summarizeQuarantined` 미호출

- [ ] **Step 3: 구현**

`order-collection-failure.service.ts` 의 `list` 다음에:

```ts
  /**
   * 격리 건수 요약 — 정체 보드 0단계(스펙 2026-10-06 §7.3). 목록은 상한 200건이라 건수로 쓸 수 없다.
   * created_at 은 tz 없는 timestamp 이고 DB 세션이 UTC 로 쓴다는 전제로 그대로 Z 를 붙인다.
   */
  async summarizeQuarantined(options: { channel?: string } = {}): Promise<{ quarantined: number; oldestCreatedAt: string | null }> {
    const conditions: SQL[] = [eq(orderCollectionFailures.status, 'quarantined')];
    if (options.channel) conditions.push(eq(orderCollectionFailures.channel, options.channel));
    const [row] = await this.db.db
      .select({
        quarantined: sql<number>`count(*)::int`,
        oldestCreatedAt: sql<string | null>`to_char(min(${orderCollectionFailures.createdAt}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
      })
      .from(orderCollectionFailures)
      .where(and(...conditions));
    return { quarantined: row?.quarantined ?? 0, oldestCreatedAt: row?.oldestCreatedAt ?? null };
  }
```

`order-collection-failures.controller.ts` — `list` 핸들러 **바로 다음, `@Get(':id')` 보다 앞에**:

```ts
  // `:id` 보다 먼저 선언해야 한다 — 뒤에 두면 'summary' 가 id 로 잡힌다.
  @Get('summary')
  @ApiOperation({ summary: '격리 건수 요약 (정체 보드 0단계)' })
  @ApiQuery({ name: 'channel', required: false, example: 'medusa' })
  async summary(@Query('channel') channel?: string) {
    const data = await this.failures.summarizeQuarantined({ channel });
    return { success: true, data, timestamp: new Date().toISOString() };
  }
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/channel-adapter/src/controllers/order-collection-failures.summary.spec.ts`
Expected: PASS
Run(로컬 DB 가 있으면): `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/channel_adapter npx jest --runInBand apps/channel-adapter/src/services/order-collection/order-collection-failure-summary.integration.spec.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/channel-adapter/src
git commit -m "feat(channel-adapter): 격리 건수 요약 엔드포인트 (#1016 정체 보드 0단계)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 7: admin-web 응답 정형·표기 순수 함수·클라이언트·훅

**Files:**
- Create: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.ts`
- Create: `apps/admin-web/src/lib/api/domains/orders/order-progress.client.ts`
- Modify: `apps/admin-web/src/lib/api/domains/orders/index.ts` (`progress` 추가)
- Modify: `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.shape.ts` (`toQuarantineSummary`)
- Modify: `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.client.ts` (`summary`)
- Modify: `apps/admin-web/src/lib/services/orders/query-keys.ts`, `queries.ts`
- Modify: `apps/admin-web/src/lib/services/channel/query-keys.ts`, `queries.ts`
- Test: `apps/admin-web/src/lib/api/domains/orders/order-progress.shape.spec.ts`
- Test: `apps/admin-web/src/lib/api/domains/channel/order-collection-failures.summary.spec.ts`

**Interfaces:**
- Consumes: Task 5 응답 모양, Task 6 응답 모양
- Produces (모두 `order-progress.shape.ts`):
  - `BOARD_STAGES: { key: BoardStageKey; no: string; name: string }[]` — `'collect'` + core 단계 순서(0~8, 취소, 반품·교환, 분류 안 됨)
  - `type BoardStageKey = 'collect' | 'accept' | 'fo' | 'reserve' | 'plan' | 'waybill' | 'pick' | 'dispatch' | 'track' | 'cancel' | 'return_exchange' | 'unclassified'`
  - `toProgressSummary(body: unknown): ProgressSummary` · `toProgressPage(body: unknown): ProgressPage`
  - `stateLabel(state: string | null): string`
  - `formatDwell(ms: number): string` — `'5분'`, `'3시간 12분'`, `'82일'`
  - `freshness(evaluatedAt: string | null, now: Date): 'fresh' | 'stale'` — null 이거나 5분 초과면 `'stale'`
  - `toQuarantineSummary(body: unknown): { quarantined: number; oldestCreatedAt: string | null }`
  - 훅: `useOrderProgressSummary()`, `useOrderProgressOrders(params)`, `useQuarantineSummary()`

- [ ] **Step 1: 실패하는 테스트 작성**

`order-progress.shape.spec.ts`:

```ts
import {
  BOARD_STAGES,
  formatDwell,
  freshness,
  stateLabel,
  toProgressPage,
  toProgressSummary,
} from './order-progress.shape';

describe('order-progress shape', () => {
  it('보드 단계 순서: 0 수집부터 8 추적, 그다음 취소·반품·교환·분류 안 됨', () => {
    expect(BOARD_STAGES.map((s) => s.key)).toEqual([
      'collect', 'accept', 'fo', 'reserve', 'plan', 'waybill', 'pick', 'dispatch', 'track',
      'cancel', 'return_exchange', 'unclassified',
    ]);
    expect(BOARD_STAGES.slice(0, 9).map((s) => s.no)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('요약은 envelope 여부와 무관하게 읽고, 깨진 몸통은 빈 요약', () => {
    const body = { evaluatedAt: '2026-10-06T00:00:00.000Z', stages: [{ stage: 'fo', open: 2, stuck: 1, oldestEnteredAt: null, states: [] }] };
    expect(toProgressSummary(body).stages[0].open).toBe(2);
    expect(toProgressSummary({ success: true, data: body }).stages[0].open).toBe(2);
    expect(toProgressSummary(null)).toEqual({ evaluatedAt: null, stages: [] });
  });

  it('목록 쪽은 items·nextCursor 를 읽는다', () => {
    expect(toProgressPage({ items: [], nextCursor: 'x' })).toEqual({ items: [], nextCursor: 'x' });
    expect(toProgressPage(undefined)).toEqual({ items: [], nextCursor: null });
  });

  it('체류 표기', () => {
    expect(formatDwell(4 * 60_000)).toBe('4분');
    expect(formatDwell(3 * 3_600_000 + 12 * 60_000)).toBe('3시간 12분');
    expect(formatDwell(6 * 3_600_000)).toBe('6시간');
    expect(formatDwell(82 * 86_400_000 + 5 * 3_600_000)).toBe('82일');
    expect(formatDwell(0)).toBe('0분');
  });

  // Review Focus 5
  it('판정 전(null)이거나 5분 넘게 멈췄으면 stale', () => {
    const now = new Date('2026-10-06T00:10:00.000Z');
    expect(freshness(null, now)).toBe('stale');
    expect(freshness('2026-10-06T00:05:00.000Z', now)).toBe('fresh');
    expect(freshness('2026-10-06T00:04:59.000Z', now)).toBe('stale');
  });

  it('세부 상태 한국어 이름, 모르는 값은 그대로', () => {
    expect(stateLabel('awaiting_matching')).toBe('매칭 대기');
    expect(stateLabel('return:collection_pending')).toBe('반품 회수 대기');
    expect(stateLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(stateLabel(null)).toBe('');
  });
});
```

`order-collection-failures.summary.spec.ts`:

```ts
import { toQuarantineSummary } from './order-collection-failures.shape';

describe('toQuarantineSummary', () => {
  it('인터셉터가 벗긴 몸통과 envelope 둘 다 읽는다', () => {
    const data = { quarantined: 3, oldestCreatedAt: '2026-10-01T00:00:00.000Z' };
    expect(toQuarantineSummary(data)).toEqual(data);
    expect(toQuarantineSummary({ success: true, data })).toEqual(data);
  });
  it('깨진 몸통은 0', () => {
    expect(toQuarantineSummary('x')).toEqual({ quarantined: 0, oldestCreatedAt: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- order-progress.shape order-collection-failures.summary`
Expected: FAIL — 모듈/함수 없음

- [ ] **Step 3: 구현**

`order-progress.shape.ts`:

```ts
// src/lib/api/domains/orders/order-progress.shape.ts
//
// 정체 보드 응답 정형·표기 순수 함수. admin-web 은 컴포넌트 테스트가 안 되므로 화면이 읽는 판정은 전부 여기서 한다.
// 서버 원형: apps/core/src/modules/fulfillment/order-progress/order-progress.controller.ts

export type BoardStageKey =
  | 'collect' | 'accept' | 'fo' | 'reserve' | 'plan' | 'waybill' | 'pick' | 'dispatch' | 'track'
  | 'cancel' | 'return_exchange' | 'unclassified';

export const BOARD_STAGES: { key: BoardStageKey; no: string; name: string }[] = [
  { key: 'collect', no: '0', name: '수집' },
  { key: 'accept', no: '1', name: '접수' },
  { key: 'fo', no: '2', name: 'FO 생성' },
  { key: 'reserve', no: '3', name: '예약' },
  { key: 'plan', no: '4', name: '계획' },
  { key: 'waybill', no: '5', name: '송장' },
  { key: 'pick', no: '6', name: '배치·피킹' },
  { key: 'dispatch', no: '7', name: '발송' },
  { key: 'track', no: '8', name: '추적' },
  { key: 'cancel', no: '', name: '취소' },
  { key: 'return_exchange', no: '', name: '반품·교환' },
  { key: 'unclassified', no: '', name: '분류 안 됨' },
];

export interface StageSummary {
  stage: string;
  open: number;
  stuck: number;
  oldestEnteredAt: string | null;
  states: { state: string; open: number; stuck: number }[];
}
export interface ProgressSummary { evaluatedAt: string | null; stages: StageSummary[] }
export interface ProgressItem {
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  salesChannel: string;
  customerName: string | null;
  orderedAt: string;
  state: string | null;
  stageEnteredAt: string;
  stuck: boolean;
}
export interface ProgressPage { items: ProgressItem[]; nextCursor: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function unwrap(body: unknown): unknown {
  return isRecord(body) && body.success === true && 'data' in body ? body.data : body;
}

export function toProgressSummary(body: unknown): ProgressSummary {
  const v = unwrap(body);
  if (!isRecord(v) || !Array.isArray(v.stages)) return { evaluatedAt: null, stages: [] };
  return { evaluatedAt: typeof v.evaluatedAt === 'string' ? v.evaluatedAt : null, stages: v.stages as StageSummary[] };
}

export function toProgressPage(body: unknown): ProgressPage {
  const v = unwrap(body);
  if (!isRecord(v) || !Array.isArray(v.items)) return { items: [], nextCursor: null };
  return { items: v.items as ProgressItem[], nextCursor: typeof v.nextCursor === 'string' ? v.nextCursor : null };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function formatDwell(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}일`;
  if (ms >= HOUR) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MIN);
    return m ? `${h}시간 ${m}분` : `${h}시간`;
  }
  return `${Math.floor(ms / MIN)}분`;
}

/** 판정이 멈췄는지(스펙 §8.1). null(판정 전)도 stale — «갇힘 0»을 초록불로 보이지 않게. */
export function freshness(evaluatedAt: string | null, now: Date): 'fresh' | 'stale' {
  if (!evaluatedAt) return 'stale';
  return now.getTime() - new Date(evaluatedAt).getTime() > 5 * MIN ? 'stale' : 'fresh';
}

const STATE_LABELS: Record<string, string> = {
  no_backlog: '출고 대기열 미적재',
  pending: '대기', processing: '처리 중', awaiting_matching: '매칭 대기', failed: '실패',
  created: '예약 전', partially_reserved: '부분 예약',
  awaiting_plan: '계획 대기',
  none: '송장 없음', allocated: '번호 할당',
  awaiting_batch: '배치 대기', queued: '작업 대기', picking: '피킹 중', ready_to_pack: '포장 대기',
  packing: '포장 중', withdrawing: '빼는 중', short_pick_recovery: '결품 복구', CONSOLIDATION_PENDING: '합포장 재개 대기',
  awaiting_dispatch: '발송 처리 대기', drop_ship_pending: '직배 대기',
  shipped: '발송됨', in_transit: '배송 중', drop_ship_forwarded: '직배 전달',
  CANCEL_REPLAN_PENDING: '재계획 대기', open_shipment: '상자 남음', open_reservation: '예약 남음',
  no_units: '상자 없음', fo_missing: 'FO 없음',
};
const REQUEST_STATUS: Record<string, string> = {
  requested: '요청', approved: '승인', collection_pending: '회수 대기', collected: '회수 완료',
  inspected: '검수 완료', refund_pending: '환불 대기',
};

export function stateLabel(state: string | null): string {
  if (!state) return '';
  const rx = /^(return|exchange):(.+)$/.exec(state);
  if (rx) return `${rx[1] === 'return' ? '반품' : '교환'} ${REQUEST_STATUS[rx[2]] ?? rx[2]}`;
  return STATE_LABELS[state] ?? state;
}
```

`order-progress.client.ts`:

```ts
'use client';

// src/lib/api/domains/orders/order-progress.client.ts
// 정체 보드 — 응답 정형은 ./order-progress.shape 가 한다.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { toProgressPage, toProgressSummary } from './order-progress.shape';
import type { ProgressPage, ProgressSummary } from './order-progress.shape';

export type OrderProgressListParams = {
  stage: string;
  state?: string;
  stuck?: boolean;
  channel?: string;
  sort?: 'dwell' | 'ordered';
  limit?: number;
  cursor?: string;
};

export const orderProgressClient = {
  summary: async (): Promise<ProgressSummary> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/order-progress/summary`);
    return toProgressSummary(response.data);
  },
  list: async (params: OrderProgressListParams): Promise<ProgressPage> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/order-progress/orders`, { params });
    return toProgressPage(response.data);
  },
};
```

`orders/index.ts`: `import { orderProgressClient } from './order-progress.client';`, `orders` 객체에 `progress: orderProgressClient,`, 하단 export 에 `export { orderProgressClient } from './order-progress.client';`.

`channel/order-collection-failures.shape.ts` 끝에(같은 파일의 기존 `isRecord`/unwrap 헬퍼가 있으면 그것을 쓴다):

```ts
export interface QuarantineSummary { quarantined: number; oldestCreatedAt: string | null }

/** GET /adapter/order-collection-failures/summary — 정체 보드 0단계. */
export function toQuarantineSummary(body: unknown): QuarantineSummary {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const v = record(body) && body.success === true && 'data' in body ? body.data : body;
  if (!record(v) || typeof v.quarantined !== 'number') return { quarantined: 0, oldestCreatedAt: null };
  return { quarantined: v.quarantined, oldestCreatedAt: typeof v.oldestCreatedAt === 'string' ? v.oldestCreatedAt : null };
}
```

`channel/order-collection-failures.client.ts`: shape import 에 `toQuarantineSummary`, type `QuarantineSummary` 를 더하고 `orderCollectionFailuresClient` 에:

```ts
  summary: async (): Promise<QuarantineSummary> => {
    const response = await client.get(`${CHANNEL_ADAPTER_SERVICE_BASE_URL}/adapter/order-collection-failures/summary`);
    return toQuarantineSummary(response.data);
  },
```

(구현자 확인: 같은 파일의 `list` 가 쓰는 base URL 상수·경로 접두를 그대로 따른다.)

`lib/services/orders/query-keys.ts` 의 객체에:

```ts
  progressSummary: ['order-progress', 'summary'] as const,
  progressOrders: (params: { stage: string; state: string; stuck: boolean; channel: string; sort: string }) =>
    ['order-progress', 'orders', params] as const,
```

`lib/services/orders/queries.ts` 끝에:

```ts
/** 정체 보드 요약 — 투영이 1분 주기라 60초마다 다시 부른다. */
export function useOrderProgressSummary() {
  return useQuery({
    queryKey: orderQueryKeys.progressSummary,
    queryFn: () => orders.progress.summary(),
    refetchInterval: 60_000,
  });
}

/** 정체 보드 단계별 목록. 키에 undefined 를 넣지 않는다 — 빈 문자열/false 로 고정(무효화가 조용히 빗나가지 않게). */
export function useOrderProgressOrders(params: { stage: string; state: string; stuck: boolean; channel: string; sort: 'dwell' | 'ordered' }) {
  return useInfiniteQuery({
    queryKey: orderQueryKeys.progressOrders(params),
    queryFn: ({ pageParam }) =>
      orders.progress.list({
        stage: params.stage,
        state: params.state || undefined,
        stuck: params.stuck || undefined,
        channel: params.channel || undefined,
        sort: params.sort,
        limit: 50,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: params.stage !== 'collect',
    refetchInterval: 60_000,
  });
}
```

(`useInfiniteQuery` 를 파일 상단 `@tanstack/react-query` import 에 더한다.)

`lib/services/channel/query-keys.ts` 객체에 `summary: ['order-collection-failures', 'summary'] as const,`.

`lib/services/channel/queries.ts` 끝에:

```ts
/** 정체 보드 0단계 — 격리 건수. 목록(상한 200)과 달리 진짜 건수다. */
export function useQuarantineSummary() {
  return useQuery({
    queryKey: channelQueryKeys.summary,
    queryFn: () => orderCollectionFailuresClient.summary(),
    refetchInterval: 60_000,
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test:admin-web -- order-progress.shape order-collection-failures && (cd apps/admin-web && npx tsc --noEmit)`
Expected: PASS, tsc 0

- [ ] **Step 5: 커밋**

```bash
git add apps/admin-web/src/lib
git commit -m "feat(admin-web): 정체 보드 응답 정형·표기·훅 (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 8: admin-web 정체 보드 화면·메뉴·주문 지목 링크

**Files:**
- Create: `apps/admin-web/src/features/order/history/utils/pointed-order.ts`
- Test: `apps/admin-web/src/features/order/history/utils/pointed-order.spec.ts`
- Modify: `apps/admin-web/src/features/order/history/contexts/filter.context.tsx`
- Create: `apps/admin-web/src/features/order/stall-board/components/stage-band.tsx`
- Create: `apps/admin-web/src/features/order/stall-board/components/stage-orders.tsx`
- Create: `apps/admin-web/src/features/order/stall-board/template/index.tsx`
- Create: `apps/admin-web/src/app/(admin)/order/stall-board/page.tsx`
- Modify: `apps/admin-web/src/lib/utils/menu.ts`

**Interfaces:**
- Consumes: Task 7 전부
- Produces: `pointedOrderNo(params: { get(name: string): string | null }, isDemo: boolean): string | null` — `orderNo` 파라미터(모든 스테이지), 데모면 `externalOrderId` 도

- [ ] **Step 1: 실패하는 테스트 작성**

`pointed-order.spec.ts`:

```ts
import { pointedOrderNo } from './pointed-order';

const params = (q: Record<string, string>) => ({ get: (n: string) => q[n] ?? null });

describe('pointedOrderNo', () => {
  it('orderNo 는 어느 스테이지에서나 읽는다', () => {
    expect(pointedOrderNo(params({ orderNo: 'order_01J' }), false)).toBe('order_01J');
  });
  it('externalOrderId 는 데모에서만', () => {
    expect(pointedOrderNo(params({ externalOrderId: 'X' }), false)).toBeNull();
    expect(pointedOrderNo(params({ externalOrderId: 'X' }), true)).toBe('X');
  });
  it('공백뿐이면 없음', () => {
    expect(pointedOrderNo(params({ orderNo: '  ' }), false)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test:admin-web -- pointed-order`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 주문 지목 링크 구현**

`pointed-order.ts`:

```ts
/**
 * 다른 화면(정체 보드)이 주문 하나를 지목해 주문내역으로 보낼 때 쓰는 쿼리. `?orderNo=` 는 «주문번호» 지목 검색이 되어
 * 기간·구분 필터를 타지 않는다(build-query.ts 의 isOrderNoLookup). 데모의 `externalOrderId` 는 옛 동작 그대로.
 */
export function pointedOrderNo(params: { get(name: string): string | null }, isDemo: boolean): string | null {
  const raw = params.get('orderNo') ?? (isDemo ? params.get('externalOrderId') : null);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}
```

`filter.context.tsx`: `import { pointedOrderNo } from '../utils/pointed-order';` 를 더하고

```ts
    const demoOrder = process.env.NEXT_PUBLIC_APP_STAGE === 'demo' ? searchParams.get('externalOrderId') : null;
```

를

```ts
    const demoOrder = pointedOrderNo(searchParams, process.env.NEXT_PUBLIC_APP_STAGE === 'demo');
```

로 바꾼다(변수 이름은 아래 두 줄이 그대로 쓰므로 유지).

- [ ] **Step 4: 화면 구현**

`stage-band.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils/ui';
import { BOARD_STAGES, BoardStageKey, formatDwell } from '@/lib/api/domains/orders/order-progress.shape';

export type BandCell = { key: BoardStageKey; open: number; stuck: number; oldestAt: string | null };

/** 위쪽 띠 — 0~8 단계, 점선 오른쪽에 취소·반품·교환(·분류 안 됨은 있을 때만). 설명·범례는 두지 않는다. */
export function StageBand(props: { cells: BandCell[]; selected: BoardStageKey; onSelect: (k: BoardStageKey) => void; now: Date }) {
  const byKey = new Map(props.cells.map((c) => [c.key, c]));
  const main = BOARD_STAGES.slice(0, 9);
  const side = BOARD_STAGES.slice(9).filter((s) => s.key !== 'unclassified' || (byKey.get(s.key)?.open ?? 0) > 0);
  const card = (s: (typeof BOARD_STAGES)[number]) => {
    const c = byKey.get(s.key) ?? { key: s.key, open: 0, stuck: 0, oldestAt: null };
    return (
      <button
        key={s.key}
        type="button"
        onClick={() => props.onSelect(s.key)}
        className={cn(
          'flex min-w-0 flex-col gap-1 rounded-lg border bg-white p-2.5 text-left transition-colors hover:border-slate-400',
          c.open === 0 && 'opacity-50',
          c.stuck > 0 && 'border-t-[3px] border-t-red-600 pt-2',
          props.selected === s.key && 'border-primary ring-1 ring-primary',
        )}
      >
        <span className="truncate text-xs text-muted-foreground">
          {s.no && <b className="mr-1 text-foreground tabular-nums">{s.no}</b>}
          {s.name}
        </span>
        <span className="text-[22px] font-bold leading-tight tabular-nums">{c.open.toLocaleString('ko-KR')}</span>
        <span className="min-h-4 text-xs font-semibold text-red-600 tabular-nums">
          {c.stuck > 0 ? `갇힘 ${c.stuck.toLocaleString('ko-KR')}` : ''}
        </span>
        <span className="min-h-3.5 text-[11px] text-muted-foreground">
          {c.oldestAt ? `최장 ${formatDwell(props.now.getTime() - new Date(c.oldestAt).getTime())}` : ''}
        </span>
      </button>
    );
  };
  return (
    <div className="grid grid-cols-[repeat(9,minmax(0,1fr))_14px_repeat(var(--side),minmax(0,1fr))] gap-2" style={{ ['--side' as string]: side.length }}>
      {main.map(card)}
      <div className="mx-1.5 my-1.5 border-l border-dashed" />
      {side.map(card)}
    </div>
  );
}
```

`stage-orders.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useOrderProgressOrders } from '@/lib/services/orders/queries';
import { BOARD_STAGES, BoardStageKey, StageSummary, formatDwell, stateLabel } from '@/lib/api/domains/orders/order-progress.shape';
import { cn } from '@/lib/utils/ui';

/** 아래 목록 — 세부 상태 칩, 갇힘만, 채널, 정렬. 체류 긴 순이 기본(스펙 D7). 행은 주문내역 지목 검색으로 간다. */
export function StageOrders(props: { stage: Exclude<BoardStageKey, 'collect'>; summary: StageSummary | undefined; now: Date }) {
  const [state, setState] = useState('');
  const [stuck, setStuck] = useState(false);
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState<'dwell' | 'ordered'>('dwell');
  const q = useOrderProgressOrders({ stage: props.stage, state, stuck, channel, sort });
  const meta = BOARD_STAGES.find((s) => s.key === props.stage)!;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const open = props.summary?.open ?? 0;

  return (
    <section className="flex flex-col rounded-lg border bg-white">
      <div className="flex flex-col gap-2.5 border-b px-4 pb-2.5 pt-3.5">
        <h2 className="text-base font-semibold">{meta.no ? `${meta.no} ${meta.name}` : meta.name}</h2>
        {props.summary && props.summary.states.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[{ state: '', open, stuck: 0 }, ...props.summary.states].map((s) => (
              <button
                key={s.state || '__all'}
                type="button"
                onClick={() => setState(s.state)}
                className={cn('rounded-full border px-2.5 py-0.5 text-[13px]', state === s.state && 'border-foreground bg-foreground text-background')}
              >
                {s.state ? stateLabel(s.state) : '전체'}
                <span className="ml-1 opacity-75 tabular-nums">{s.open.toLocaleString('ko-KR')}</span>
                {s.stuck > 0 && <span className="ml-1 font-semibold text-red-600">⚠{s.stuck.toLocaleString('ko-KR')}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setStuck((v) => !v)}
            className={cn('rounded-md border px-2.5 py-1 text-[13px]', stuck && 'border-red-600 bg-red-50 font-semibold text-red-600')}
          >
            갇힘만
          </button>
          <select className="rounded-md border px-2 py-1 text-[13px]" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">모든 채널</option>
            <option value="medusa">medusa</option>
            <option value="naver">naver</option>
            <option value="coupang">coupang</option>
          </select>
          <select className="rounded-md border px-2 py-1 text-[13px]" value={sort} onChange={(e) => setSort(e.target.value as 'dwell' | 'ordered')}>
            <option value="dwell">체류 긴 순</option>
            <option value="ordered">주문일 최신순</option>
          </select>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground">{q.isLoading ? '' : open ? '조건에 맞는 주문 없음' : '이 단계에 머무는 주문 없음'}</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">주문번호</th>
              <th className="px-4 py-2 text-left font-medium">채널</th>
              <th className="px-4 py-2 text-left font-medium">고객</th>
              <th className="px-4 py-2 text-left font-medium">주문일</th>
              <th className="px-4 py-2 text-left font-medium">세부 상태</th>
              <th className="px-4 py-2 text-right font-medium">체류</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.salesOrderId} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-[13px]">
                  <Link href={`/order/history?orderNo=${encodeURIComponent(r.channelOrderId)}`}>{r.orderNo}</Link>
                </td>
                <td className="px-4 py-2">{r.salesChannel}</td>
                <td className="px-4 py-2">{r.customerName ?? ''}</td>
                <td className="px-4 py-2">{new Date(r.orderedAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-4 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{stateLabel(r.state)}</span></td>
                <td className={cn('px-4 py-2 text-right tabular-nums', r.stuck && 'font-semibold text-red-600')}>
                  {formatDwell(props.now.getTime() - new Date(r.stageEnteredAt).getTime())}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.hasNextPage && (
        <button type="button" className="border-t py-2 text-sm text-muted-foreground" onClick={() => q.fetchNextPage()}>
          더 보기
        </button>
      )}
    </section>
  );
}
```

`template/index.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useOrderProgressSummary } from '@/lib/services/orders/queries';
import { useQuarantineSummary } from '@/lib/services/channel/queries';
import { BoardStageKey, formatDwell, freshness } from '@/lib/api/domains/orders/order-progress.shape';
import { StageBand, BandCell } from '../components/stage-band';
import { StageOrders } from '../components/stage-orders';
import { cn } from '@/lib/utils/ui';

export default function StallBoardTemplate() {
  const [selected, setSelected] = useState<BoardStageKey>('fo');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  const summary = useOrderProgressSummary();
  const quarantine = useQuarantineSummary();

  const stages = summary.data?.stages ?? [];
  const cells: BandCell[] = [
    {
      key: 'collect',
      open: quarantine.data?.quarantined ?? 0,
      stuck: quarantine.data?.quarantined ?? 0, // 격리는 전부 사람 일(스펙 §6)
      oldestAt: quarantine.data?.oldestCreatedAt ?? null,
    },
    ...stages.map((s) => ({ key: s.stage as BoardStageKey, open: s.open, stuck: s.stuck, oldestAt: s.oldestEnteredAt })),
  ];
  const evaluatedAt = summary.data?.evaluatedAt ?? null;
  const stale = summary.isSuccess && freshness(evaluatedAt, now) === 'stale';

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold">정체 보드</h1>
        <span className={cn('text-xs text-muted-foreground', stale && 'font-semibold text-red-600')}>
          {evaluatedAt ? `${formatDwell(now.getTime() - new Date(evaluatedAt).getTime())} 전 판정` : summary.isSuccess ? '판정 전' : ''}
        </span>
      </div>
      <StageBand cells={cells} selected={selected} onSelect={setSelected} now={now} />
      {selected === 'collect' ? (
        <Link href="/mall/channel-listings" className="rounded-lg border bg-white px-4 py-10 text-center text-sm">
          수집 격리 목록으로
        </Link>
      ) : (
        <StageOrders key={selected} stage={selected} summary={stages.find((s) => s.stage === selected)} now={now} />
      )}
    </div>
  );
}
```

`app/(admin)/order/stall-board/page.tsx`:

```tsx
// src/app/(admin)/order/stall-board/page.tsx

import RouteGuard from '@/components/layout/route-guard';
import StallBoardTemplate from '@/features/order/stall-board/template';

export default function StallBoardPage() {
  return (
    <RouteGuard requireRole={['admin', 'master']}>
      <StallBoardTemplate />
    </RouteGuard>
  );
}
```

`lib/utils/menu.ts` — `order-history` 항목 바로 다음에:

```ts
      {
        id: 'stall-board',
        title: '정체 보드',
        path: '/order/stall-board',
      },
```

(구현자 확인: `Link`·`RouteGuard` 사용은 같은 폴더의 다른 페이지를 열어 맞춘다. Tailwind 임의값 문법이 이 프로젝트 설정(v4)에서 안 먹으면 같은 의미의 인라인 style 로 바꾼다.)

- [ ] **Step 5: 확인**

Run: `npm run test:admin-web -- pointed-order order-progress && (cd apps/admin-web && npx tsc --noEmit)`
Expected: PASS, tsc 0

- [ ] **Step 6: 커밋**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): 정체 보드 화면·메뉴, 주문내역 지목 링크 (#1016 정체 보드)

Claude-Session: https://claude.ai/code/session_01N3soJ6vzpwcVQS4yCDUFeo"
```

---

### Task 9: 게이트·브라우저 스모크

**Files:** 없음(검증만). 고칠 게 나오면 해당 태스크 파일을 고치고 별도 커밋.

- [ ] **Step 1: 게이트**

Run: `npm run type-check && npx jest --maxWorkers=2 && (cd apps/admin-web && npx tsc --noEmit) && npm run test:admin-web`
Expected: 전부 0 실패. (`npx jest` 는 OOM 이 나면 `--maxWorkers=2` 그대로.)

- [ ] **Step 2: 통합**

Run: `npm run test:core:integration:local -- order-progress`
Expected: PASS

- [ ] **Step 3: 브라우저 스모크(사람이 로그인)**

로컬 E2E(`npm run start:all:local`) 에서 core 를 1분 이상 띄워 둔 뒤 `/order/stall-board` 를 연다. 확인할 것:
1. 띠에 0~8 + 취소·반품·교환 카드가 있고 «N분 전 판정»이 보인다
2. 매칭 대기 주문이 있으면 2 FO 생성 카드에 갇힘 수가 빨갛게 보인다
3. 카드를 누르면 목록이 바뀌고, 세부 상태 칩·갇힘만·채널·정렬이 동작한다
4. 주문번호를 누르면 주문내역이 그 주문 하나로 열린다
5. 0 수집 카드는 격리 건수를 보이고 «수집 격리 목록으로»가 `/mall/channel-listings` 로 간다
6. core 를 멈추고 5분 넘게 두면 판정 시각이 빨갛게 바뀐다

로그인은 에이전트가 하지 않는다 — 사람에게 요청한다.

- [ ] **Step 4: #1016 갱신**

13번 행의 «해결» 칸에 머지 커밋 해시를 적고 아티팩트를 다시 게시한다(머지 후, 이 계획 밖의 절차 — 메모리 `order-lifecycle-audit-2026-10-05` 의 동기화 절차).
