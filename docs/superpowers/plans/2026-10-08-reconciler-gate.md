# 리컨실러 틀 보강 (재판정 게이트 · act 결과 · 어휘 union) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리컨실러가 투영(최대 1분 늦음)만 믿고 규칙을 부르지 않게 실행 직전에 대상을 다시 판정하고, `act` 가 «할 일이 없었음»을 알릴 수 있게 하며, 규칙의 칸을 TS union 으로 타입 검사한다. #1016 재판정 묶음 §11.6 의 ① 틀 보강 PR.

**Architecture:** 러너가 후보마다 savepoint 안에서 `OrderProgressReader.judge([id])` 를 먼저 부르고, 순수 함수 `stillInSituation` 이 «아직 규칙의 칸인가»를 정한다. 칸 밖이면 규칙을 부르지 않고 `not_needed` 로 센다. `act` 는 `'acted' | 'noop'` 을 돌려주고 `noop` 은 `not_needed` 로 기록한다. 단계별 세부 상태 어휘는 `order-progress.thresholds.ts` 한 곳에 두고, 규칙 작성 계약(`OrderReconcileRule`)은 단계와 세부 상태를 짝으로 검사한다.

**Tech Stack:** NestJS 11, drizzle-orm (postgres.js), Jest (ts-jest, isolatedModules — 타입 검사는 `npm run type-check` 만 한다)

**Spec:** `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` — §4.3·§4.5(기존 틀), §11.2 D12·D13, §11.3, §11.4-3·4, §11.6-1

## Global Constraints

- 마이그 없음. `inventory.schema.ts` 를 고치지 않는다
- 상자 대상(`subject: 'shipment'`)·`shipment_reconcile_state`·판정 SQL 분리(§11.5)·D16 제외 목록은 이 PR 범위 밖 — ③ 25번 PR 몫
- 12번 규칙의 `mode` 는 `'observe'` 그대로 둔다(실행 전환은 ② PR)
- 레이어 규칙: 러너·저장소는 drizzle 를 쓰고, 규칙은 도메인 함수만 부른다(§4.4). 판정 SQL 은 `order-progress.judge-sql.ts` 한 벌뿐이다 — 게이트가 판정을 따로 구현하지 않는다
- `any` 금지, `as` 캐스트는 문서화된 이유가 있을 때만(CLAUDE.md Type Safety)
- 트랜잭션: `this.dbService.run(fn, tx)`, 공개 메서드는 `tx?: DbTx` 를 마지막 인자로(ADR-0025)
- 통합 스펙은 `describeIfDb` 가드를 유지하고 스펙 안에서 `dotenv.config()` 를 부르지 않는다
- 게이트: `npm run type-check` 에러 0 · `npx jest` 실패 0

## 결정 하나 — 게이트에 걸린 후보는 기록하지 않는다

스펙 §11.4-3 은 «칸을 벗어났으면 `not_needed`»라고만 적었다. 이 계획은 **요약 건수는 `not_needed` 로 세되 `order_reconcile_state` 행은 쓰지 않는다.**

이유: 게이트에 걸리는 건 투영이 늦은 후보다. 가장 흔한 경우가 «방금 `act` 로 깨운 backlog 가 아직 `pending` 인데 투영은 `awaiting_matching`»이다.
여기서 `not_needed` 를 기록하면 `lastResult` 가 `acted` → `not_needed` 로 덮여 떠남 유예(`DEPARTURE_GRACE_MIN`, 저장소 `deleteDeparted`)가 풀리고,
다음 바퀴에 투영이 `pending` 을 잡는 순간 행이 지워져 횟수가 0 으로 돌아간다. 그러면 «깨움 → 워커가 되돌림» 반복이 포기에 닿지 못한다(§4.5 리셋 첫 줄이 막으려던 것).
쓰지 않으면 행이 그대로라 유예가 지켜지고, 투영은 1분 안에 따라잡으므로 같은 후보가 게이트를 두 번 넘게 두드리지 않는다.

같은 구멍은 지금 `check` 가 false 일 때도 있다(투영이 늦은 경우 check 도 false). 게이트가 check 보다 먼저 걸러 주므로 이 PR 로 그 경로도 함께 막힌다.
Task 5 가 스펙 §11.4-3 에 이 문장을 더한다.

## Review Focus

1. **깨운 직후 투영이 늦은 후보** — 막 `acted` 한 행(1분 전, 횟수 2)이 다시 후보로 왔는데 지금 판정은 `fo/pending`: 규칙을 부르지 않고 행을 그대로 둔다(`acted`, 횟수 2). Task 4 Step 1 의 첫 테스트
2. **셀메이트로 막 출고된 주문** — 투영은 `fo/awaiting_matching`, 판매주문은 이미 `shipped`, 매칭은 다 됨(check 는 true 가 될 상태): 실행 모드여도 backlog 가 `awaiting_matching` 그대로. Task 4 Step 6
3. **포기한 주문에서 `act` 가 `noop`** — 포기 표시(`gaveUpAt`)와 횟수 5 를 지키고 10분 뒤 다시 본다. Task 3 Step 1 의 두 번째 테스트
4. **관찰 모드도 게이트를 지난다** — 칸 밖 후보에 `would_act` 를 남기지 않는다(②에서 관찰 기록을 믿으려면 필요). Task 4 Step 1 의 둘째 테스트
5. **판정 SQL 자체가 던짐** — 다른 예외와 같이 `error` 로 한 번 세고, 지문을 못 구했으니 빈 지문으로 남긴다. 규칙의 `fingerprint` 는 부르지 않는다. Task 4 Step 1 의 셋째 테스트

---

## File Structure

| 파일 | 변경 | 책임 |
| --- | --- | --- |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` | 수정 | 단계별 세부 상태 어휘 `ORDER_PROGRESS_STATES` 와 타입 |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts` | 수정 | 어휘가 판정 SQL 이 실제로 내는 값인지 지킴 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts` | 수정 | 규칙 계약(좁은 칸 타입) · 틀이 다루는 넓은 모양 · `act` 결과 타입 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.ts` | 생성 | 게이트 판단 순수 함수 `stillInSituation` |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts` | 생성 | 게이트 판단 + 칸 타입의 컴파일 검사 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts` | 수정 | 게이트 호출, `noop` → `not_needed` |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts` | 수정 | `OrderProgressModule` import |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts` | 수정 | 칸 타입 주석, `act` 결과 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts` | 수정 | 판정 흉내, 새 시나리오 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts` | 수정 | 실제 판정으로 끝까지, 늦은 투영 시나리오 |
| `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` | 수정 | §11.4-3 에 «기록하지 않는다» 한 문장 |

저장소(`order-reconcile.repository.ts`)·상태 전이(`order-reconcile.state.ts`)는 고치지 않는다. `ReconcileRuleRef` 의 이름은 그대로이고 정의만 넓은 모양을 가리킨다(Task 2).

## 통합 스펙 실행법 (Task 3·4·6 공통)

CI 에서는 core 통합 스펙이 돌지 않는다(#1033). 로컬에서 돌린다:

```bash
COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- order-reconcile
```

러너가 마이그 단계에서 아무 출력 없이 멈추면(10-08 #1030 때 실측) 임시 DB 로 돌린다:

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -c 'DROP DATABASE IF EXISTS core_gate_it' -c 'CREATE DATABASE core_gate_it'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_gate_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_gate_it npx jest --runInBand --runTestsByPath \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts
```

(`apps/core/drizzle.config.ts` 가 `apps/core/.env` 를 읽으므로 셸의 `DATABASE_URL` 이 이기는지 첫 실행 때 확인한다 — `core_gate_it` 에 `__drizzle_migrations` 행이 생겼으면 된다.)

---

### Task 1: 단계별 세부 상태 어휘

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` (끝에 추가)
- Test: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ORDER_PROGRESS_STATES: { readonly [S in OrderProgressStage]: readonly string[] }` (`as const`, 값은 리터럴 튜플)
  - `type OrderProgressStateOf<S extends OrderProgressStage> = (typeof ORDER_PROGRESS_STATES)[S][number]`
  - `type OrderProgressState = OrderProgressStateOf<OrderProgressStage>`

판정 SQL 이 세부 상태를 만드는 두 방식(`order-progress.judge-sql.ts`):
- **리터럴** — `'no_backlog'`, `'awaiting_plan'`, `'awaiting_dispatch'` 처럼 SQL 본문에 따옴표로 적힌 값
- **원천 값 통과** — backlog 상태(`fo`), 활성 송장 상태(`waybill`), 작업 항목 상태(`pick`), 상자 상태(`track`), `'drop_ship_' || 직배 상태`, `'return:' || 반품 상태` 처럼 원천 enum 값을 그대로(또는 접두어를 붙여) 낸다

`recovery_code` 는 varchar 라 닫힌 집합이 아니다. 어휘는 «규칙이 겨눌 수 있는 값»이고, SQL 이 직접 다루는 두 코드(`CANCEL_REPLAN_PENDING`·`CONSOLIDATION_PENDING`)만 넣는다. 다른 코드를 겨눌 규칙이 생기면 그때 더한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`order-progress.thresholds.spec.ts` 의 맨 위 import 를 아래로 바꾸고, 파일 끝에 `describe` 를 더한다.

```ts
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  directShipStatusEnum,
  exchangeRequestStatusEnum,
  fulfillmentOrderCreationBacklogStatusEnum,
  outboundBatchWorkItemStatusEnum,
  returnRequestStatusEnum,
  shipmentStatusEnum,
  waybillStatusEnum,
} from '../../inventory/schema/inventory.schema';
import { judgedRowsSql } from './order-progress.judge-sql';
import {
  ORDER_PROGRESS_STAGES,
  ORDER_PROGRESS_STATES,
  OrderProgressStage,
  STUCK_AFTER_MS,
  isStuck,
  stuckCutoff,
} from './order-progress.thresholds';
```

```ts
describe('ORDER_PROGRESS_STATES', () => {
  // 판정 SQL 의 본문. 리터럴 세부 상태는 여기에 따옴표째로 들어 있다
  const judgeText = new PgDialect().sqlToQuery(judgedRowsSql(sql`SELECT NULL::uuid`, '2000-01-01T00:00:00.000Z')).sql;
  const dropShip = directShipStatusEnum.enumValues.map((v) => `drop_ship_${v}`);
  // 판정 SQL 이 원천 값을 그대로(또는 접두어를 붙여) 내는 단계 — 그 단계의 세부 상태는 원천 enum 값이어야 한다
  const passthrough: Partial<Record<OrderProgressStage, readonly string[]>> = {
    fo: fulfillmentOrderCreationBacklogStatusEnum.enumValues,
    waybill: waybillStatusEnum.enumValues,
    pick: outboundBatchWorkItemStatusEnum.enumValues,
    track: [...shipmentStatusEnum.enumValues, ...dropShip],
    dispatch: dropShip,
    return_exchange: [
      ...returnRequestStatusEnum.enumValues.map((v) => `return:${v}`),
      ...exchangeRequestStatusEnum.enumValues.map((v) => `exchange:${v}`),
    ],
  };

  it.each([...ORDER_PROGRESS_STAGES])('%s 의 세부 상태는 판정 SQL 이 실제로 낼 수 있는 값이다', (stage) => {
    const unknown = ORDER_PROGRESS_STATES[stage].filter(
      (state) => !judgeText.includes(`'${state}'`) && !(passthrough[stage] ?? []).includes(state),
    );
    // 오타가 섞이면 그 칸을 겨눈 규칙은 영원히 후보가 없고, deleteDeparted 가 그 규칙의 행을 조용히 지운다
    expect(unknown).toEqual([]);
  });

  it('12번 규칙의 칸(fo/awaiting_matching)이 어휘에 있다', () => {
    expect(ORDER_PROGRESS_STATES.fo).toContain('awaiting_matching');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: FAIL — `ORDER_PROGRESS_STATES` 가 undefined 라 `it.each` 본문에서 `Cannot read properties of undefined`

- [ ] **Step 3: 어휘를 더한다**

`order-progress.thresholds.ts` 의 `isOrderProgressStage` 함수 바로 아래에 더한다.

```ts
/**
 * 단계마다 규칙이 겨눌 수 있는 세부 상태(리컨실러 스펙 2026-10-08 §11.3). 리컨실러 규칙의 칸이 이 어휘로 타입 검사된다 —
 * string[] 이던 때는 오타가 «영원히 후보 없음»이 되고 deleteDeparted 가 그 규칙의 행을 조용히 지웠다.
 * 판정 SQL 은 이 밖의 값도 낸다(그 밖의 recovery_code, 분류 안 된 상자 상태) — 그 칸을 겨눌 규칙이 생길 때 더한다.
 * 값이 판정 SQL 과 어긋나지 않는지는 order-progress.thresholds.spec.ts 가 지킨다.
 */
export const ORDER_PROGRESS_STATES = {
  accept: ['no_backlog'],
  // backlog 상태. completed 는 FO 가 있어 단위로 넘어가고, not_required 는 종료(outcome)라 여기 없다
  fo: ['pending', 'processing', 'awaiting_matching', 'failed'],
  reserve: ['created', 'partially_reserved'],
  plan: ['awaiting_plan'],
  // 활성 송장 상태(종결 voided·failed·abandoned 는 활성이 아니다), 없으면 none
  waybill: ['none', 'pending', 'allocated'],
  pick: [
    'queued',
    'picking',
    'ready_to_pack',
    'packing',
    'withdrawing',
    'short_pick_recovery',
    'awaiting_batch',
    'CONSOLIDATION_PENDING',
  ],
  dispatch: ['awaiting_dispatch', 'drop_ship_pending'],
  track: ['shipped', 'in_transit', 'failed', 'drop_ship_forwarded'],
  cancel_request: ['cancel_requested', 'cancel_edited'],
  // 취소된 주문의 열린 상자·예약. 열린 상자의 recovery_code 가 그대로 나올 수도 있다
  cancel: ['CANCEL_REPLAN_PENDING', 'open_shipment', 'open_reservation'],
  // 열린(완료·거절·취소 아닌) 반품·교환
  return_exchange: [
    'return:requested',
    'return:approved',
    'return:collection_pending',
    'return:collected',
    'return:inspected',
    'return:refund_pending',
    'exchange:requested',
    'exchange:approved',
    'exchange:collection_pending',
    'exchange:collected',
    'exchange:inspected',
    'exchange:refund_pending',
  ],
  unclassified: ['no_units', 'fo_missing'],
} as const satisfies Record<OrderProgressStage, readonly string[]>;
export type OrderProgressStateOf<S extends OrderProgressStage> = (typeof ORDER_PROGRESS_STATES)[S][number];
export type OrderProgressState = OrderProgressStateOf<OrderProgressStage>;
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
Expected: PASS (기존 thresholds 테스트 + 단계 12개 + 1)

가드가 실제로 무는지 한 번 확인한다: `fo` 의 `'awaiting_matching'` 을 `'awaiting_matchin'` 으로 잠깐 바꿔 돌리면 `fo` 케이스가 `['awaiting_matchin']` 으로 FAIL 해야 한다. 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts
git commit -m "feat(core): 정체 보드 단계별 세부 상태 어휘를 TS union 으로 둔다 (#1016 재판정 틀 보강)"
```

---

### Task 2: 규칙 칸 타입과 게이트 판단 순수 함수

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts` (전체 교체)
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts:21`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts:6,40,68,99`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts:7,32-33`

**Interfaces:**
- Consumes: `OrderProgressStage`, `OrderProgressStateOf<S>` (Task 1); `JudgedRow` (`order-progress.reader.ts`, 기존)
- Produces:
  - `type OrderReconcileSituation` — 단계와 그 단계의 세부 상태 짝(판별 유니온)
  - `type ReconcileSituationRef = { readonly stage: OrderProgressStage; readonly states: readonly string[] }`
  - `interface OrderReconcileRule` — `situation: OrderReconcileSituation` (규칙 작성 계약, 레지스트리가 받는 타입)
  - `interface RunnableReconcileRule` — `situation: ReconcileSituationRef` (러너가 받는 타입. `OrderReconcileRule` 은 여기에 대입된다)
  - `type ReconcileRuleRef = Pick<RunnableReconcileRule, 'name' | 'row' | 'situation'>` (이름 유지, 저장소가 쓴다)
  - `function stillInSituation(situation: ReconcileSituationRef, judged: Pick<JudgedRow, 'stage' | 'state' | 'outcome'> | undefined): boolean`

왜 타입이 둘인가: 러너 통합 스펙은 `it_<uuid>` 같은 고유 세부 상태로 실데이터와 격리한다(후보 SQL 은 칸으로만 고르므로 같은 DB 의 다른 행이 섞이지 않게). 좁은 타입만 있으면 그 격리를 `as` 캐스트로만 할 수 있다. 규칙을 쓰는 사람이 닿는 곳(규칙 클래스·레지스트리)은 좁은 타입이라 오타 방지는 그대로다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`order-reconcile.gate.spec.ts`:

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { stillInSituation } from './order-reconcile.gate';
import { OrderReconcileSituation } from './order-reconcile.rule';

type Judged = Pick<JudgedRow, 'stage' | 'state' | 'outcome'>;
const awaiting: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };
const judged = (over: Partial<Judged> = {}): Judged => ({
  stage: 'fo',
  state: 'awaiting_matching',
  outcome: null,
  ...over,
});

describe('stillInSituation — 실행 직전 재판정 게이트(스펙 D12)', () => {
  it('지금 판정이 같은 단계·세부 상태면 통과한다', () => {
    expect(stillInSituation(awaiting, judged())).toBe(true);
  });

  it('칸의 세부 상태가 여럿이면 그중 하나여도 통과한다', () => {
    const either: OrderReconcileSituation = { stage: 'fo', states: ['pending', 'failed'] };
    expect(stillInSituation(either, judged({ state: 'failed' }))).toBe(true);
  });

  it('같은 단계의 다른 세부 상태(막 깨워 pending)면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ state: 'pending' }))).toBe(false);
  });

  it('다음 단계로 넘어갔으면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ stage: 'reserve', state: 'created' }))).toBe(false);
  });

  it('종료(셀메이트 외부 출고)면 막는다 — 투영이 아직 fo 여도', () => {
    expect(stillInSituation(awaiting, judged({ stage: null, state: null, outcome: 'external_shipped' }))).toBe(false);
  });

  it('채널 취소 요청이 끼어들었으면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ stage: 'cancel_request', state: 'cancel_requested' }))).toBe(false);
  });

  it('판정 결과가 없으면(주문이 사라짐) 막는다', () => {
    expect(stillInSituation(awaiting, undefined)).toBe(false);
  });

  it('세부 상태가 null 이면 막는다', () => {
    expect(stillInSituation(awaiting, judged({ state: null }))).toBe(false);
  });
});

describe('OrderReconcileSituation 타입 — npm run type-check 가 검사한다', () => {
  it('단계에 없는 세부 상태·다른 단계의 세부 상태는 컴파일 에러다', () => {
    // @ts-expect-error 오타
    const typo: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matchin'] };
    // @ts-expect-error plan 단계의 세부 상태를 fo 에 붙임
    const crossed: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_plan'] };
    const ok: OrderReconcileSituation = { stage: 'plan', states: ['awaiting_plan'] };
    expect([typo, crossed, ok]).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.gate'`

- [ ] **Step 3: 규칙 계약을 바꾼다**

`order-reconcile.rule.ts` 전체를 아래로 바꾼다(`act` 는 이 태스크에서 `Promise<void>` 그대로다 — Task 3 이 바꾼다).

```ts
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OrderProgressStage, OrderProgressStateOf } from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/** 규칙이 볼 투영의 칸. 단계와 그 단계의 세부 상태가 짝으로 타입 검사된다(스펙 §11.3) */
export type OrderReconcileSituation = {
  [S in OrderProgressStage]: { readonly stage: S; readonly states: readonly OrderProgressStateOf<S>[] };
}[OrderProgressStage];

/**
 * 틀(러너·저장소)이 다루는 칸. 세부 상태가 넓은 string 인 것은 통합 스펙이 고유 상태값으로 실데이터와 격리하기
 * 위해서다 — 규칙을 쓰는 계약은 OrderReconcileRule 의 좁은 타입이고 레지스트리는 그것만 받는다.
 */
export type ReconcileSituationRef = { readonly stage: OrderProgressStage; readonly states: readonly string[] };

interface ReconcileRuleBody {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(salesOrderId: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(salesOrderId: string, tx: DbTx): Promise<boolean>;
  act(salesOrderId: string, tx: DbTx): Promise<void>;
}

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4·§11.3). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 투영에서 고르고,
 * 실행 직전에 틀이 지금 판정으로 칸을 다시 확인한다(D12). check 는 도메인이 쓰는 판정 함수를 그대로 쓰고,
 * act 는 도메인 함수만 부른다. 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule extends ReconcileRuleBody {
  readonly situation: OrderReconcileSituation;
}

/** 러너가 받는 모양. OrderReconcileRule 은 그대로 대입된다 */
export interface RunnableReconcileRule extends ReconcileRuleBody {
  readonly situation: ReconcileSituationRef;
}

export type ReconcileRuleRef = Pick<RunnableReconcileRule, 'name' | 'row' | 'situation'>;
```

- [ ] **Step 4: 게이트 판단을 만든다**

`order-reconcile.gate.ts`:

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.ts
import { JudgedRow } from '../order-progress/order-progress.reader';
import { ReconcileSituationRef } from './order-reconcile.rule';

/**
 * 실행 직전 재판정 게이트의 판단(스펙 D12·§11.4-3). 투영은 최대 1분 늦다 — 후보로 고른 뒤 지금 판정이 규칙의 칸을
 * 벗어났으면(외부 출고·채널 취소 요청·반품으로 넘어갔거나 이미 다음 단계) 규칙을 부르지 않는다.
 * 판정 SQL 의 우선순위를 규칙의 check 가 다시 구현하지 않아도 되게 하는 것이 목적이다.
 */
export function stillInSituation(
  situation: ReconcileSituationRef,
  judged: Pick<JudgedRow, 'stage' | 'state' | 'outcome'> | undefined,
): boolean {
  if (!judged || judged.outcome !== null) return false;
  if (judged.stage !== situation.stage || judged.state === null) return false;
  return situation.states.includes(judged.state);
}
```

- [ ] **Step 5: 12번 규칙·러너·러너 스펙을 새 타입에 맞춘다**

`rules/wake-awaiting-matching.rule.ts` — import 에 `OrderReconcileSituation` 을 더하고 21번 줄을 바꾼다:

```ts
import { OrderReconcileRule, OrderReconcileSituation } from '../order-reconcile.rule';
```

```ts
  readonly situation: OrderReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };
```

`order-reconcile.runner.ts` — `OrderReconcileRule` 을 `RunnableReconcileRule` 로 바꾼다(import, 생성자의 `rules` 타입, `runRule`·`reconcileOne` 의 `rule` 인자 타입 세 곳):

```ts
import { ORDER_RECONCILE_RULES, RunnableReconcileRule } from './order-reconcile.rule';
```

```ts
    @Inject(ORDER_RECONCILE_RULES) private readonly rules: RunnableReconcileRule[],
```

```ts
  async runRule(rule: RunnableReconcileRule, now: Date, tx?: DbTx): Promise<RuleRunSummary> {
```

```ts
  private async reconcileOne(
    rule: RunnableReconcileRule,
```

`order-reconcile.runner.integration.spec.ts` — 고유 세부 상태 격리를 유지하려고 넓은 타입을 쓴다:

```ts
import { RunnableReconcileRule } from './order-reconcile.rule';
```

```ts
function fakeRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<void>) {
  const rule: RunnableReconcileRule = {
```

같은 파일의 `runTimes` 인자 타입 `rule: OrderReconcileRule` 도 `rule: RunnableReconcileRule` 로 바꾼다.

- [ ] **Step 6: 통과를 확인한다**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts`
Expected: PASS (9 tests)

Run: `npm run type-check`
Expected: 에러 0. `@ts-expect-error` 두 줄이 «사용되지 않음»으로 에러가 나면 칸 타입이 좁혀지지 않은 것이다 — Step 3 의 매핑 타입을 다시 본다.

- [ ] **Step 7: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "feat(core): 리컨실러 규칙의 칸을 단계별 세부 상태로 타입 검사하고 게이트 판단을 순수 함수로 둔다 (#1016)"
```

---

### Task 3: `act` 가 `'acted' | 'noop'` 을 돌려준다 (D13)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts:114-115`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts:61-63`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts:60-71`

**Interfaces:**
- Consumes: `RunnableReconcileRule` (Task 2); `FulfillmentOrderCreationBacklogService.requeueAwaitingMatching(salesOrderId: string, tx?: DbTx): Promise<number>` (기존 — 깨운 행 수. 정비 모드면 0)
- Produces: `type ReconcileActResult = 'acted' | 'noop'`; `act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

러너 통합 스펙에서 `fakeRule` 의 `act` 인자 타입을 결과를 돌려주게 바꾸고, 기존 호출부를 맞춘다:

```ts
import { ReconcileActResult, RunnableReconcileRule } from './order-reconcile.rule';
```

```ts
function fakeRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<ReconcileActResult>) {
```

기존 호출부 고치기 — `async () => undefined` 는 전부 `async () => 'acted'` 로, 둘째 테스트의 act 는:

```ts
      const rule = fakeRule(state, 'act', async (id) => {
        if (id === bad) throw new Error('boom');
        return 'acted';
      });
```

`describeIfDb` 블록 끝(마지막 `it` 뒤)에 두 테스트를 더한다:

```ts
  it('act 가 noop 이면(사람이 먼저 처리) not_needed 로 남기고 횟수를 올리지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'noop');
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.act).toHaveBeenCalledTimes(1);
      expect(summary).toMatchObject({ acted: 0, notNeeded: 1 });
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'not_needed', attempts: 0 });
    });
  });

  it('포기한 주문에서 act 가 noop 이면 포기 표시와 횟수를 지키고 10분 뒤 다시 본다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const repo = new OrderReconcileRepository(dbs);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'noop');
      const gaveUpAt = new Date('2099-05-31T00:00:00.000Z');
      await repo.save(
        rule,
        id,
        { fingerprint: 'fp', mode: 'act', attempts: 5, lastResult: 'acted', lastError: null, gaveUpAt, nextCheckAt: NOW },
        gaveUpAt,
        tx,
      );
      const runner = new OrderReconcileRunner(dbs, repo, [rule]);

      await runner.runRule(rule, NOW, tx);

      expect(rule.act).toHaveBeenCalledTimes(1);
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({
        lastResult: 'not_needed',
        attempts: 5,
        gaveUpAt,
        nextCheckAt: new Date('2099-06-01T00:10:00.000Z'),
      });
    });
  });
```

12번 규칙 통합 스펙 — 첫 테스트(60~71줄)의 `await rule.act(o.salesOrderId, tx);` 를 아래 두 줄로 바꾼다:

```ts
      expect(await rule.act(o.salesOrderId, tx)).toBe('acted');
      // 이미 pending 이라 CAS 가 진다 — 할 일이 없었음을 알린다
      expect(await rule.act(o.salesOrderId, tx)).toBe('noop');
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run type-check`
Expected: FAIL — `Module '"./order-reconcile.rule"' has no exported member 'ReconcileActResult'`

Run: 통합 스펙(위 «통합 스펙 실행법»)
Expected: 새 두 테스트 FAIL — `acted: 1` 로 기록됨(지금 러너는 act 결과를 보지 않는다), 12번 규칙 테스트는 `undefined` 를 받아 FAIL

- [ ] **Step 3: 계약·러너·12번 규칙을 바꾼다**

`order-reconcile.rule.ts` — `ReconcileRuleBody` 위에 타입을 더하고 `act` 시그니처를 바꾼다:

```ts
/** act 의 결과. 'noop' = 할 일이 없었다(사람이 먼저 처리했거나 CAS 에서 짐) — not_needed 로 기록되고 횟수를 올리지 않는다(D13) */
export type ReconcileActResult = 'acted' | 'noop';
```

```ts
  act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult>;
```

`order-reconcile.runner.ts` 114~115줄을 바꾼다:

```ts
            let step = chooseStep(eff, rule.mode, await rule.check(salesOrderId, sp));
            // 할 일이 없었으면 시도가 아니다 — acted 로 세면 사람이 먼저 처리한 주문이 포기로 간다(D13)
            if (step === 'act' && (await rule.act(salesOrderId, sp)) === 'noop') step = 'not_needed';
```

`rules/wake-awaiting-matching.rule.ts` — import 에 `ReconcileActResult` 를 더하고 `act` 를 바꾼다:

```ts
import { OrderReconcileRule, OrderReconcileSituation, ReconcileActResult } from '../order-reconcile.rule';
```

```ts
  /** CAS 가 진 경우(그새 다른 경로가 깨움)는 noop — 시도로 세지 않는다 */
  async act(salesOrderId: string, tx: DbTx): Promise<ReconcileActResult> {
    return (await this.backlog.requeueAwaitingMatching(salesOrderId, tx)) > 0 ? 'acted' : 'noop';
  }
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm run type-check`
Expected: 에러 0

Run: 통합 스펙(위 «통합 스펙 실행법»)
Expected: PASS — 러너 스펙 기존 10 + 새 2, 12번 규칙 스펙 전부

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile`
Expected: PASS (유닛만 돈다 — 통합은 `DATABASE_URL` 없이 skip)

- [ ] **Step 5: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "feat(core): 리컨실러 act 가 acted·noop 을 돌려주고 noop 은 not_needed 로 기록한다 (#1016 D13)"
```

---

### Task 4: 러너의 실행 직전 재판정 게이트 (D12)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
- Test: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`

**Interfaces:**
- Consumes: `stillInSituation` (Task 2); `OrderProgressReader.judge(salesOrderIds: string[], now: Date, tx?: DbTx): Promise<JudgedRow[]>` (기존, `OrderProgressModule` 이 export)
- Produces: 러너 생성자 `new OrderReconcileRunner(dbService, repository, progress: Pick<OrderProgressReader, 'judge'>, rules: RunnableReconcileRule[])` — 세 번째 인자가 새로 들어간다

게이트는 savepoint 안에서 `fingerprint` 전에 돈다. 칸 밖이면 `not_needed` 로 세고 **행을 쓰지 않는다**(위 «결정 하나»). 판정이 던지면 기존 catch 가 잡아 `error` 로 한 번 센다 — 지문을 못 구했으므로 이전 지문(처음이면 빈 문자열)으로 남는다.

- [ ] **Step 1: 실패하는 러너 테스트를 쓴다**

러너 통합 스펙 import 에 더한다:

```ts
import { OrderProgressOutcome, OrderProgressStage } from '../order-progress/order-progress.thresholds';
```

`fakeRule` 함수 아래에 판정 흉내를 더한다:

```ts
/** 지금 판정을 흉내 낸다. 투영 행만 심은 주문은 실제 판정이 accept 라 게이트를 못 지난다 — 게이트 밖의 틀 동작을 볼 때 칸과 같게 둔다 */
function judgeAs(stage: OrderProgressStage | null, state: string | null, outcome: OrderProgressOutcome | null = null) {
  return {
    judge: jest.fn(async (ids: string[]) =>
      ids.map((salesOrderId) => ({
        salesOrderId,
        salesChannel: 'medusa',
        stage,
        state,
        outcome,
        estimatedEnteredAt: '2000-01-01T00:00:00.000Z',
      })),
    ),
  };
}
```

기존 테스트의 러너 생성을 전부 세 번째 인자를 넣게 바꾼다 — `new OrderReconcileRunner(dbs, <저장소>, [rule])` 를 `new OrderReconcileRunner(dbs, <저장소>, judgeAs('fo', state), [rule])` 로(Task 3 에서 더한 두 테스트 포함, 파일 안 모든 곳).

`describeIfDb` 블록 끝에 세 테스트를 더한다:

```ts
  it('게이트: 지금 판정이 칸을 벗어났으면 규칙을 부르지 않고 not_needed 로 세며, 막 act 한 기록을 덮지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const repo = new OrderReconcileRepository(dbs);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
      const actedAt = new Date('2099-05-31T23:59:00.000Z');
      await repo.save(
        rule,
        id,
        { fingerprint: 'fp', mode: 'act', attempts: 2, lastResult: 'acted', lastError: null, gaveUpAt: null, nextCheckAt: NOW },
        actedAt,
        tx,
      );
      // 깨운 backlog 가 아직 pending — 투영만 늦게 옛 칸을 보여 준다
      const runner = new OrderReconcileRunner(dbs, repo, judgeAs('fo', 'pending'), [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(summary).toMatchObject({ acted: 0, notNeeded: 1 });
      expect(rule.fingerprint).not.toHaveBeenCalled();
      expect(rule.check).not.toHaveBeenCalled();
      expect(rule.act).not.toHaveBeenCalled();
      // 덮으면 떠남 유예가 풀려 다음 바퀴에 행이 지워지고 «깨움→되돌아옴» 횟수가 리셋된다
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({ lastResult: 'acted', attempts: 2, updatedAt: actedAt });
    });
  });

  it('게이트: 관찰 모드도 칸 밖 후보에는 would_act 를 남기지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'observe', async () => 'acted');
      const runner = new OrderReconcileRunner(
        dbs,
        new OrderReconcileRepository(dbs),
        judgeAs(null, null, 'external_shipped'),
        [rule],
      );

      const summary = await runner.runRule(rule, NOW, tx);

      expect(summary).toMatchObject({ wouldAct: 0, notNeeded: 1 });
      expect((await statesOf(tx, rule.name)).get(id)).toBeUndefined();
    });
  });

  it('게이트: 판정이 던지면 error 로 한 번 세고, 지문을 못 구했으니 빈 지문으로 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedProgress(tx, { stage: 'fo', state });
      const rule = fakeRule(state, 'act', async () => 'acted');
      const failing = {
        judge: jest.fn(async () => {
          throw new Error('judge boom');
        }),
      };
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), failing, [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(summary.errors).toBe(1);
      expect(rule.fingerprint).not.toHaveBeenCalled();
      expect((await statesOf(tx, rule.name)).get(id)).toMatchObject({
        fingerprint: '',
        attempts: 1,
        lastResult: 'error',
        lastError: 'judge boom',
      });
    });
  });
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm run type-check`
Expected: FAIL — `Expected 3 arguments, but got 4` (러너 생성자)

- [ ] **Step 3: 러너에 게이트를 넣는다**

`order-reconcile.runner.ts` import 에 더한다:

```ts
import { OrderProgressReader } from '../order-progress/order-progress.reader';
import { stillInSituation } from './order-reconcile.gate';
```

생성자를 바꾼다:

```ts
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly repository: OrderReconcileRepository,
    // 실행 직전 재판정(D12)에 judge 만 쓴다. 통합 스펙이 판정을 흉내 낼 수 있게 좁힌 타입으로 받는다 —
    // 타입 별칭은 DI 메타데이터가 Object 가 되므로 토큰을 명시한다
    @Inject(OrderProgressReader) private readonly progress: Pick<OrderProgressReader, 'judge'>,
    @Inject(ORDER_RECONCILE_RULES) private readonly rules: RunnableReconcileRule[],
  ) {}
```

`reconcileOne` 의 savepoint 본문 맨 앞(`const fingerprint = …` 위)에 더한다:

```ts
            // 투영은 최대 1분 늦다 — 지금 판정이 칸을 벗어났으면 규칙을 부르지 않는다(D12).
            // 기록도 쓰지 않는다: 막 act 한 행을 not_needed 로 덮으면 떠남 유예가 풀려, 깨운 backlog 가 pending 인 순간을
            // 투영이 잡을 때 행이 지워지고 «깨움→되돌아옴» 반복이 포기에 닿지 못한다. 투영은 1분 안에 따라잡는다
            const [judged] = await this.progress.judge([salesOrderId], now, sp);
            if (!stillInSituation(rule.situation, judged)) return 'not_needed';
```

`order-reconcile.module.ts` — `OrderProgressModule` 을 import 한다:

```ts
import { OrderProgressModule } from '../order-progress/order-progress.module';
```

```ts
  imports: [FulfillmentOrderCreationBacklogModule, ProductMatchingModule, OrderProgressModule],
```

- [ ] **Step 4: 12번 규칙 통합 스펙을 실제 판정으로 잇는다**

import 에 더한다:

```ts
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
```

마지막 테스트(«투영 → 러너 → 규칙 끝까지»)의 러너 생성을 실제 판정으로 바꾼다:

```ts
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new OrderProgressReader(dbs), [rule]);
```

- [ ] **Step 5: 통과를 확인한다 (러너)**

Run: `npm run type-check`
Expected: 에러 0

Run: 통합 스펙(위 «통합 스펙 실행법»)
Expected: PASS — 러너 스펙 기존 12 + 새 3, 12번 규칙 스펙의 «끝까지» 테스트가 실제 판정(`fo/awaiting_matching`)으로 게이트를 지나 관찰→실행이 그대로 동작

- [ ] **Step 6: 늦은 투영 + 셀메이트 출고 시나리오를 더한다 (Review Focus 2)**

12번 규칙 통합 스펙 `describeIfDb` 블록 끝에 더한다:

```ts
  it('게이트: 투영 뒤 판매주문이 셀메이트로 출고되면 실행 모드여도 깨우지 않는다 — check 만으로는 true 였을 상태', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w } = wire();
      const world = await f.seedWorld(tx);
      const o = await seedAwaiting(tx);
      await seedMatching(tx, { variantId: o.variantId, skuId: world.skuId });
      const now = new Date('2099-06-01T00:00:00.000Z');
      await new OrderProgressManager(dbs).refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
      // 투영은 fo/awaiting_matching 인 채로, 원천만 외부 출고로 바뀐다(셀메이트 스크립트)
      await tx.update(wmsTables.salesOrders).set({ status: 'shipped' }).where(eq(wmsTables.salesOrders.id, o.salesOrderId));
      class ActingRule extends WakeAwaitingMatchingRule {
        readonly mode: ReconcileMode = 'act';
      }
      const acting = new ActingRule(w.backlog, gate('v2'), w.productSkuMapping);
      expect(await acting.check(o.salesOrderId, tx)).toBe(true);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new OrderProgressReader(dbs), [acting]);

      await runner.runRule(acting, now, tx);

      expect(await backlogStatus(tx, o.salesOrderId)).toBe('awaiting_matching');
      const rows = await tx
        .select()
        .from(wmsTables.orderReconcileState)
        .where(eq(wmsTables.orderReconcileState.salesOrderId, o.salesOrderId));
      expect(rows).toEqual([]);
    });
  });
```

`acting.check` 를 먼저 단언하는 이유: 이 테스트가 게이트 덕에 통과한다는 것을 보이려면 «게이트가 없었으면 깨웠을 상태»여야 한다.

- [ ] **Step 7: 통과를 확인한다 (12번)**

Run: 통합 스펙(위 «통합 스펙 실행법»)
Expected: PASS. 게이트가 무는지 한 번 확인한다 — Step 3 의 `if (!stillInSituation(…)) return 'not_needed';` 를 잠깐 주석 처리하면 이 테스트가 `'pending'` 으로 FAIL 해야 한다. 되돌린다.

- [ ] **Step 8: 커밋**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "feat(core): 리컨실러가 실행 직전 judge 로 대상을 다시 판정해 칸 밖이면 not_needed 로 넘긴다 (#1016 D12)"
```

---

### Task 5: 스펙 문장 맞추기와 전체 게이트

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` (§11.4-3)

**Interfaces:**
- Consumes: Task 1~4 전부
- Produces: 없음

- [ ] **Step 1: 스펙 §11.4-3 에 «기록하지 않는다»를 더한다**

§11.4 의 3번 항목 끝 문장 «게이트의 «칸 안인가» 판단은 순수 함수로 떼어 유닛 테스트한다» 뒤에 이어 쓴다:

```markdown
   칸 밖이면 바퀴 요약에는 `not_needed` 로 세되 **상태 행은 쓰지 않는다** — 막 `act` 한 행을 `not_needed` 로 덮으면 떠남 유예
   (`DEPARTURE_GRACE_MIN`)가 풀려 «깨움→되돌아옴» 횟수가 리셋된다. 투영은 1분 안에 따라잡으므로 같은 후보가 오래 머물지 않는다
```

- [ ] **Step 2: 전체 게이트를 돌린다**

Run: `npm run type-check`
Expected: 에러 0

Run: `npx jest`
Expected: 실패 0 (출력 끝의 `Tests:` 줄 숫자를 그대로 적는다)

Run: 통합 스펙 — 리컨실러 둘 + 판정 SQL 스펙(어휘가 기대는 판정이 그대로인지):

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_gate_it npx jest --runInBand --runTestsByPath \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts
```

Expected: PASS (임시 DB 를 쓰지 않았다면 `core` 로)

- [ ] **Step 3: 커밋**

```bash
git add docs/superpowers/specs/2026-10-08-order-reconciler-design.md
git commit -m "docs: 리컨실러 게이트에 걸린 후보는 상태 행을 쓰지 않는다 (#1016 §11.4-3)"
```

---

## 배포 메모 (PR 본문에 옮긴다)

- 마이그 없음. core 만 바뀐다 — admin-web·응답 shape 변화 없음
- 12번 규칙은 관찰 모드 그대로. 배포 뒤 라이브에서 볼 것: 바퀴 로그의 `not_needed` 가 늘 수 있다(게이트가 거른 후보). `would_act` 는 게이트를 지난 것만 남는다 — ② 실행 전환 PR 의 관찰 근거가 이 배포 뒤부터 깨끗해진다
- 후보 하나마다 판정 SQL 이 한 번 더 돈다(규칙당 주기마다 최대 50번, 주문 하나 범위). 라이브 12번 후보는 10-08 기준 6건이다
