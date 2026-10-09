# 리컨실러 25번 — 상자 대상 + 대기 중 합포장 재개 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리컨실러가 «상자»를 재판정 대상으로 받게 틀을 넓히고(판정 SQL 분리·`shipment_reconcile_state`·보드 배지), 첫 상자 규칙으로 #1016 25번 — 송장 때문에 `CONSOLIDATION_PENDING` 으로 멈춘 합포장을 막힘이 풀린 뒤 재개하는 규칙 — 을 **관찰 모드**로 올린다. 스펙 §11.6 의 ③.

**Architecture:** 판정 SQL 의 `units` 에 `shipment_id` 를 실어 «상자별 결과»(`judgedShipmentsSql`)를 꺼내고, 기존 «주문으로 접기»(`judgedRowsSql`)는 같은 CTE 를 읽는다. 러너는 규칙의 `subject` 로 대상 종류별 포트(후보·떠남·지금 판정·기록 테이블)를 고르고, 상자 규칙끼리는 바퀴마다 상자별 판정을 한 번만 돌린다. 25번 규칙은 `ConsolidationService` 가 `resumePending` 에서 쓰는 막힘 판정(`collectBlockers`)을 그대로 읽어 `check` 하고, `act` 는 `resumePending` 을 부른다.

**Tech Stack:** NestJS 11, drizzle-orm (postgres.js), drizzle-kit migrate, Jest (ts-jest, isolatedModules — 타입 검사는 `npm run type-check` 만 한다)

**Spec:** `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` — §4(틀), §11 전체(D11~D20). 25번 규칙 자체(지문·check·act)는 스펙에 없어 이 계획이 정하고 Task 9 가 스펙 §11.8 로 옮긴다.

## Global Constraints

- 마이그 1건, additive: `shipment_reconcile_state` 테이블 + FK + 부분 인덱스. 배포는 **`db:migrate` → `sst deploy`**(새 코드가 보드 요약에서 이 테이블을 읽는다 — 먼저 배포하면 정체 보드 API 500)
- 마이그 생성: `npm run db:generate:core -- --name add-shipment-reconcile-state`. `inventory.schema.ts` + `apps/core/drizzle/<ts>_add-shipment-reconcile-state.sql` + `apps/core/drizzle/meta/` 를 **한 커밋**에. 생성된 SQL 을 손으로 고치지 않는다
- 25번 규칙은 `mode = 'observe'`(D5). 실행 전환은 관찰 뒤 별도 PR
- D16 제외 목록은 고정: 주문 판정 `cancel_request` · `external_shipped` · `return_exchange`. 취소된 주문(`cancel_open`·`cancelled`)은 통과(30번용)
- D19(끝난 주문 칸 `{ outcome: 'delivered' }`)는 구현하지 않는다 — 29번이 연다(스펙 §11.6 마지막 문단)
- 판정 정의는 `order-progress.judge-sql.ts` 한 벌뿐이다. 러너·규칙·저장소가 판정을 다시 구현하지 않는다. «칸 안인가»는 순수 함수 하나(`shipmentInSituation`)가 후보·떠남·게이트 셋 모두에 쓰인다
- 규칙은 후보 SQL 을 쓰지 않는다(§4.4-1). `check` 는 도메인 판정 함수를, `act` 는 도메인 함수만 부른다(§4.4-2·3)
- admin-web 은 고치지 않는다 — 배지 응답 shape(`gaveUp: {rule,row,since,lastError}[]`)가 그대로다(§11.6-3)
- `any` 금지, `as` 캐스트는 문서화된 이유가 있을 때만(CLAUDE.md Type Safety)
- 트랜잭션: `this.dbService.run(fn, tx)`, 공개 메서드는 `tx?: DbTx` 마지막 인자(ADR-0025). per-class `inTx` 금지
- 통합 스펙은 `describeIfDb` 가드, 스펙 안에서 `dotenv.config()` 금지
- 게이트: `npm run type-check` 에러 0 · `npx jest --maxWorkers=2` 실패 0(기본 워커 수는 OOM 137) · 통합 스펙은 임시 DB 에서 `--runInBand`
- 브랜치: `origin/develop` 기반 `feat/1016-row25-consolidation-reconcile`

### 통합 스펙 실행법 (모든 태스크 공통)

`npm run test:core:integration:local` 은 migrate 단계에서 조용히 멈춘다. 임시 DB 를 쓴다(로컬 postgres 컨테이너가 떠 있어야 한다 — `npm run bootstrap:e2e:local`):

```bash
docker exec almondyoung-server-postgres-1 psql -U postgres -c 'DROP DATABASE IF EXISTS core_row25_it' -c 'CREATE DATABASE core_row25_it'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_row25_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_row25_it npx jest --runInBand --runTestsByPath <스펙 경로들>
```

`apps/core/drizzle.config.ts` 가 `apps/core/.env` 를 읽으므로 셸의 `DATABASE_URL` 이 이기는지 첫 실행 때 확인한다 — `core_row25_it` 에 `__drizzle_migrations` 행이 생겼으면 된다. Task 4 에서 마이그를 더한 뒤에는 위 세 줄을 다시 돌린다.

## 계획이 스펙에서 한 걸음 더 간 결정 (Task 9 가 스펙에 옮긴다)

1. **상자 판정의 범위는 «진행 중 주문 + 그 주문과 상자를 나눈 주문»이다.** 스펙 §11.4-1 은 «진행 중 주문 범위»라고만 적었다. 그대로 두면 합포장 상자를 나눈 주문 중 셀메이트로 출고된(`external_shipped`, 투영에서 종료) 주문이 범위 밖이라 판정 SQL 에 안 나오고, D16 제외가 조용히 빠진다. 범위를 상자 공유로 닫는다(`openShipmentScopeSql`).
2. **25번 `check` 는 원본 상자 «전부»가 칸 안(D16 제외 아님)인지 본다.** `resumePending` 은 작업의 원본 상자 전부를 한꺼번에 바꾼다. 틀의 게이트는 후보 상자 하나만 보므로, 원본 A 의 주문은 멀쩡하고 원본 B 의 주문이 셀메이트로 출고됐으면 A 를 후보로 B 까지 합포장해 버린다(§1.3 의 유령 예약과 같은 꼴). 규칙이 형제 원본마다 같은 순수 함수(`shipmentInSituation`)와 같은 판정(`judgeShipment`)을 부른다 — 판정을 다시 구현하는 게 아니다.
3. **저장소는 종류별 클래스 둘**(`OrderReconcileRepository` 그대로 + `ShipmentReconcileRepository`). 스펙 D17 의 «저장소가 종류별 테이블을 고른다»를 러너의 포트 선택으로 구현한다. drizzle 타입이 테이블마다 달라 한 클래스 안의 분기는 같은 코드 두 벌이 된다.
4. **`shipment_reconcile_state` 에는 `(rule, next_check_at)` 인덱스를 두지 않는다.** 상자 후보는 판정 결과에서 고른 id 로 `(rule, shipment_id)` PK 를 찾는다 — 그 인덱스를 쓰는 쿼리가 없다.

## Review Focus

1. **형제 원본의 주문이 셀메이트로 출고됨** — 송장은 취소돼 막힘이 없고 A 는 칸 안인데, B 의 판매주문이 `shipped`: 실행 모드여도 합포장하지 않는다(작업은 `pending` 그대로, 대상 상자 0). Task 8 Step 1 의 다섯째 테스트
2. **합포장 상자를 나눈 주문 하나가 `external_shipped`(투영에서 종료)** — 그 상자는 상자 후보가 아니다(범위가 상자 공유로 닫혀 있어야 판정에 나온다). Task 2 Step 1 의 둘째 테스트
3. **형제 상자가 더 뒤처진 주문** — 주문 투영은 `reserve` 인데 다른 상자는 `CONSOLIDATION_PENDING`: 상자 판정에는 그 상자가 그대로 나온다(§11.1 의 «가려짐»). Task 2 Step 1 의 첫째 테스트
4. **같은 작업의 원본 둘이 한 바퀴에 둘 다 후보** — 하나가 재개해 끝내고, 다른 하나는 게이트에서 걸러진다(대상 상자는 1개). Task 8 Step 1 의 넷째 테스트
5. **포기 뒤 운영자가 송장을 취소** — 지문(막힘 목록)이 바뀌어 횟수·포기가 리셋되고 다시 시도한다. Task 8 Step 1 의 첫째 테스트(지문이 바뀜) + 기존 러너 스펙(지문 바뀜 → 리셋)

---

## File Structure

| 파일 | 변경 | 책임 |
| --- | --- | --- |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts` | 수정 | 상자 어휘 `SHIPMENT_STAGES`·`SHIPMENT_STATES` |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts` | 수정 | 상자 어휘 가드 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts` | 수정 | `subject`, 상자 규칙 계약, `ReconcileRule` 유니온 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts` | 수정 | 상자 칸 타입 컴파일 검사 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts` | 수정 | 25번 등록, 타입 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts` | 수정 | 타입, `FulfillmentModule` import |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts` | 수정 | `subject = 'order'` |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts` | 수정 | CTE 분리, `judgedShipmentsSql`, 범위 SQL 둘 |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts` | 수정 | `judgeOpenShipments`·`judgeShipment`, 보드의 상자 배지 |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-shipments.integration.spec.ts` | 생성 | 상자별 판정 |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.ts` | 수정 | `GaveUpBadge`·`groupGaveUpMarks` |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts` | 수정 | 배지 묶기 |
| `apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts` | 수정 | 상자 규칙 배지 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.ts` | 생성 | D16 목록 · `shipmentInSituation` · `inSituationShipmentIds` |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts` | 생성 | 위 순수 함수 + D16 리터럴 가드 |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` | 수정 | `shipmentReconcileState` |
| `apps/core/drizzle/<ts>_add-shipment-reconcile-state.sql`, `apps/core/drizzle/meta/*` | 생성 | 마이그 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts` | 수정 | `toReconcilePrior` export |
| `apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.ts` | 생성 | 상자 상태 저장소 |
| `apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.integration.spec.ts` | 생성 | 저장소 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts` | 수정 | 대상 종류별 포트, 상자 판정 공유 |
| `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts` | 수정 | 상자 시나리오, 생성자 인자 |
| `apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service.ts` | 수정 | `allowsOperationalMutations()` |
| `apps/core/src/modules/fulfillment/services/consolidation.service.ts` | 수정 | `findPendingOperationIdForSource`·`resumeReadiness`·`tryResumePending` |
| `apps/core/src/modules/fulfillment/services/__support__/consolidation-fixtures.ts` | 생성 | 합포장 스펙 픽스처(기존 스펙에서 옮김) |
| `apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts` | 수정 | 픽스처 import, 새 도메인 함수 |
| `apps/core/src/modules/fulfillment/fulfillment.module.ts` | 수정 | `ConsolidationService` export |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.ts` | 생성 | 25번 규칙 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.spec.ts` | 생성 | 지문 순수 함수 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.integration.spec.ts` | 생성 | 규칙 + 끝-끝 |
| `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts` | 수정 | 러너 생성자 인자 |
| `docs/superpowers/specs/2026-10-08-order-reconciler-design.md` | 수정 | §11.8 25번, 위 «한 걸음 더 간 결정» |

---

### Task 1: 상자 어휘와 규칙 계약

규칙이 «무엇을 대상으로 하는가»를 선언하게 한다. 동작은 바뀌지 않는다(러너는 아직 `subject` 를 읽지 않는다).

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.rule.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.gate.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts` (`fakeRule` 에 `subject`)

**Interfaces:**
- Produces: `SHIPMENT_STAGES`, `ShipmentStage`, `SHIPMENT_STATES`, `ShipmentStateOf<S>` (thresholds) · `ReconcileSubject`, `ShipmentReconcileSituation`, `ShipmentReconcileRule`, `ReconcileRule`, `RunnableReconcileRule.subject` (rule.ts)

- [ ] **Step 1: 실패하는 테스트 — 상자 어휘 가드와 칸 타입**

`order-progress.thresholds.spec.ts` 의 import 에 `SHIPMENT_STAGES`, `SHIPMENT_STATES` 를 더하고 파일 끝에 붙인다:

```ts
describe('SHIPMENT_STATES', () => {
  it.each([...SHIPMENT_STAGES])('%s 의 상자 세부 상태는 같은 단계의 주문 어휘 안에 있다 — 판정 SQL 이 낼 수 있는 값', (stage) => {
    const orderStates: readonly string[] = ORDER_PROGRESS_STATES[stage];
    expect(SHIPMENT_STATES[stage].filter((s) => !orderStates.includes(s))).toEqual([]);
  });

  it('직배 단위는 상자가 없다 — drop_ship_* 상태가 상자 어휘에 없다', () => {
    const all = SHIPMENT_STAGES.flatMap((stage): readonly string[] => SHIPMENT_STATES[stage]);
    expect(all.filter((s) => s.startsWith('drop_ship_'))).toEqual([]);
  });

  it('25번 규칙의 칸(pick/CONSOLIDATION_PENDING)이 상자 어휘에 있다', () => {
    expect(SHIPMENT_STATES.pick).toContain('CONSOLIDATION_PENDING');
  });
});
```

`order-reconcile.gate.spec.ts` import 에 `ShipmentReconcileSituation` 을 더하고 파일 끝에 붙인다:

```ts
describe('ShipmentReconcileSituation 타입 — npm run type-check 가 검사한다', () => {
  it('주문 단위 단계·직배 상태는 상자 칸이 아니다', () => {
    // @ts-expect-error fo 는 주문 단위 판정이라 상자에 없다
    const orderOnly: ShipmentReconcileSituation = { stage: 'fo', states: ['awaiting_matching'] };
    // @ts-expect-error 직배 단위는 상자가 없다
    const dropShip: ShipmentReconcileSituation = { stage: 'dispatch', states: ['drop_ship_pending'] };
    const ok: ShipmentReconcileSituation = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] };
    expect([orderOnly, dropShip, ok]).toHaveLength(3);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — `SHIPMENT_STAGES`·`SHIPMENT_STATES`·`ShipmentReconcileSituation` 를 찾을 수 없음

- [ ] **Step 3: 어휘 구현 (`order-progress.thresholds.ts`)**

`export type OrderProgressState = ...` 줄 바로 아래에 더한다:

```ts
/**
 * 상자 하나의 판정(리컨실러 스펙 §11.5 «상자별 결과»)에서 상자 규칙이 겨눌 수 있는 단계·세부 상태. 주문 어휘의 부분집합이다 —
 * accept·fo·cancel_request·return_exchange 는 주문 단위 판정이라 상자에 없고, 직배(drop_ship_*)는 상자가 없다.
 * unclassified 는 상자 상태·recovery_code 가 그대로 나오는 열린 값이라 겨눌 규칙이 생길 때 더한다.
 */
export const SHIPMENT_STAGES = ['reserve', 'plan', 'waybill', 'pick', 'dispatch', 'track', 'cancel'] as const;
export type ShipmentStage = (typeof SHIPMENT_STAGES)[number];

export const SHIPMENT_STATES = {
  reserve: ['created', 'partially_reserved'],
  plan: ['awaiting_plan'],
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
  dispatch: ['awaiting_dispatch'],
  track: ['shipped', 'in_transit', 'failed'],
  cancel: ['CANCEL_REPLAN_PENDING'],
} as const satisfies { [S in ShipmentStage]: readonly OrderProgressStateOf<S>[] };
export type ShipmentStateOf<S extends ShipmentStage> = (typeof SHIPMENT_STATES)[S][number];
```

(`satisfies` 가 «주문 어휘의 부분집합»을 컴파일 때도 막는다. Step 1 의 스펙은 런타임에서 같은 것을 한 번 더 본다.)

- [ ] **Step 4: 규칙 계약 구현 (`order-reconcile.rule.ts`)**

파일 전체를 다음으로 바꾼다:

```ts
import { DbTx } from '../../inventory/schema/inventory.schema';
import {
  OrderProgressStage,
  OrderProgressStateOf,
  ShipmentStage,
  ShipmentStateOf,
} from '../order-progress/order-progress.thresholds';
import { ReconcileMode } from './order-reconcile.state';

export const ORDER_RECONCILE_RULES = Symbol('ORDER_RECONCILE_RULES');

/** 재판정 대상의 종류(스펙 D14). 끝난 주문은 주문 종류의 다른 칸이다(D19, 29번이 연다) */
export type ReconcileSubject = 'order' | 'shipment';

/** 규칙이 볼 투영의 칸. 단계와 그 단계의 세부 상태가 짝으로 타입 검사된다(스펙 §11.3) */
export type OrderReconcileSituation = {
  [S in OrderProgressStage]: { readonly stage: S; readonly states: readonly OrderProgressStateOf<S>[] };
}[OrderProgressStage];

/** 상자 규칙이 볼 상자별 판정의 칸(스펙 §11.3·§11.5) */
export type ShipmentReconcileSituation = {
  [S in ShipmentStage]: { readonly stage: S; readonly states: readonly ShipmentStateOf<S>[] };
}[ShipmentStage];

/**
 * 틀(러너·저장소)이 다루는 칸. 세부 상태가 넓은 string 인 것은 통합 스펙이 고유 상태값으로 실데이터와 격리하기
 * 위해서다 — 규칙을 쓰는 계약은 OrderReconcileRule·ShipmentReconcileRule 의 좁은 타입이고 레지스트리는 그것만 받는다.
 */
export type ReconcileSituationRef = { readonly stage: OrderProgressStage; readonly states: readonly string[] };

/** act 의 결과. 'noop' = 할 일이 없었다(사람이 먼저 처리했거나 CAS 에서 짐) — not_needed 로 기록되고 횟수를 올리지 않는다(D13) */
export type ReconcileActResult = 'acted' | 'noop';

/** id 는 대상 종류에 따라 판매주문 id 또는 상자(shipment) id 다 */
interface ReconcileRuleBody {
  /** 상태 기록의 키. 바꾸면 기록이 끊긴다 */
  readonly name: string;
  /** #1016 행 번호 */
  readonly row: number;
  readonly mode: ReconcileMode;
  /** 상황 지문 — 바뀌면 횟수·포기가 리셋된다 */
  fingerprint(id: string, tx: DbTx): Promise<string>;
  /** 원천 재확인. false = 지금은 할 일 없음(실패 아님) */
  check(id: string, tx: DbTx): Promise<boolean>;
  act(id: string, tx: DbTx): Promise<ReconcileActResult>;
}

/**
 * 재판정 규칙 하나(스펙 §4.2·§4.4·§11.3). 규칙은 후보 SQL 을 쓰지 않는다 — 후보는 틀이 판정에서 고르고,
 * 실행 직전에 틀이 지금 판정으로 칸을 다시 확인한다(D12). check 는 도메인이 쓰는 판정 함수를 그대로 쓰고,
 * act 는 도메인 함수만 부른다. 일시적 막힘(정비 모드 등)은 check 가 false 로 걸러 시도로 세지 않게 한다.
 */
export interface OrderReconcileRule extends ReconcileRuleBody {
  readonly subject: 'order';
  readonly situation: OrderReconcileSituation;
}

/**
 * 상자 규칙. 후보는 틀이 상자별 판정에서 고르고, 상자에 라인이 있는 주문 중 하나라도 채널 취소 요청·외부 출고·반품·교환이면
 * 틀이 뺀다(D16). 시도 기록은 shipment_reconcile_state 에 남는다(D17).
 */
export interface ShipmentReconcileRule extends ReconcileRuleBody {
  readonly subject: 'shipment';
  readonly situation: ShipmentReconcileSituation;
}

export type ReconcileRule = OrderReconcileRule | ShipmentReconcileRule;

/** 러너가 받는 모양. ReconcileRule 은 그대로 대입된다 */
export interface RunnableReconcileRule extends ReconcileRuleBody {
  readonly subject: ReconcileSubject;
  readonly situation: ReconcileSituationRef;
}

export type ReconcileRuleRef = Pick<RunnableReconcileRule, 'name' | 'row' | 'situation'>;
```

- [ ] **Step 5: 12번 규칙·레지스트리·모듈·러너 스펙을 새 계약에 맞춘다**

`rules/wake-awaiting-matching.rule.ts` — `readonly row = 12;` 아래에 한 줄:

```ts
  readonly subject = 'order' as const;
```

`order-reconcile.registry.ts` — `OrderReconcileRule` 을 `ReconcileRule` 로:

```ts
import { Type } from '@nestjs/common';
import { ReconcileRule } from './order-reconcile.rule';
import { WakeAwaitingMatchingRule } from './rules/wake-awaiting-matching.rule';

/**
 * 재판정 규칙 목록(스펙 §4.1). #1016 재판정 행을 닫을 때 여기 한 줄을 더하고, 규칙이 쓰는 도메인 모듈을
 * OrderReconcileModule 의 imports 에 더한다.
 */
export const ORDER_RECONCILE_RULE_CLASSES: Type<ReconcileRule>[] = [
  WakeAwaitingMatchingRule, // #1016 12번
];
```

`order-reconcile.module.ts` — import 의 `OrderReconcileRule` 을 `ReconcileRule` 로, `useFactory: (...rules: ReconcileRule[]) => rules`.

`order-reconcile.runner.integration.spec.ts` 의 `fakeRule` 객체에 `subject: 'order',` 를 `mode,` 아래에 더한다.

- [ ] **Step 6: 통과 확인**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts apps/core/src/modules/fulfillment/order-reconcile`
Expected: type-check 0, 스펙 PASS(통합은 `DATABASE_URL` 없이 skip)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.thresholds.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "refactor(core): 리컨실러 규칙이 대상 종류(주문·상자)를 선언하고 상자 칸 어휘를 둔다 (#1016 25번)"
```

---

### Task 2: 판정 SQL 분리 — 상자별 결과

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-sql.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts`
- Create: `apps/core/src/modules/fulfillment/order-progress/order-progress.judge-shipments.integration.spec.ts`

**Interfaces:**
- Produces:
  - `judgedShipmentsSql(scope: SQL, nowIso: string): SQL` — 열 `shipment_id, stage, state, estimated_entered_at, sales_order_ids(text[]), order_rules(text[])`
  - `openShipmentScopeSql(): SQL`, `shipmentScopeSql(shipmentId: string): SQL`
  - `type JudgedShipmentRow = { shipmentId: string; stage: string; state: string | null; estimatedEnteredAt: string | null; salesOrderIds: string[]; orderRules: string[] }` (reader.ts)
  - `OrderProgressReader.judgeOpenShipments(now: Date, tx?: DbTx): Promise<JudgedShipmentRow[]>`
  - `OrderProgressReader.judgeShipment(shipmentId: string, now: Date, tx?: DbTx): Promise<JudgedShipmentRow | undefined>`

- [ ] **Step 1: 실패하는 통합 테스트**

`order-progress.judge-shipments.integration.spec.ts`:

```ts
import * as postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

const idsScope = (ids: string[]) =>
  sql`SELECT unnest(ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}])`;

describeIfDb('상자별 판정 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const NOW = new Date('2099-01-01T00:00:00.000Z');

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function rollback(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }

  it('형제 상자가 더 뒤처져 주문 투영에서 가려진 상자도 상자 판정에는 그대로 나온다', async () => {
    await rollback(async (tx) => {
      const reader = new OrderProgressReader(makeDbService(db));
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const waiting = await f.seedFo(tx, w, o, { status: 'ready' });
      const behind = await f.seedFo(tx, w, o, { status: 'created' });
      const consolidating = await f.seedBox(tx, w, [waiting.foItemId], {
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
      });
      await f.seedBox(tx, w, [behind.foItemId], { status: 'draft' });

      const [order] = await reader.judge([o.salesOrderId], NOW, tx);
      expect(order).toMatchObject({ stage: 'reserve', state: 'created' });

      const box = await reader.judgeShipment(consolidating.shipmentId, NOW, tx);
      expect(box).toMatchObject({
        shipmentId: consolidating.shipmentId,
        stage: 'pick',
        state: 'CONSOLIDATION_PENDING',
        salesOrderIds: [o.salesOrderId],
        orderRules: ['unit'],
      });
    });
  });

  it('합포장 상자는 상자당 한 행이고, 상자를 나눈 주문이 투영에서 종료(셀메이트 출고)여도 그 주문 판정이 실린다', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const reader = new OrderProgressReader(dbs);
      const w = await f.seedWorld(tx);
      const open = await f.seedOrder(tx);
      const shipped = await f.seedOrder(tx, { status: 'shipped' });
      const a = await f.seedFo(tx, w, open);
      const b = await f.seedFo(tx, w, shipped);
      const shared = await f.seedBox(tx, w, [a.foItemId, b.foItemId], {
        status: 'recovery_required',
        recoveryCode: 'CONSOLIDATION_PENDING',
      });
      await new OrderProgressManager(dbs).refreshScope(idsScope([open.salesOrderId, shipped.salesOrderId]), NOW, tx);
      const [closed] = await tx
        .select({ outcome: wmsTables.orderProgress.outcome })
        .from(wmsTables.orderProgress)
        .where(eq(wmsTables.orderProgress.salesOrderId, shipped.salesOrderId));
      expect(closed.outcome).toBe('external_shipped');

      const rows = (await reader.judgeOpenShipments(NOW, tx)).filter((r) => r.shipmentId === shared.shipmentId);
      expect(rows).toHaveLength(1);
      expect(rows[0].salesOrderIds).toEqual([open.salesOrderId, shipped.salesOrderId].sort());
      expect(rows[0].orderRules).toEqual(['external_shipped', 'unit']);
    });
  });

  it('취소된 상자와 직배 단위는 상자 판정에 나오지 않고, 없는 상자는 undefined', async () => {
    await rollback(async (tx) => {
      const dbs = makeDbService(db);
      const reader = new OrderProgressReader(dbs);
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      const inHouse = await f.seedFo(tx, w, o);
      await f.seedFo(tx, w, o, { dropShip: 'pending' });
      const canceled = await f.seedBox(tx, w, [inHouse.foItemId], { status: 'canceled' });
      await new OrderProgressManager(dbs).refreshScope(idsScope([o.salesOrderId]), NOW, tx);

      const ours = (await reader.judgeOpenShipments(NOW, tx)).filter((r) => r.salesOrderIds.includes(o.salesOrderId));
      expect(ours).toEqual([]);
      expect(await reader.judgeShipment(canceled.shipmentId, NOW, tx)).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — `judgeShipment`·`judgeOpenShipments` 가 `OrderProgressReader` 에 없음

- [ ] **Step 3: 판정 SQL 분리 (`order-progress.judge-sql.ts`)**

1. 파일 맨 위(import 아래)에 단계 우선순위를 한 곳으로 뺀다 — `rep` 와 상자 접기가 같이 쓴다:

```ts
/** 대표 단위를 고르는 순서: 분류 안 됨 > 취소 > 가장 뒤처진 단계. 주문으로 접을 때와 상자로 접을 때 같은 순서를 쓴다 */
const unitStagePriority = (stage: SQL) => sql`CASE ${stage}
  WHEN 'unclassified' THEN 0 WHEN 'cancel' THEN 1 WHEN 'reserve' THEN 2 WHEN 'plan' THEN 3
  WHEN 'waybill' THEN 4 WHEN 'pick' THEN 5 WHEN 'dispatch' THEN 6 WHEN 'track' THEN 7 ELSE 99
END`;
```

2. 기존 `judgedRowsSql` 본문의 `WITH so AS (` 부터 `decided AS ( … )` 의 닫는 괄호까지를 새 비공개 함수 `judgeCtes(scope: SQL, now: SQL): SQL` 로 옮긴다(`return sql\`WITH so AS ( … ), … decided AS ( … )\``). 옮기면서 세 군데만 바꾼다:

   - `units` 의 첫 SELECT: `SELECT k.sales_order_id,` → `SELECT k.sales_order_id, k.shipment_id,`
   - `units` 의 직배 SELECT: `SELECT fo.sales_order_id,` → `SELECT fo.sales_order_id, NULL::uuid AS shipment_id,`
   - `rep` 의 `ORDER BY u.sales_order_id, CASE u.stage … END, u.est ASC NULLS LAST` → `ORDER BY u.sales_order_id, ${unitStagePriority(sql\`u.stage\`)}, u.est ASC NULLS LAST`

3. `judgedRowsSql` 는 CTE 를 읽기만 한다 — 바깥 SELECT 는 한 글자도 바꾸지 않는다:

```ts
export function judgedRowsSql(scope: SQL, nowIso: string): SQL {
  const now = sql`${nowIso}::timestamptz`;
  return sql`
    ${judgeCtes(scope, now)}
    SELECT d.id AS sales_order_id,
           … (기존 바깥 SELECT 그대로) …
      FROM decided d
  `;
}
```

4. 그 아래에 상자별 결과와 범위 SQL 둘을 더한다:

```ts
/**
 * 상자별 판정(리컨실러 스펙 §11.5). 같은 CTE 의 units 를 상자로 접는다 — 판정 정의는 한 벌이다.
 * 상자 하나가 주문마다 한 행씩 나오므로(합포장) 주문으로 접을 때와 같은 우선순위로 대표 행을 고르고,
 * 그 상자에 라인이 있는 주문들과 그 주문 판정(decided.rule)을 배열로 싣는다 — 리컨실러가 D16 제외를 판단한다.
 * 직배 단위는 상자가 없어 나오지 않는다.
 */
export function judgedShipmentsSql(scope: SQL, nowIso: string): SQL {
  const now = sql`${nowIso}::timestamptz`;
  return sql`
    ${judgeCtes(scope, now)},
    su AS (
      SELECT u.shipment_id, u.sales_order_id, u.stage, u.state, u.est, d.rule AS order_rule
        FROM units u
        JOIN decided d ON d.id = u.sales_order_id
       WHERE u.shipment_id IS NOT NULL
    ),
    agg AS (
      SELECT su.shipment_id,
             array_agg(DISTINCT su.sales_order_id::text ORDER BY su.sales_order_id::text) AS sales_order_ids,
             array_agg(DISTINCT su.order_rule ORDER BY su.order_rule) AS order_rules
        FROM su
       GROUP BY su.shipment_id
    )
    SELECT DISTINCT ON (su.shipment_id)
           su.shipment_id,
           su.stage,
           left(su.state, 64) AS state,
           to_char(su.est AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS estimated_entered_at,
           agg.sales_order_ids,
           agg.order_rules
      FROM su
      JOIN agg ON agg.shipment_id = su.shipment_id
     ORDER BY su.shipment_id, ${unitStagePriority(sql`su.stage`)}, su.est ASC NULLS LAST
  `;
}

/**
 * 상자 후보를 찾을 범위: 진행 중 주문 + 그 주문과 상자를 나눈 주문. 나눈 주문을 넣는 이유 — 셀메이트로 출고돼 투영에서
 * 종료된 주문이 합포장 상자에 같이 있으면, 그 주문을 판정해야 D16 제외가 걸린다(빠지면 제외가 조용히 사라진다).
 */
export function openShipmentScopeSql(): SQL {
  return sql`
    SELECT p.sales_order_id FROM order_progress p WHERE p.outcome IS NULL
    UNION
    SELECT f2.sales_order_id
      FROM order_progress p
      JOIN fulfillment_orders f1 ON f1.sales_order_id = p.sales_order_id
      JOIN fulfillment_order_items i1 ON i1.fulfillment_order_id = f1.id
      JOIN shipment_lines l1 ON l1.fulfillment_order_item_id = i1.id
      JOIN shipments s ON s.id = l1.shipment_id AND s.status NOT IN ('canceled', 'superseded')
      JOIN shipment_lines l2 ON l2.shipment_id = s.id
      JOIN fulfillment_order_items i2 ON i2.id = l2.fulfillment_order_item_id
      JOIN fulfillment_orders f2 ON f2.id = i2.fulfillment_order_id
     WHERE p.outcome IS NULL AND f2.sales_order_id IS NOT NULL
  `;
}

/** 상자 하나의 지금 판정 범위: 그 상자에 라인이 있는 판매주문 전부(실행 직전 게이트, §11.4-3) */
export function shipmentScopeSql(shipmentId: string): SQL {
  return sql`
    SELECT DISTINCT f.sales_order_id
      FROM shipment_lines l
      JOIN fulfillment_order_items i ON i.id = l.fulfillment_order_item_id
      JOIN fulfillment_orders f ON f.id = i.fulfillment_order_id
     WHERE l.shipment_id = ${shipmentId}::uuid AND f.sales_order_id IS NOT NULL
  `;
}
```

- [ ] **Step 4: 리더 메서드 (`order-progress.reader.ts`)**

import 에 `judgedShipmentsSql, openShipmentScopeSql, shipmentScopeSql` 을 더하고, `JudgedRow` 아래에 타입 둘을:

```ts
/** 상자별 판정 한 행(리컨실러 스펙 §11.5). stage·state 는 판정 SQL 의 단위 값 그대로다(done 등 진행 단계 밖 값 포함) */
export type JudgedShipmentRow = {
  shipmentId: string;
  stage: string;
  state: string | null;
  estimatedEnteredAt: string | null;
  salesOrderIds: string[];
  orderRules: string[];
};

type RawJudgedShipment = {
  shipment_id: string;
  stage: string;
  state: string | null;
  estimated_entered_at: string | null;
  sales_order_ids: string[];
  order_rules: string[];
};
```

`judge()` 아래에 메서드 둘과 비공개 변환 하나:

```ts
  /** 진행 중 주문(과 그 주문과 상자를 나눈 주문)의 열린 상자를 상자별로 판정한다 — 리컨실러 상자 후보의 원천(§11.4-1) */
  async judgeOpenShipments(now: Date, tx?: DbTx): Promise<JudgedShipmentRow[]> {
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(judgedShipmentsSql(openShipmentScopeSql(), now.toISOString()));
      return toShipmentRows(result);
    }, tx);
  }

  /** 상자 하나의 지금 판정. 취소·대체된 상자나 없는 상자는 undefined — 실행 직전 게이트가 쓴다(§11.4-3) */
  async judgeShipment(shipmentId: string, now: Date, tx?: DbTx): Promise<JudgedShipmentRow | undefined> {
    return this.dbService.run(async (trx) => {
      const result = await trx.execute(judgedShipmentsSql(shipmentScopeSql(shipmentId), now.toISOString()));
      return toShipmentRows(result).find((r) => r.shipmentId === shipmentId);
    }, tx);
  }
```

클래스 밖(파일 끝):

```ts
function toShipmentRows(result: unknown): JudgedShipmentRow[] {
  // execute() 원시 결과 타이핑 — judge() 와 같은 문서화된 캐스트. text[] 는 postgres.js 가 배열로 읽는다
  return (result as RawJudgedShipment[]).map((r) => ({
    shipmentId: r.shipment_id,
    stage: r.stage,
    state: r.state,
    estimatedEnteredAt: r.estimated_entered_at,
    salesOrderIds: r.sales_order_ids,
    orderRules: r.order_rules,
  }));
}
```

- [ ] **Step 5: 통과 확인 — 새 스펙 + 기존 판정 회귀**

Run (통합 스펙 실행법의 임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-progress/order-progress.judge-shipments.integration.spec.ts apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.integration.spec.ts apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts`
Expected: 전부 PASS — 기존 주문 판정 스펙이 하나도 안 바뀌어야 CTE 분리가 동작을 보존한 것이다

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/order-progress`
Expected: 0 / PASS(thresholds 스펙의 «판정 SQL 이 낼 수 있는 값» 가드 포함)

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-progress/
git commit -m "feat(core): 판정 SQL 에서 상자별 결과를 꺼내 상자 단위로 판정한다 (#1016 25번, 스펙 §11.5)"
```

---

### Task 3: 상자 칸 판단 — 순수 함수

후보·떠남·게이트가 모두 이 함수 하나로 «칸 안인가»를 정한다.

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts`

**Interfaces:**
- Consumes: `JudgedShipmentRow`, `judgedShipmentsSql` (Task 2), `ReconcileSituationRef` (Task 1)
- Produces:
  - `SHIPMENT_EXCLUDED_ORDER_RULES: readonly ['cancel_request', 'external_shipped', 'return_exchange']`
  - `shipmentInSituation(situation: ReconcileSituationRef, row: Pick<JudgedShipmentRow, 'stage' | 'state' | 'orderRules'> | undefined): boolean`
  - `inSituationShipmentIds(rows: JudgedShipmentRow[], situation: ReconcileSituationRef): string[]` — 단계 진입 오래된 순(NULL 은 뒤), 같으면 id 순

- [ ] **Step 1: 실패하는 테스트**

`order-reconcile.subject.spec.ts`:

```ts
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { judgedShipmentsSql } from '../order-progress/order-progress.judge-sql';
import { JudgedShipmentRow } from '../order-progress/order-progress.reader';
import { SHIPMENT_EXCLUDED_ORDER_RULES, inSituationShipmentIds, shipmentInSituation } from './order-reconcile.subject';

const SIT = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] } as const;
const row = (over: Partial<JudgedShipmentRow> = {}): JudgedShipmentRow => ({
  shipmentId: 's',
  stage: 'pick',
  state: 'CONSOLIDATION_PENDING',
  estimatedEnteredAt: '2000-01-01T00:00:00.000Z',
  salesOrderIds: ['o'],
  orderRules: ['unit'],
  ...over,
});

describe('shipmentInSituation', () => {
  it('단계·세부 상태가 칸과 같고 제외 주문이 없으면 칸 안', () => {
    expect(shipmentInSituation(SIT, row())).toBe(true);
  });

  it('판정에 없는 상자(취소·대체됨)·다른 단계·다른 세부 상태·state 없음은 칸 밖', () => {
    expect(shipmentInSituation(SIT, undefined)).toBe(false);
    expect(shipmentInSituation(SIT, row({ stage: 'plan' }))).toBe(false);
    expect(shipmentInSituation(SIT, row({ state: 'queued' }))).toBe(false);
    expect(shipmentInSituation(SIT, row({ state: null }))).toBe(false);
  });

  it.each([...SHIPMENT_EXCLUDED_ORDER_RULES])('상자의 주문 중 하나라도 %s 이면 칸 밖(D16)', (rule) => {
    expect(shipmentInSituation(SIT, row({ orderRules: ['unit', rule] }))).toBe(false);
  });

  it('취소된 주문(cancel_open·cancelled)은 제외하지 않는다 — 30번이 다룬다', () => {
    expect(shipmentInSituation(SIT, row({ orderRules: ['cancel_open', 'cancelled', 'unit'] }))).toBe(true);
  });
});

describe('inSituationShipmentIds', () => {
  it('칸 안인 상자만, 단계 진입 오래된 순(추정 시각 없음은 뒤), 같으면 id 순', () => {
    const rows = [
      row({ shipmentId: 'c', estimatedEnteredAt: null }),
      row({ shipmentId: 'b', estimatedEnteredAt: '2000-01-02T00:00:00.000Z' }),
      row({ shipmentId: 'x', orderRules: ['external_shipped'] }),
      row({ shipmentId: 'a', estimatedEnteredAt: '2000-01-02T00:00:00.000Z' }),
      row({ shipmentId: 'd', estimatedEnteredAt: '2000-01-01T00:00:00.000Z' }),
      row({ shipmentId: 'e', state: 'queued' }),
    ];
    expect(inSituationShipmentIds(rows, SIT)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('D16 제외 목록', () => {
  it('목록의 값은 판정 SQL 이 주문 판정으로 실제로 내는 값이다 — 오타면 제외가 조용히 사라진다', () => {
    const text = new PgDialect().sqlToQuery(judgedShipmentsSql(sql`SELECT NULL::uuid`, '2000-01-01T00:00:00.000Z')).sql;
    expect(SHIPMENT_EXCLUDED_ORDER_RULES.filter((r) => !text.includes(`THEN '${r}'`))).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts`
Expected: FAIL — `Cannot find module './order-reconcile.subject'`

- [ ] **Step 3: 구현**

`order-reconcile.subject.ts`:

```ts
import { JudgedShipmentRow } from '../order-progress/order-progress.reader';
import { ReconcileSituationRef } from './order-reconcile.rule';

/**
 * 상자 규칙이 건드리면 안 되는 주문 판정(스펙 D16). 상자에 라인이 있는 주문 중 하나라도 이 판정이면 그 상자는 후보가 아니다.
 * 채널 취소 요청 중(출고 보류) · 셀메이트 출고(D1) · 반품·교환. 취소된 주문(cancel_open·cancelled)은 30번이 다뤄야 하므로 통과한다.
 * 규칙마다 허용 상태를 선언하게 하지 않는 이유: 하나가 빠뜨리면 셀메이트 출고 주문을 건드린다.
 */
export const SHIPMENT_EXCLUDED_ORDER_RULES = ['cancel_request', 'external_shipped', 'return_exchange'] as const;

/** 상자 하나가 지금 규칙의 칸 안인가. 후보 선택·떠남·실행 직전 게이트가 모두 이 함수를 쓴다(판단이 한 벌이어야 엇갈리지 않는다) */
export function shipmentInSituation(
  situation: ReconcileSituationRef,
  row: Pick<JudgedShipmentRow, 'stage' | 'state' | 'orderRules'> | undefined,
): boolean {
  if (!row || row.state === null) return false;
  const excluded: readonly string[] = SHIPMENT_EXCLUDED_ORDER_RULES;
  if (row.orderRules.some((r) => excluded.includes(r))) return false;
  return row.stage === situation.stage && situation.states.includes(row.state);
}

/** 칸 안인 상자 id — 단계 진입 오래된 순(추정 시각이 없으면 뒤), 같으면 id 순. 주문 후보의 «stage_entered_at 오래된 순»과 같은 뜻이다 */
export function inSituationShipmentIds(rows: JudgedShipmentRow[], situation: ReconcileSituationRef): string[] {
  return rows
    .filter((r) => shipmentInSituation(situation, r))
    .sort((a, b) => {
      if (a.estimatedEnteredAt !== b.estimatedEnteredAt) {
        if (a.estimatedEnteredAt === null) return 1;
        if (b.estimatedEnteredAt === null) return -1;
        return a.estimatedEnteredAt < b.estimatedEnteredAt ? -1 : 1;
      }
      return a.shipmentId < b.shipmentId ? -1 : a.shipmentId > b.shipmentId ? 1 : 0;
    })
    .map((r) => r.shipmentId);
}
```

(ISO 문자열은 판정 SQL 이 같은 형식으로 내므로 문자열 비교가 시각 비교다.)

- [ ] **Step 4: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts && npm run type-check`
Expected: PASS / 0

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.subject.spec.ts
git commit -m "feat(core): 상자 재판정의 «칸 안인가»와 D16 제외를 순수 함수 하나로 둔다 (#1016 25번)"
```

---

### Task 4: `shipment_reconcile_state` 테이블과 저장소

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/<ts>_add-shipment-reconcile-state.sql`, `apps/core/drizzle/meta/*` (생성)
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.integration.spec.ts`

**Interfaces:**
- Consumes: `ReconcileRuleRef` (Task 1), `ReconcileRecord`·`ReconcilePrior`·`DEPARTURE_GRACE_MIN` (state.ts)
- Produces:
  - `wmsTables.shipmentReconcileState`
  - `toReconcilePrior(row)` (order-reconcile.repository.ts 에서 export)
  - `ShipmentReconcileRepository`:
    - `candidates(rule: ReconcileRuleRef, orderedIds: readonly string[], now: Date, limit: number, tx?: DbTx): Promise<ShipmentReconcileCandidate[]>` — `ShipmentReconcileCandidate = { shipmentId: string; prior: ReconcilePrior | null }`
    - `deleteDeparted(rule: ReconcileRuleRef, stillInIds: readonly string[], now: Date, tx?: DbTx): Promise<number>`
    - `deleteUnregistered(names: readonly string[], tx?: DbTx): Promise<number>`
    - `save(rule: ReconcileRuleRef, shipmentId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void>`

- [ ] **Step 1: 스키마**

`inventory.schema.ts` — `shipmentLines` 테이블 정의가 끝난 바로 뒤(현재 `export const shipmentLines = pgTable(` 블록 다음)에 더한다:

```ts
/**
 * 리컨실러 상자 규칙의 재판정 상태(스펙 2026-10-08 §11.2 D17). 행 하나 = «규칙 × 상자». 칸의 뜻은 order_reconcile_state 와 같다.
 * (rule, next_check_at) 인덱스는 두지 않는다 — 상자 후보는 판정 결과에서 고른 id 로 PK 를 찾는다.
 */
export const shipmentReconcileState = pgTable(
  'shipment_reconcile_state',
  {
    rule: varchar('rule', { length: 64 }).notNull(),
    shipmentId: uuid('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    trackingRow: integer('tracking_row').notNull(),
    fingerprint: text('fingerprint').notNull(),
    mode: varchar('mode', { length: 16 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastResult: varchar('last_result', { length: 16 }).notNull(),
    lastError: text('last_error'),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }).notNull(),
    // NULL = 진행 중. 찍히면 그 상자에 라인이 있는 주문마다 정체 보드에 «자동 멈춤»으로 보인다(D18)
    gaveUpAt: timestamp('gave_up_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.rule, t.shipmentId] }),
    // 정체 보드 요약·목록이 «포기한 상자»만 찾는다
    idxGaveUp: index('idx_shipment_reconcile_state_gave_up')
      .on(t.shipmentId)
      .where(sql`${t.gaveUpAt} IS NOT NULL`),
  }),
);
```

`wmsTables` 객체에서 `orderReconcileState,` 다음 줄에 `shipmentReconcileState,`. `export type OrderReconcileStateRow = …` 다음 줄에:

```ts
export type ShipmentReconcileStateRow = InferSelectModel<typeof shipmentReconcileState>;
```

- [ ] **Step 2: 마이그 생성과 검토**

Run: `npm run db:generate:core -- --name add-shipment-reconcile-state`

생성된 `apps/core/drizzle/<ts>_add-shipment-reconcile-state.sql` 을 연다. 기대하는 내용은 정확히 셋이다:
- `CREATE TABLE "shipment_reconcile_state" (…)` + `PRIMARY KEY("rule","shipment_id")`
- `ALTER TABLE "shipment_reconcile_state" ADD CONSTRAINT … FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade`
- `CREATE INDEX "idx_shipment_reconcile_state_gave_up" … WHERE "shipment_reconcile_state"."gave_up_at" IS NOT NULL`

이 밖의 문장(다른 테이블 ALTER·DROP)이 섞였으면 스냅샷이 어긋난 것이다 — `git rm` 하고 멈춰 원인을 보고한다(손으로 지우지 않는다).

- [ ] **Step 3: `toReconcilePrior` export**

`order-reconcile.repository.ts` 맨 아래의 `function toPrior(` 를 `export function toReconcilePrior(` 로 이름을 바꾸고, 파일 안의 호출 `toPrior(r)` 를 `toReconcilePrior(r)` 로 바꾼다.

- [ ] **Step 4: 실패하는 저장소 통합 테스트**

`shipment-reconcile.repository.integration.spec.ts`:

```ts
import { randomUUID } from 'crypto';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { ReconcileRuleRef } from './order-reconcile.rule';
import { ShipmentReconcileRepository } from './shipment-reconcile.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function seedShipmentId(tx: DbTx): Promise<string> {
  const w = await f.seedWorld(tx);
  const o = await f.seedOrder(tx);
  const fo = await f.seedFo(tx, w, o);
  return (await f.seedBox(tx, w, [fo.foItemId], { status: 'recovery_required', recoveryCode: 'CONSOLIDATION_PENDING' }))
    .shipmentId;
}

const record = (over: Partial<Parameters<ShipmentReconcileRepository['save']>[2]> = {}) => ({
  fingerprint: 'fp',
  mode: 'act' as const,
  attempts: 1,
  lastResult: 'acted' as const,
  lastError: null,
  gaveUpAt: null,
  nextCheckAt: new Date('2099-01-01T00:00:00.000Z'),
  ...over,
});

describeIfDb('ShipmentReconcileRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  const { sql, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await sql.end();
  });
  const NOW = new Date('2099-06-01T00:00:00.000Z');
  const ruleRef = (): ReconcileRuleRef => ({
    name: `it-box-${randomUUID().slice(0, 8)}`,
    row: 98,
    situation: { stage: 'pick', states: ['CONSOLIDATION_PENDING'] },
  });

  it('후보: 받은 순서를 지키고, 볼 때가 안 된 행은 건너뛰고, 된 행은 이전 상태와 함께, 상한까지', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const rule = ruleRef();
      const [a, b, c, d] = [await seedShipmentId(tx), await seedShipmentId(tx), await seedShipmentId(tx), await seedShipmentId(tx)];
      await repo.save(rule, b, record({ nextCheckAt: new Date('2099-06-01T00:05:00.000Z') }), NOW, tx); // 아직
      await repo.save(rule, c, record({ nextCheckAt: new Date('2099-05-31T23:59:00.000Z'), attempts: 2 }), NOW, tx); // 됨

      const got = await repo.candidates(rule, [a, b, c, d], NOW, 2, tx);

      expect(got.map((x) => x.shipmentId)).toEqual([a, c]);
      expect(got[0].prior).toBeNull();
      expect(got[1].prior).toMatchObject({ attempts: 2, lastResult: 'acted', fingerprint: 'fp' });
      expect(await repo.candidates(rule, [], NOW, 50, tx)).toEqual([]);
    });
  });

  it('떠남: 칸에 남은 상자는 지우지 않고, 막 acted 한 행은 유예 동안 남기며, 남은 상자가 0개면 유예 밖 행을 다 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const rule = ruleRef();
      const [stays, left, justActed] = [await seedShipmentId(tx), await seedShipmentId(tx), await seedShipmentId(tx)];
      const old = new Date('2099-05-31T00:00:00.000Z');
      await repo.save(rule, stays, record({ lastResult: 'not_needed' }), old, tx);
      await repo.save(rule, left, record({ lastResult: 'not_needed' }), old, tx);
      await repo.save(rule, justActed, record({ lastResult: 'acted' }), new Date('2099-05-31T23:55:00.000Z'), tx);

      expect(await repo.deleteDeparted(rule, [stays], NOW, tx)).toBe(1);
      expect(await repo.deleteDeparted(rule, [], NOW, tx)).toBe(1); // stays 만 지워진다 — justActed 는 유예 안
      const remaining = await tx.select().from(wmsTables.shipmentReconcileState);
      expect(remaining.filter((r) => r.rule === rule.name).map((r) => r.shipmentId)).toEqual([justActed]);
    });
  });

  it('save 는 upsert 이고 tracking_row 를 남기며, deleteUnregistered 는 이름 없는 규칙의 행만 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const repo = new ShipmentReconcileRepository(makeDbService(db));
      const kept = ruleRef();
      const gone = ruleRef();
      const id = await seedShipmentId(tx);
      await repo.save(kept, id, record({ attempts: 1 }), NOW, tx);
      await repo.save(kept, id, record({ attempts: 3 }), NOW, tx);
      await repo.save(gone, id, record(), NOW, tx);

      const removed = await repo.deleteUnregistered([kept.name], tx);

      expect(removed).toBeGreaterThanOrEqual(1);
      const rows = (await tx.select().from(wmsTables.shipmentReconcileState)).filter((r) => r.shipmentId === id);
      expect(rows).toEqual([expect.objectContaining({ rule: kept.name, attempts: 3, trackingRow: 98 })]);
    });
  });
});
```

(`deleteUnregistered([kept.name])` 은 실데이터의 다른 규칙 행도 지운다 — 롤백 트랜잭션 안이라 괜찮고, 그래서 `toBeGreaterThanOrEqual(1)` 로 센다.)

- [ ] **Step 5: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — `./shipment-reconcile.repository` 없음

- [ ] **Step 6: 저장소 구현**

`shipment-reconcile.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, lte, notInArray, or } from 'drizzle-orm';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { toReconcilePrior } from './order-reconcile.repository';
import { ReconcileRuleRef } from './order-reconcile.rule';
import { DEPARTURE_GRACE_MIN, ReconcilePrior, ReconcileRecord } from './order-reconcile.state';

export type ShipmentReconcileCandidate = { shipmentId: string; prior: ReconcilePrior | null };

/**
 * 상자 규칙의 상태 저장소(스펙 D17). 칸 안인 상자는 틀이 상자별 판정에서 이미 골라 넘긴다 — 여기는 «볼 때가 됐나»와 기록만 한다.
 * 떠남·유예·등록 안 된 규칙 청소의 뜻은 OrderReconcileRepository 와 같다.
 */
@Injectable()
export class ShipmentReconcileRepository {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** orderedIds(칸 안 상자, 단계 진입 오래된 순) 중 행이 없거나 next_check_at 이 지난 것을 그 순서대로 limit 까지 */
  async candidates(
    rule: ReconcileRuleRef,
    orderedIds: readonly string[],
    now: Date,
    limit: number,
    tx?: DbTx,
  ): Promise<ShipmentReconcileCandidate[]> {
    if (orderedIds.length === 0) return [];
    const s = wmsTables.shipmentReconcileState;
    return this.dbService.run(async (trx) => {
      const rows = await trx
        .select()
        .from(s)
        .where(and(eq(s.rule, rule.name), inArray(s.shipmentId, [...orderedIds])));
      const byId = new Map(rows.map((r) => [r.shipmentId, r]));
      const out: ShipmentReconcileCandidate[] = [];
      for (const shipmentId of orderedIds) {
        const row = byId.get(shipmentId);
        if (row && row.nextCheckAt.getTime() > now.getTime()) continue;
        out.push({ shipmentId, prior: row ? toReconcilePrior(row) : null });
        if (out.length >= limit) break;
      }
      return out;
    }, tx);
  }

  /**
   * 칸을 떠난 상자의 행을 지운다 — «해결됨». stillInIds = 지금 칸 안인 상자 전부. 막 act 했거나 실패한 행은
   * DEPARTURE_GRACE_MIN 동안 남긴다(order 저장소와 같은 이유).
   */
  async deleteDeparted(rule: ReconcileRuleRef, stillInIds: readonly string[], now: Date, tx?: DbTx): Promise<number> {
    const s = wmsTables.shipmentReconcileState;
    const graceFrom = new Date(now.getTime() - DEPARTURE_GRACE_MIN * 60_000);
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(
          and(
            eq(s.rule, rule.name),
            or(notInArray(s.lastResult, ['acted', 'error']), lte(s.updatedAt, graceFrom)),
            // 남은 상자가 없으면 이 조건을 빼서 유예 밖 행을 모두 지운다
            stillInIds.length > 0 ? notInArray(s.shipmentId, [...stillInIds]) : undefined,
          ),
        )
        .returning({ shipmentId: s.shipmentId });
      return deleted.length;
    }, tx);
  }

  async deleteUnregistered(names: readonly string[], tx?: DbTx): Promise<number> {
    const s = wmsTables.shipmentReconcileState;
    return this.dbService.run(async (trx) => {
      const deleted = await trx
        .delete(s)
        .where(names.length > 0 ? notInArray(s.rule, [...names]) : undefined)
        .returning({ shipmentId: s.shipmentId });
      return deleted.length;
    }, tx);
  }

  async save(rule: ReconcileRuleRef, shipmentId: string, record: ReconcileRecord, now: Date, tx?: DbTx): Promise<void> {
    const s = wmsTables.shipmentReconcileState;
    const values = {
      trackingRow: rule.row,
      fingerprint: record.fingerprint,
      mode: record.mode,
      attempts: record.attempts,
      lastResult: record.lastResult,
      lastError: record.lastError,
      nextCheckAt: record.nextCheckAt,
      gaveUpAt: record.gaveUpAt,
      updatedAt: now,
    };
    await this.dbService.run(
      (trx) =>
        trx
          .insert(s)
          .values({ rule: rule.name, shipmentId, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: [s.rule, s.shipmentId], set: values }),
      tx,
    );
  }
}
```

- [ ] **Step 7: 통과 확인**

임시 DB 를 다시 만들고 migrate 한 뒤(새 마이그 포함):
Run: `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.integration.spec.ts apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts`
Expected: PASS

Run: `npm run type-check`
Expected: 0

- [ ] **Step 8: Commit — 스키마·마이그·meta 를 한 커밋에**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/ \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.ts \
  apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.ts \
  apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.integration.spec.ts
git commit -m "feat(core): 상자 규칙의 재판정 상태 테이블 shipment_reconcile_state 와 저장소 (#1016 25번, D17)"
```

---

### Task 5: 러너 — 대상 종류별 포트

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts` (provider 하나)
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts` (생성자 인자)

**Interfaces:**
- Consumes: `ShipmentReconcileRepository` (Task 4), `shipmentInSituation`·`inSituationShipmentIds` (Task 3), `judgeOpenShipments`·`judgeShipment`·`JudgedShipmentRow` (Task 2)
- Produces:
  - `new OrderReconcileRunner(dbService, repository: OrderReconcileRepository, shipmentRepository: ShipmentReconcileRepository, progress: ReconcileProgress, rules: RunnableReconcileRule[])`
  - `type ReconcileProgress = Pick<OrderProgressReader, 'judge' | 'judgeOpenShipments' | 'judgeShipment'>`
  - `runRule(rule, now, tx?, openShipments?: () => Promise<JudgedShipmentRow[]>): Promise<RuleRunSummary>` — `runAll` 은 바퀴당 상자 판정을 한 번만 돌려 넘긴다

- [ ] **Step 1: 실패하는 테스트 — 상자 시나리오**

`order-reconcile.runner.integration.spec.ts`:

1. import 에 더한다:

```ts
import { JudgedShipmentRow } from '../order-progress/order-progress.reader';
import { ShipmentReconcileRepository } from './shipment-reconcile.repository';
```

2. 기존 `judgeAs` 가 돌려주는 객체에 두 줄을 더한다(주문 규칙 스펙은 상자 판정을 안 쓴다):

```ts
    judgeOpenShipments: jest.fn(async (): Promise<JudgedShipmentRow[]> => []),
    judgeShipment: jest.fn(async (): Promise<JudgedShipmentRow | undefined> => undefined),
```

3. 파일 안의 모든 `new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), ` 를 `new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new ShipmentReconcileRepository(dbs), ` 로 바꾼다:

```bash
sed -i 's/new OrderReconcileRepository(dbs), /new OrderReconcileRepository(dbs), new ShipmentReconcileRepository(dbs), /g' \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts
```

`wake-awaiting-matching.rule.integration.spec.ts` 에도 `import { ShipmentReconcileRepository } from '../shipment-reconcile.repository';` 를 더한다.

4. 헬퍼(파일 위쪽, `judgeAs` 아래):

```ts
async function seedShipmentId(tx: DbTx): Promise<string> {
  const w = await f.seedWorld(tx);
  const o = await f.seedOrder(tx);
  const fo = await f.seedFo(tx, w, o);
  return (await f.seedBox(tx, w, [fo.foItemId], { status: 'recovery_required', recoveryCode: 'CONSOLIDATION_PENDING' }))
    .shipmentId;
}

const boxRow = (shipmentId: string, state: string, over: Partial<JudgedShipmentRow> = {}): JudgedShipmentRow => ({
  shipmentId,
  stage: 'pick',
  state,
  estimatedEnteredAt: '2000-01-01T00:00:00.000Z',
  salesOrderIds: [],
  orderRules: ['unit'],
  ...over,
});

/** 상자 판정을 흉내 낸다 — 바퀴의 상자 판정은 open, 실행 직전 판정은 now(기본은 open 과 같음) */
function boxesAs(open: JudgedShipmentRow[], now: JudgedShipmentRow[] = open) {
  return {
    judge: jest.fn(async () => []),
    judgeOpenShipments: jest.fn(async () => open),
    judgeShipment: jest.fn(async (id: string) => now.find((r) => r.shipmentId === id)),
  };
}

function fakeBoxRule(state: string, mode: ReconcileMode, act: (id: string) => Promise<ReconcileActResult>) {
  const rule: RunnableReconcileRule = {
    name: `it-box-${state}`,
    row: 98,
    mode,
    subject: 'shipment',
    situation: { stage: 'pick', states: [state] },
    fingerprint: jest.fn(async () => 'fp'),
    check: jest.fn(async () => true),
    act: jest.fn(async (id: string) => act(id)),
  };
  return rule;
}

const boxStatesOf = async (tx: DbTx, rule: string) =>
  new Map(
    (await tx.select().from(wmsTables.shipmentReconcileState))
      .filter((r) => r.rule === rule)
      .map((r) => [r.shipmentId, r]),
  );
```

5. describe 블록 끝에 테스트 넷:

```ts
  it('상자 규칙: 칸 안이고 D16 제외가 아닌 상자만 오래된 순으로 실행하고, 상자 상태 테이블에 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const [newer, older, excluded] = [await seedShipmentId(tx), await seedShipmentId(tx), await seedShipmentId(tx)];
      const rule = fakeBoxRule(state, 'act', async () => 'acted');
      const progress = boxesAs([
        boxRow(newer, state, { estimatedEnteredAt: '2000-01-02T00:00:00.000Z' }),
        boxRow(older, state, { estimatedEnteredAt: '2000-01-01T00:00:00.000Z' }),
        boxRow(excluded, state, { orderRules: ['unit', 'external_shipped'] }),
      ]);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new ShipmentReconcileRepository(dbs), progress, [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect((rule.act as jest.Mock).mock.calls.map((c) => c[0])).toEqual([older, newer]);
      expect(summary.acted).toBe(2);
      const rows = await boxStatesOf(tx, rule.name);
      expect([...rows.keys()].sort()).toEqual([newer, older].sort());
      expect(rows.get(older)).toMatchObject({ lastResult: 'acted', attempts: 1, trackingRow: 98 });
      expect((await statesOf(tx, rule.name)).size).toBe(0); // 주문 테이블엔 쓰지 않는다
    });
  });

  it('상자 게이트: 지금 상자 판정이 칸 밖이면(대체됨·D16) 규칙을 부르지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const [gone, nowExcluded] = [await seedShipmentId(tx), await seedShipmentId(tx)];
      const rule = fakeBoxRule(state, 'act', async () => 'acted');
      const progress = boxesAs(
        [boxRow(gone, state), boxRow(nowExcluded, state)],
        [boxRow(nowExcluded, state, { orderRules: ['cancel_request'] })], // gone 은 지금 판정에 없다(대체됨)
      );
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new ShipmentReconcileRepository(dbs), progress, [rule]);

      const summary = await runner.runRule(rule, NOW, tx);

      expect(rule.fingerprint).not.toHaveBeenCalled();
      expect(rule.act).not.toHaveBeenCalled();
      expect(summary.gated).toBe(2);
      expect([...(await boxStatesOf(tx, rule.name)).values()].map((r) => r.lastResult)).toEqual(['not_needed', 'not_needed']);
    });
  });

  it('상자 규칙: 칸을 떠난 상자의 행은 지우고, 막 acted 한 행은 유예 동안 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const [settled, justActed] = [await seedShipmentId(tx), await seedShipmentId(tx)];
      const rule = fakeBoxRule(state, 'act', async () => 'acted');
      // settled 는 not_needed, justActed 는 acted 로 남긴다
      (rule.check as jest.Mock).mockImplementation(async (id: string) => id !== settled);
      const seen = new OrderReconcileRunner(
        dbs,
        new OrderReconcileRepository(dbs),
        new ShipmentReconcileRepository(dbs),
        boxesAs([boxRow(settled, state), boxRow(justActed, state)]),
        [rule],
      );
      await seen.runRule(rule, new Date('2099-05-31T23:58:00.000Z'), tx);

      // 둘 다 칸을 떠났다 — 2분 뒤: settled 는 지우고, justActed 는 떠남 유예(10분) 안이라 남긴다
      const empty = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), new ShipmentReconcileRepository(dbs), boxesAs([]), [rule]);
      const summary = await empty.runRule(rule, NOW, tx);

      expect(summary.departed).toBe(1);
      expect([...(await boxStatesOf(tx, rule.name)).keys()]).toEqual([justActed]);
    });
  });

  it('runAll: 상자 규칙이 둘이어도 상자 판정은 한 바퀴에 한 번이고, 등록 안 된 규칙의 상자 행도 지운다', async () => {
    await inRollbackTx(db, async (tx) => {
      const dbs = makeDbService(db);
      const state = `it_${randomUUID().slice(0, 8)}`;
      const id = await seedShipmentId(tx);
      const one = fakeBoxRule(`${state}a`, 'observe', async () => 'acted');
      const two = fakeBoxRule(`${state}b`, 'observe', async () => 'acted');
      const orphan = fakeBoxRule(`${state}x`, 'observe', async () => 'acted');
      const shipmentRepo = new ShipmentReconcileRepository(dbs);
      await shipmentRepo.save(orphan, id, {
        fingerprint: 'fp', mode: 'observe', attempts: 0, lastResult: 'would_act', lastError: null, gaveUpAt: null, nextCheckAt: NOW,
      }, NOW, tx);
      const progress = boxesAs([boxRow(id, `${state}a`)]);
      const runner = new OrderReconcileRunner(dbs, new OrderReconcileRepository(dbs), shipmentRepo, progress, [one, two]);

      await runner.runAll(NOW, tx);

      expect(progress.judgeOpenShipments).toHaveBeenCalledTimes(1);
      expect((await boxStatesOf(tx, orphan.name)).size).toBe(0);
      expect((await boxStatesOf(tx, one.name)).get(id)).toMatchObject({ lastResult: 'would_act' });
    });
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — 러너 생성자 인자 수, `subject: 'shipment'` 규칙을 러너가 주문처럼 다룸(통합 실행 시 상자 테스트 실패)

- [ ] **Step 3: 러너 구현**

`order-reconcile.runner.ts` 를 다음으로 바꾼다(주문 경로의 동작은 그대로 — 포트로 옮겼을 뿐이다):

```ts
// apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { JudgedShipmentRow, OrderProgressReader } from '../order-progress/order-progress.reader';
import { shouldRecordGateOut, stillInSituation } from './order-reconcile.gate';
import { OrderReconcileRepository } from './order-reconcile.repository';
import { ORDER_RECONCILE_RULES, RunnableReconcileRule } from './order-reconcile.rule';
import {
  RECONCILE_CANDIDATE_LIMIT,
  ReconcilePrior,
  ReconcileRecord,
  ReconcileStep,
  chooseStep,
  effectivePrior,
  errorStep,
  nextRecord,
} from './order-reconcile.state';
import { inSituationShipmentIds, shipmentInSituation } from './order-reconcile.subject';
import { ShipmentReconcileRepository } from './shipment-reconcile.repository';

export type RuleRunSummary = {
  rule: string;
  departed: number;
  acted: number;
  wouldAct: number;
  notNeeded: number;
  /** 실행 직전 판정이 칸 밖이라 규칙을 부르지 않은 후보. 매분 0 이 아니면 투영 갱신이 늦거나 멈춘 것이다 */
  gated: number;
  gaveUp: number;
  errors: number;
};

/** 러너가 읽는 판정 — 통합 스펙이 흉내 낼 수 있게 좁힌 타입 */
export type ReconcileProgress = Pick<OrderProgressReader, 'judge' | 'judgeOpenShipments' | 'judgeShipment'>;

/** 대상 종류마다 다른 것 — 떠남·후보·지금 판정·기록 테이블. 한 바퀴의 흐름(게이트·지문·check·act·백오프)은 종류와 무관하다(§11.3·§11.4) */
type SubjectPort = {
  deleteDeparted(): Promise<number>;
  candidates(): Promise<Array<{ id: string; prior: ReconcilePrior | null }>>;
  inSituationNow(id: string, sp: DbTx): Promise<boolean>;
  save(id: string, record: ReconcileRecord, tx: DbTx): Promise<void>;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 리컨실러 한 바퀴(스펙 §4.3·§11.4). 후보 하나 = savepoint 하나 — 한 대상의 실패가 다른 대상을 막지 않는다(#1016 1번 행의 교훈).
 * 규칙 하나가 통째로 실패하면 그 규칙만 건너뛴다.
 */
@Injectable()
export class OrderReconcileRunner {
  private readonly logger = new Logger(OrderReconcileRunner.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly repository: OrderReconcileRepository,
    private readonly shipmentRepository: ShipmentReconcileRepository,
    // 타입 별칭은 DI 메타데이터가 Object 가 되므로 토큰을 명시한다
    @Inject(OrderProgressReader) private readonly progress: ReconcileProgress,
    @Inject(ORDER_RECONCILE_RULES) private readonly rules: RunnableReconcileRule[],
  ) {}

  async runAll(now: Date, tx?: DbTx): Promise<RuleRunSummary[]> {
    const names = this.rules.map((r) => r.name);
    try {
      const removed =
        (await this.repository.deleteUnregistered(names, tx)) +
        (await this.shipmentRepository.deleteUnregistered(names, tx));
      if (removed > 0) this.logger.log(`order-reconcile removed ${removed} rows of unregistered rules`);
    } catch (error) {
      // 정리는 부수 작업이다 — 실패해도 규칙은 돈다
      this.logger.error(`order-reconcile unregistered cleanup failed: ${messageOf(error)}`);
    }
    // 상자 규칙끼리 바퀴마다 상자별 판정을 한 번만 돌린다(§11.4-1). 실패도 공유된다 — 그 바퀴의 상자 규칙은 모두 건너뛴다
    let shipments: Promise<JudgedShipmentRow[]> | undefined;
    const openShipments = () => (shipments ??= this.progress.judgeOpenShipments(now, tx));
    const out: RuleRunSummary[] = [];
    for (const rule of this.rules) {
      try {
        out.push(await this.runRule(rule, now, tx, openShipments));
      } catch (error) {
        this.logger.error(
          `order-reconcile rule ${rule.name} failed: ${messageOf(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return out;
  }

  async runRule(
    rule: RunnableReconcileRule,
    now: Date,
    tx?: DbTx,
    openShipments: () => Promise<JudgedShipmentRow[]> = () => this.progress.judgeOpenShipments(now, tx),
  ): Promise<RuleRunSummary> {
    const port = await this.portFor(rule, now, tx, openShipments);
    const summary: RuleRunSummary = {
      rule: rule.name,
      departed: await port.deleteDeparted(),
      acted: 0,
      wouldAct: 0,
      notNeeded: 0,
      gated: 0,
      gaveUp: 0,
      errors: 0,
    };
    for (const candidate of await port.candidates()) {
      const step = await this.reconcileOne(rule, port, candidate.id, candidate.prior, now, tx);
      if (step === 'act') summary.acted++;
      else if (step === 'would_act') summary.wouldAct++;
      else if (step === 'not_needed') summary.notNeeded++;
      else if (step === 'gated') summary.gated++;
      else if (step === 'give_up') summary.gaveUp++;
      else summary.errors++;
    }
    const touched =
      summary.departed +
      summary.acted +
      summary.wouldAct +
      summary.notNeeded +
      summary.gated +
      summary.gaveUp +
      summary.errors;
    if (touched > 0) {
      this.logger.log(
        `order-reconcile ${rule.name}(#${rule.row}, ${rule.mode}): acted=${summary.acted} would_act=${summary.wouldAct} ` +
          `not_needed=${summary.notNeeded} gated=${summary.gated} gave_up=${summary.gaveUp} error=${summary.errors} departed=${summary.departed}`,
      );
    }
    return summary;
  }

  private async portFor(
    rule: RunnableReconcileRule,
    now: Date,
    tx: DbTx | undefined,
    openShipments: () => Promise<JudgedShipmentRow[]>,
  ): Promise<SubjectPort> {
    if (rule.subject === 'order') {
      return {
        deleteDeparted: () => this.repository.deleteDeparted(rule, now, tx),
        candidates: async () =>
          (await this.repository.candidates(rule, now, RECONCILE_CANDIDATE_LIMIT, tx)).map((c) => ({
            id: c.salesOrderId,
            prior: c.prior,
          })),
        inSituationNow: async (id, sp) => stillInSituation(rule.situation, (await this.progress.judge([id], now, sp))[0]),
        save: (id, record, trx) => this.repository.save(rule, id, record, now, trx),
      };
    }
    // 칸 안 상자 목록 하나로 떠남과 후보를 함께 정한다 — 둘이 다른 판단을 하면 행이 지워졌다 다시 생긴다
    const stillIn = inSituationShipmentIds(await openShipments(), rule.situation);
    return {
      deleteDeparted: () => this.shipmentRepository.deleteDeparted(rule, stillIn, now, tx),
      candidates: async () =>
        (await this.shipmentRepository.candidates(rule, stillIn, now, RECONCILE_CANDIDATE_LIMIT, tx)).map((c) => ({
          id: c.shipmentId,
          prior: c.prior,
        })),
      inSituationNow: async (id, sp) => shipmentInSituation(rule.situation, await this.progress.judgeShipment(id, now, sp)),
      save: (id, record, trx) => this.shipmentRepository.save(rule, id, record, now, trx),
    };
  }

  private async reconcileOne(
    rule: RunnableReconcileRule,
    port: SubjectPort,
    id: string,
    prior: ReconcilePrior | null,
    now: Date,
    tx?: DbTx,
  ): Promise<ReconcileStep | 'gated' | 'error'> {
    // savepoint 가 롤백돼도 이번 바퀴에 구한 지문은 남긴다 — 이전 지문으로 세면 운영자가 원인을 고친 뒤에도 리셋되지 않는다
    let seen: string | undefined;
    try {
      return await this.dbService.run(
        (trx) =>
          trx.transaction(async (sp) => {
            // 투영은 최대 1분 늦다 — 지금 판정이 칸을 벗어났으면 규칙을 부르지 않는다(D12).
            // 기록은 shouldRecordGateOut 이 정한다: 막 acted·error 한 행은 덮지 않고(떠남 유예 보호), 나머지는 not_needed 로
            // 10분 물러나게 한다. 지문은 구하지 않았으니 이전 지문을 그대로 쓴다 — 횟수·포기가 리셋되지 않게
            if (!(await port.inSituationNow(id, sp))) {
              if (shouldRecordGateOut(prior, now)) {
                const fingerprint = prior?.fingerprint ?? '';
                const eff = effectivePrior(prior, fingerprint, rule.mode);
                await port.save(id, nextRecord(eff, { fingerprint, mode: rule.mode, step: 'not_needed' }, now), sp);
              }
              return 'gated';
            }
            const fingerprint = await rule.fingerprint(id, sp);
            seen = fingerprint;
            const eff = effectivePrior(prior, fingerprint, rule.mode);
            let step = chooseStep(eff, rule.mode, await rule.check(id, sp));
            // 할 일이 없었으면 시도가 아니다 — acted 로 세면 사람이 먼저 처리한 대상이 포기로 간다(D13)
            if (step === 'act' && (await rule.act(id, sp)) === 'noop') step = 'not_needed';
            if (step === 'would_act' && (prior?.lastResult !== 'would_act' || prior.fingerprint !== fingerprint)) {
              // 관찰 기록은 처음 볼 때만 로그 — 매분 같은 줄이 쌓이지 않게
              this.logger.log(`order-reconcile ${rule.name} would act on ${rule.subject} ${id}`);
            }
            await port.save(
              id,
              nextRecord(eff, { fingerprint, mode: rule.mode, step, outcome: step === 'act' ? 'acted' : undefined }, now),
              sp,
            );
            return step;
          }),
        tx,
      );
    } catch (error) {
      // 지문을 못 구했으면 이전 지문으로 센다 — 같은 예외가 매분 반복돼도 백오프·포기가 걸리게
      const fingerprint = seen ?? prior?.fingerprint ?? '';
      const eff = effectivePrior(prior, fingerprint, rule.mode);
      const step = errorStep(eff, rule.mode);
      const record = nextRecord(
        eff,
        { fingerprint, mode: rule.mode, step, outcome: step === 'act' ? 'error' : undefined, error: messageOf(error) },
        now,
      );
      await this.dbService.run((trx) => port.save(id, record, trx), tx);
      this.logger.warn(`order-reconcile ${rule.name} failed on ${rule.subject} ${id}: ${messageOf(error)}`);
      return 'error';
    }
  }
}
```

`order-reconcile.module.ts` 의 providers 에 `ShipmentReconcileRepository` 를 `OrderReconcileRepository` 다음에 더하고 import 한다.

- [ ] **Step 4: 통과 확인**

Run: `npm run type-check`
Expected: 0

Run (임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts`
Expected: 기존 주문 스펙 전부 + 새 상자 스펙 4개 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "feat(core): 리컨실러 러너가 대상 종류별 포트로 상자 규칙을 돌리고 상자 판정을 바퀴마다 한 번만 한다 (#1016 25번, §11.4)"
```

---

### Task 6: 정체 보드 — 상자 규칙의 «자동 멈춤» 배지 (D18)

**Files:**
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.reader.ts`
- Modify: `apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts`

**Interfaces:**
- Consumes: `wmsTables.shipmentReconcileState` (Task 4)
- Produces: `type GaveUpBadge = { rule: string; row: number; since: string; lastError: string | null }`, `groupGaveUpMarks(marks: GaveUpMark[]): Map<string, GaveUpBadge[]>` (summary.ts). `OrderProgressItem.gaveUp: GaveUpBadge[]` — 응답 shape 는 그대로

- [ ] **Step 1: 실패하는 유닛 테스트 — 배지 묶기**

`order-progress.summary.spec.ts` 끝에(import 에 `groupGaveUpMarks` 추가):

```ts
describe('groupGaveUpMarks', () => {
  const at = (iso: string) => new Date(iso);
  it('주문마다 규칙 하나에 배지 하나 — 한 주문의 여러 상자가 같은 규칙에서 포기하면 가장 이른 것만, 행 번호 순', () => {
    const got = groupGaveUpMarks([
      { salesOrderId: 'o1', rule: 'resume-pending-consolidation', row: 25, since: at('2099-01-02T00:00:00.000Z'), lastError: 'b' },
      { salesOrderId: 'o1', rule: 'resume-pending-consolidation', row: 25, since: at('2099-01-01T00:00:00.000Z'), lastError: 'a' },
      { salesOrderId: 'o1', rule: 'wake-awaiting-matching', row: 12, since: at('2099-01-03T00:00:00.000Z'), lastError: null },
      { salesOrderId: 'o2', rule: 'resume-pending-consolidation', row: 25, since: at('2099-01-02T00:00:00.000Z'), lastError: 'b' },
    ]);
    expect(got.get('o1')).toEqual([
      { rule: 'wake-awaiting-matching', row: 12, since: '2099-01-03T00:00:00.000Z', lastError: null },
      { rule: 'resume-pending-consolidation', row: 25, since: '2099-01-01T00:00:00.000Z', lastError: 'a' },
    ]);
    expect(got.get('o2')).toHaveLength(1);
  });

  it('주문 id 나 포기 시각이 없는 행은 버린다', () => {
    const got = groupGaveUpMarks([
      { salesOrderId: null, rule: 'r', row: 1, since: at('2099-01-01T00:00:00.000Z'), lastError: null },
      { salesOrderId: 'o', rule: 'r', row: 1, since: null, lastError: null },
    ]);
    expect(got.size).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress/order-progress.summary.spec.ts`
Expected: FAIL — `groupGaveUpMarks` 없음

- [ ] **Step 3: 구현 (`order-progress.summary.ts`)**

파일 끝에:

```ts
/** 정체 보드 목록 행의 «자동 멈춤» 배지 하나(리컨실러 스펙 §6·D18) */
export type GaveUpBadge = { rule: string; row: number; since: string; lastError: string | null };
export type GaveUpMark = {
  salesOrderId: string | null;
  rule: string;
  row: number;
  since: Date | null;
  lastError: string | null;
};

/**
 * 포기 표시를 주문별 배지로 묶는다. 주문 규칙은 주문당 행이 하나지만 상자 규칙은 한 주문의 여러 상자에서 포기할 수 있다 —
 * 같은 규칙은 가장 이른 포기 하나만 남긴다(배지가 «#25 #25» 로 겹치지 않게). 행 번호 순.
 */
export function groupGaveUpMarks(marks: GaveUpMark[]): Map<string, GaveUpBadge[]> {
  const byOrder = new Map<string, Map<string, GaveUpBadge>>();
  for (const m of marks) {
    if (!m.salesOrderId || !m.since) continue;
    const rules = byOrder.get(m.salesOrderId) ?? new Map<string, GaveUpBadge>();
    const since = m.since.toISOString();
    const prev = rules.get(m.rule);
    if (!prev || since < prev.since) rules.set(m.rule, { rule: m.rule, row: m.row, since, lastError: m.lastError });
    byOrder.set(m.salesOrderId, rules);
  }
  return new Map(
    [...byOrder].map(([id, rules]) => [
      id,
      [...rules.values()].sort((a, b) => a.row - b.row || a.rule.localeCompare(b.rule)),
    ]),
  );
}
```

- [ ] **Step 4: 실패하는 통합 테스트 — 합포장 상자의 포기가 두 주문에 뜬다**

`order-progress.board.integration.spec.ts` 의 describe 끝에(파일이 이미 쓰는 `Rollback`·`makeDbService`·`f` 를 쓴다):

```ts
  it('상자 규칙이 포기한 상자는 그 상자에 라인이 있는 주문마다 배지가 뜨고, 요약의 gaveUp 에도 센다(D18)', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const w = await f.seedWorld(tx);
        const a = await f.seedOrder(tx);
        const b = await f.seedOrder(tx);
        const foA = await f.seedFo(tx, w, a);
        const foB = await f.seedFo(tx, w, b);
        const shared = await f.seedBox(tx, w, [foA.foItemId, foB.foItemId], { status: 'draft' });
        const ids = [a.salesOrderId, b.salesOrderId];
        await manager.refreshScope(
          sql`SELECT unnest(ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}])`,
          now,
          tx,
        );
        const before = await reader.summary(now, tx);
        await tx.insert(wmsTables.shipmentReconcileState).values({
          rule: 'it-box-rule',
          shipmentId: shared.shipmentId,
          trackingRow: 25,
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          nextCheckAt: now,
          gaveUpAt: new Date('2098-12-31T00:00:00.000Z'),
          firstSeenAt: now,
          updatedAt: now,
        });

        const page = await reader.listOrders({ stage: 'plan', sort: 'dwell', limit: 500 }, now, tx);
        const ours = page.items.filter((i) => ids.includes(i.salesOrderId));
        expect(ours).toHaveLength(2);
        for (const item of ours) {
          expect(item.gaveUp).toEqual([
            { rule: 'it-box-rule', row: 25, since: '2098-12-31T00:00:00.000Z', lastError: 'boom' },
          ]);
        }
        const after = await reader.summary(now, tx);
        const gaveUpOf = (s: typeof before) =>
          s.stages.find((st) => st.stage === 'plan')?.states.find((x) => x.state === 'awaiting_plan')?.gaveUp ?? 0;
        expect(gaveUpOf(after) - gaveUpOf(before)).toBe(2);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
```

- [ ] **Step 5: 리더 구현 (`order-progress.reader.ts`)**

1. import 에 `GaveUpBadge, groupGaveUpMarks` 를 더하고 `OrderProgressItem.gaveUp` 의 타입을 `GaveUpBadge[]` 로.

2. `summary()` 의 `gaveUp` 식을 바꾼다:

```ts
          gaveUp: sql<number>`(count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM ${wmsTables.orderReconcileState} r
             WHERE r.sales_order_id = ${t.salesOrderId} AND r.gave_up_at IS NOT NULL
          ) OR EXISTS (
            SELECT 1 FROM ${wmsTables.shipmentReconcileState} sr
              JOIN ${wmsTables.shipmentLines} sl ON sl.shipment_id = sr.shipment_id
              JOIN ${wmsTables.fulfillmentOrderItems} foi ON foi.id = sl.fulfillment_order_item_id
              JOIN ${wmsTables.fulfillmentOrders} fo ON fo.id = foi.fulfillment_order_id
             WHERE fo.sales_order_id = ${t.salesOrderId} AND sr.gave_up_at IS NOT NULL
          )))::int`,
```

3. `listOrders()` 안 — 기존 `marks` 쿼리 바로 아래에 상자 포기 표시를 읽고, `gaveUpBy` 를 만드는 for 문을 `groupGaveUpMarks` 로 바꾼다:

```ts
      const sr = wmsTables.shipmentReconcileState;
      const sl = wmsTables.shipmentLines;
      const foi = wmsTables.fulfillmentOrderItems;
      const fo = wmsTables.fulfillmentOrders;
      // 상자 규칙의 포기는 그 상자에 라인이 있는 주문마다 뜬다(D18)
      const boxMarks =
        ids.length === 0
          ? []
          : await trx
              .select({
                salesOrderId: fo.salesOrderId,
                rule: sr.rule,
                row: sr.trackingRow,
                since: sr.gaveUpAt,
                lastError: sr.lastError,
              })
              .from(sr)
              .innerJoin(sl, eq(sl.shipmentId, sr.shipmentId))
              .innerJoin(foi, eq(foi.id, sl.fulfillmentOrderItemId))
              .innerJoin(fo, eq(fo.id, foi.fulfillmentOrderId))
              .where(and(inArray(fo.salesOrderId, ids), isNotNull(sr.gaveUpAt)));
      const gaveUpBy = groupGaveUpMarks([...marks, ...boxMarks]);
```

(기존 `const gaveUpBy = new Map<…>(); for (const m of marks) { … }` 블록은 지운다. `marks` 쿼리의 `.orderBy(asc(r.trackingRow))` 는 이제 정렬을 `groupGaveUpMarks` 가 하므로 지워도 되고 남겨도 된다 — 지운다.)

- [ ] **Step 6: 통과 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-progress && npm run type-check`
Expected: PASS / 0

Run (임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts`
Expected: PASS(기존 «12번 포기 배지» 테스트 포함)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-progress/
git commit -m "feat(core): 상자 규칙이 포기한 상자를 그 상자의 주문마다 «자동 멈춤» 배지로 보인다 (#1016 25번, D18)"
```

---

### Task 7: 합포장 도메인 — 재개 준비도와 재개 결과

25번 규칙이 «도메인이 쓰는 판정 함수를 그대로» 쓰고 «재개가 이번 호출로 끝났는지» 알 수 있게 한다. `resumePending` 의 동작은 바꾸지 않는다.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/fulfillment-workflow-gate.service.ts`
- Modify: `apps/core/src/modules/fulfillment/services/consolidation.service.ts`
- Create: `apps/core/src/modules/fulfillment/services/__support__/consolidation-fixtures.ts`
- Modify: `apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/fulfillment.module.ts` (exports)

**Interfaces:**
- Produces:
  - `FulfillmentWorkflowGate.allowsOperationalMutations(): boolean`
  - `ConsolidationService.findPendingOperationIdForSource(shipmentId: string, tx?: DbTx): Promise<string | null>`
  - `ConsolidationService.resumeReadiness(operationId: string, tx?: DbTx): Promise<ConsolidationResumeReadiness | null>`
  - `ConsolidationService.tryResumePending(operationId: string, tx?: DbTx): Promise<ConsolidationResumeOutcome>`
  - `type ConsolidationResumeReadiness = { operationId: string; sources: Array<{ shipmentId: string; status: string; recoveryCode: string | null; manifestVersion: number; reservationVersion: number }>; blockers: Array<{ shipmentId: string; codes: string[] }> }`
  - `type ConsolidationResumeOutcome = 'completed' | 'blocked' | 'already_completed'`
  - 픽스처: `makeConsolidationService(dbService, wired, mode?)`, `consolidationBase(tx, onHand?)`, `createConsolidationSource(tx, wired, base, options)`, `consolidationSources(...fixtures)`, `CONSOLIDATION_RECIPIENT`, `pendingConsolidationBlockedByWaybill(tx, wired, consolidation)`

- [ ] **Step 1: 픽스처를 옮긴다(동작 변화 없음)**

`services/__support__/consolidation-fixtures.ts` 를 만들고, `consolidation.integration.spec.ts` 의 `RECIPIENT`·`beforeAll` 안 `new ConsolidationService(…)`·`baseFixture`·`createOrderShipment`·`requestFor` 를 다음 이름으로 옮긴다:

```ts
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { FULFILLMENT_SCOPE } from '../../../../platform/auth/fulfillment-scopes';
import { DbTx, wmsSchema, wmsTables } from '../../../inventory/schema/inventory.schema';
import { AuditService } from '../../../inventory/shared/services/audit.service';
import { ConsolidationService } from '../consolidation.service';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from '../fulfillment-command.service';
import { FulfillmentInvariantService } from '../fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../fulfillment-workflow-gate.service';
import { seedHolder, seedMatching, seedSalesOrder, seedSku, seedWarehouseWithZone } from './logistics-fixtures';
import { Wired } from './logistics-wiring';

/** 합포장 통합 스펙 공용 픽스처 — consolidation.integration.spec 과 리컨실러 25번 스펙이 같이 쓴다 */
export const CONSOLIDATION_RECIPIENT = {
  recipientName: 'Consolidation Customer',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul test road 1',
  detailAddress: '101',
};

export function makeConsolidationService(
  dbService: DbService<typeof wmsSchema>,
  wired: Wired,
  mode: 'v2' | 'maintenance' = 'v2',
): ConsolidationService {
  return new ConsolidationService(
    dbService,
    new FulfillmentCommandService(dbService),
    wired.shipmentReservations,
    new FulfillmentInvariantService(),
    new AuditService(dbService),
    {
      getScopesByRoles: () =>
        Promise.resolve(
          new Set([
            FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
            FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
            FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
          ]),
        ),
    } as never,
    new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode })),
  );
}

export type ConsolidationBase = Awaited<ReturnType<typeof consolidationBase>>;
export async function consolidationBase(tx: DbTx, onHand = 100) {
  // (기존 baseFixture 본문 그대로)
}

export type ConsolidationSource = Awaited<ReturnType<typeof createConsolidationSource>>;
export async function createConsolidationSource(
  tx: DbTx,
  wired: Wired,
  base: ConsolidationBase,
  options: {
    quantity: number;
    customerId: string;
    recipient?: typeof CONSOLIDATION_RECIPIENT;
    salesChannel?: 'medusa' | 'naver' | 'coupang';
    entrancePassword?: string;
    orderDate?: Date;
  },
) {
  // (기존 createOrderShipment 본문 그대로 — `options.customerId ?? customerId` 는 `options.customerId`, `RECIPIENT` 는 `CONSOLIDATION_RECIPIENT`)
}

export function consolidationSources(...fixtures: ConsolidationSource[]) {
  // (기존 requestFor 본문 그대로)
}

/**
 * 원본 둘을 합포장하려는데 첫 원본에 살아 있는 송장이 있어 CONSOLIDATION_PENDING 으로 멈춘 상태(#1016 25번이 보는 상황).
 * 송장을 취소하면 막힘이 풀리지만 재개를 부르는 곳이 없다.
 */
export async function pendingConsolidationBlockedByWaybill(
  tx: DbTx,
  wired: Wired,
  consolidation: ConsolidationService,
  customerId: string = randomUUID(),
) {
  const base = await consolidationBase(tx);
  const first = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
  const second = await createConsolidationSource(tx, wired, base, { quantity: 1, customerId });
  await tx.update(wmsTables.shipments).set({ status: 'planned' }).where(eq(wmsTables.shipments.id, first.shipment.id));
  const [waybill] = await tx
    .insert(wmsTables.waybills)
    .values({
      shipmentId: first.shipment.id,
      source: 'manual',
      carrier: 'HANJIN',
      status: 'registered',
      trackingNo: `consolidation-waybill-${randomUUID()}`,
      manifestVersion: first.shipment.manifestVersion,
      recipientHash: canonicalFulfillmentRequestHash(first.shipment.recipientSnapshot),
    })
    .returning();
  const pending = await consolidation.consolidate(
    { sources: consolidationSources(first, second), recipientSourceShipmentId: first.shipment.id, reason: 'wait for waybill void' },
    `pending-consolidation-${randomUUID()}`,
    { id: randomUUID(), roles: ['logistics_manager'] },
    tx,
  );
  const voidWaybill = () =>
    tx.update(wmsTables.waybills).set({ status: 'voided', voidedAt: new Date() }).where(eq(wmsTables.waybills.id, waybill.id));
  return { base, first, second, operationId: pending.operationId, voidWaybill };
}
```

(`// (기존 … 본문 그대로)` 자리에는 `consolidation.integration.spec.ts` 의 해당 함수 본문을 **잘라 붙인다** — 새로 쓰지 않는다. `wired.fulfillments` 는 인자 `wired` 를 쓴다.)

`services/__support__/index.ts` 에 `export * from './consolidation-fixtures';` 를 더한다.

`consolidation.integration.spec.ts` 를 고친다 — 지역 정의를 지우고:

```ts
  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    consolidation = makeConsolidationService(dbService, wired);
    planning = … (그대로)
  });

  const baseFixture = consolidationBase;
  const createOrderShipment = (
    tx: DbTx,
    base: ConsolidationBase,
    options: Omit<Parameters<typeof createConsolidationSource>[3], 'customerId'> & { customerId?: string },
  ) => createConsolidationSource(tx, wired, base, { ...options, customerId: options.customerId ?? customerId });
  const requestFor = consolidationSources;
  const RECIPIENT = CONSOLIDATION_RECIPIENT;
```

(테스트 본문은 한 줄도 바꾸지 않는다 — 이름을 지역 별칭으로 남겨 diff 를 옮김만으로 둔다.)

Run (임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts`
Expected: 옮기기 전과 같은 수가 PASS

```bash
git add apps/core/src/modules/fulfillment/services/__support__/ apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts
git commit -m "test(core): 합포장 통합 스펙 픽스처를 공용 support 로 옮긴다 (#1016 25번 준비)"
```

- [ ] **Step 2: 실패하는 테스트 — 재개 준비도·재개 결과**

`consolidation.integration.spec.ts` describe 끝에:

```ts
  it('findPendingOperationIdForSource: 대기 중 합포장의 원본이면 그 작업, 끝나거나 원본이 아니면 null', async () => {
    await inRollbackTx(db, async (tx) => {
      const p = await pendingConsolidationBlockedByWaybill(tx, wired, consolidation, customerId);
      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBe(p.operationId);
      expect(await consolidation.findPendingOperationIdForSource(p.second.shipment.id, tx)).toBe(p.operationId);
      await p.voidWaybill();
      await consolidation.resumePending(p.operationId, tx);
      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBeNull();
    });
  });

  it('resumeReadiness·tryResumePending: 송장이 막는 동안은 blocked, 송장을 취소하면 completed, 다시 부르면 already_completed', async () => {
    await inRollbackTx(db, async (tx) => {
      const p = await pendingConsolidationBlockedByWaybill(tx, wired, consolidation, customerId);

      const blocked = await consolidation.resumeReadiness(p.operationId, tx);
      expect(blocked?.blockers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ shipmentId: p.first.shipment.id, codes: expect.arrayContaining(['ACTIVE_INVOICE']) }),
        ]),
      );
      expect(blocked?.sources.map((s) => [s.status, s.recoveryCode])).toEqual([
        ['recovery_required', 'CONSOLIDATION_PENDING'],
        ['recovery_required', 'CONSOLIDATION_PENDING'],
      ]);
      expect(await consolidation.tryResumePending(p.operationId, tx)).toBe('blocked');

      await p.voidWaybill();
      expect((await consolidation.resumeReadiness(p.operationId, tx))?.blockers).toEqual([]);
      expect(await consolidation.tryResumePending(p.operationId, tx)).toBe('completed');
      expect(await consolidation.resumeReadiness(p.operationId, tx)).toBeNull();
      expect(await consolidation.tryResumePending(p.operationId, tx)).toBe('already_completed');
    });
  });
```

- [ ] **Step 3: 실패 확인**

Run: `npm run type-check`
Expected: FAIL — 세 메서드 없음

- [ ] **Step 4: 게이트 메서드 (`fulfillment-workflow-gate.service.ts`)**

`shouldRunFoCreation()` 바로 위에:

```ts
  /** 물리 출고 변경을 지금 받는가(던지지 않는다). 리컨실러 규칙의 check 가 정비 모드를 «일시적 막힘»으로 거를 때 쓴다 */
  allowsOperationalMutations(): boolean {
    return this.mode !== 'maintenance';
  }
```

- [ ] **Step 5: 도메인 구현 (`consolidation.service.ts`)**

1. `ConsolidationResponse` 타입 아래에 타입 둘을 export 한다(Interfaces 의 정의 그대로).

2. `resumePending` 을 얇게 만들고 본문을 비공개 `resume` 으로 옮긴다:

```ts
  /** Task 12-14 call this after invoice void, batch exclusion and unpick have committed. */
  async resumePending(operationId: string, tx?: DbTx): Promise<ConsolidationResponse> {
    return (await this.resume(operationId, tx)).response;
  }

  /**
   * 재개가 «이번 호출로» 끝났는지 알려 준다 — 리컨실러 25번이 할 일이 없었던 호출(막힘이 남음·이미 끝남)을 시도로 세지 않게(스펙 D13).
   */
  async tryResumePending(operationId: string, tx?: DbTx): Promise<ConsolidationResumeOutcome> {
    return (await this.resume(operationId, tx)).outcome;
  }

  private async resume(
    operationId: string,
    tx?: DbTx,
  ): Promise<{ outcome: ConsolidationResumeOutcome; response: ConsolidationResponse }> {
    // (기존 resumePending 본문 그대로, return 만 아래처럼 감싼다)
  }
```

기존 본문의 `return` 다섯 곳을 감싼다:
- `return this.completedResponse(operationId, trx);` (세 곳: 첫 조회, catch 안, 잠근 뒤) → `return { outcome: 'already_completed', response: await this.completedResponse(operationId, trx) };`
- 막힘이 남아 `operationStatus: 'pending'` 을 돌려주는 곳 → `return { outcome: 'blocked', response: { … 그대로 … } };`
- 마지막 `return response;` → `return { outcome: 'completed', response };`

3. `assertInitialSourceStatusesSafe` 안의 대기 중 작업 조회를 비공개 함수로 빼고, 공개 래퍼와 준비도 함수를 더한다(`resume` 아래):

```ts
  /** 이 상자를 원본으로 둔 대기 중 합포장 작업(가장 이른 것). 없으면 null */
  async findPendingOperationIdForSource(shipmentId: string, tx?: DbTx): Promise<string | null> {
    return this.dbService.run((trx) => this.pendingOperationIdForSource(shipmentId, trx), tx);
  }

  /**
   * 대기 중 합포장을 지금 재개하면 무엇이 막는지. resumePending 이 잠근 뒤 쓰는 판정(collectBlockers)과 같은 함수를 잠그지 않고 부른다 —
   * 리컨실러 규칙의 check 가 도메인과 엇갈리지 않게(스펙 §4.4-2). 작업이 없거나 대기 중이 아니면 null.
   */
  async resumeReadiness(operationId: string, tx?: DbTx): Promise<ConsolidationResumeReadiness | null> {
    return this.dbService.run(async (trx) => {
      const [operation] = await trx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId))
        .limit(1);
      if (!operation || operation.type !== 'consolidate' || operation.status !== 'pending') return null;
      const pending = this.pendingIntent(operation.afterManifestSnapshot);
      const aggregates = await Promise.all(
        uniqueSorted(pending.sources.map((source) => source.shipmentId)).map((id) => this.loadAggregate(id, trx)),
      );
      return {
        operationId,
        sources: aggregates.map((aggregate) => ({
          shipmentId: aggregate.shipment.id,
          status: aggregate.shipment.status,
          recoveryCode: aggregate.shipment.recoveryCode,
          manifestVersion: aggregate.shipment.manifestVersion,
          reservationVersion: aggregate.shipment.reservationVersion,
        })),
        blockers: await this.collectBlockers(aggregates, trx),
      };
    }, tx);
  }

  private async pendingOperationIdForSource(shipmentId: string, tx: DbTx): Promise<string | null> {
    const [pending] = await tx
      .select({ operationId: wmsTables.shipmentOperations.id })
      .from(wmsTables.shipmentOperationMembers)
      .innerJoin(
        wmsTables.shipmentOperations,
        eq(wmsTables.shipmentOperations.id, wmsTables.shipmentOperationMembers.operationId),
      )
      .where(
        and(
          eq(wmsTables.shipmentOperationMembers.shipmentId, shipmentId),
          eq(wmsTables.shipmentOperationMembers.role, 'source'),
          eq(wmsTables.shipmentOperations.type, 'consolidate'),
          eq(wmsTables.shipmentOperations.status, 'pending'),
        ),
      )
      .orderBy(asc(wmsTables.shipmentOperations.createdAt))
      .limit(1);
    return pending?.operationId ?? null;
  }
```

`assertInitialSourceStatusesSafe` 의 `const [pending] = await tx.select(…)…limit(1);` 블록을 `const pendingId = await this.pendingOperationIdForSource(aggregate.shipment.id, tx);` 로 바꾸고, 아래 `&& pending` → `&& pendingId`, `operationId: pending.operationId` → `operationId: pendingId`.

4. `fulfillment.module.ts` 의 `exports` 배열 끝에 `ConsolidationService,` 를 더한다.

- [ ] **Step 6: 통과 확인**

Run: `npm run type-check`
Expected: 0

Run (임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts apps/core/src/modules/fulfillment/services/outbound-batch-orchestrator*.integration.spec.ts`
Expected: PASS — 오케스트레이터의 `resumeWaitingOperation` → `resumePending` 경로가 그대로임을 같이 본다(파일 글롭에 걸리는 스펙이 없으면 `grep -rl "resumeWaitingOperation\|excludeShipment" apps/core/src --include=*.integration.spec.ts` 로 찾은 스펙을 넣는다)

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/ apps/core/src/modules/fulfillment/fulfillment.module.ts
git commit -m "feat(core): 대기 중 합포장의 재개 준비도와 «이번 호출로 끝났나»를 도메인이 알려 준다 (#1016 25번)"
```

---

### Task 8: 25번 규칙 — 대기 중 합포장 재개 (관찰 모드)

**Files:**
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.spec.ts`
- Create: `apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.integration.spec.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.registry.ts`
- Modify: `apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.module.ts`

**Interfaces:**
- Consumes: `ConsolidationService.findPendingOperationIdForSource`·`resumeReadiness`·`tryResumePending`, `FulfillmentWorkflowGate.allowsOperationalMutations` (Task 7), `OrderProgressReader.judgeShipment` (Task 2), `shipmentInSituation` (Task 3), `ShipmentReconcileRule` (Task 1), 픽스처 (Task 7)
- Produces: `ResumePendingConsolidationRule` (`name = 'resume-pending-consolidation'`, `row = 25`, `subject = 'shipment'`, `mode = 'observe'`, `situation = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] }`), `readinessFingerprint(r: ConsolidationResumeReadiness): string`

| 항목 | 내용 |
| --- | --- |
| `fingerprint` | 대기 중 작업 id + 원본마다 `상자:상태:recovery_code:manifest:reservation`(정렬) + 막힘 `상자:코드+코드`(정렬). 작업이 없으면 `none`. 운영자가 송장을 취소하거나 작업에서 박스를 빼면 막힘 목록이 바뀌어 리셋된다 |
| `check` | ① 정비 모드면 false ② 이 상자를 원본으로 둔 대기 중 작업이 있다 ③ `resumeReadiness` 의 막힘이 0 ④ **원본 상자 전부**가 지금 상자 판정으로 칸 안(D16 제외 아님) |
| `act` | `tryResumePending(작업)` — `completed` 만 `acted`, `blocked`·`already_completed` 는 `noop` |

- [ ] **Step 1: 실패하는 테스트**

`resume-pending-consolidation.rule.spec.ts`(유닛 — 지문):

```ts
import { readinessFingerprint } from './resume-pending-consolidation.rule';

describe('readinessFingerprint', () => {
  const base = {
    operationId: 'op',
    sources: [
      { shipmentId: 'b', status: 'recovery_required', recoveryCode: 'CONSOLIDATION_PENDING', manifestVersion: 1, reservationVersion: 2 },
      { shipmentId: 'a', status: 'recovery_required', recoveryCode: 'CONSOLIDATION_PENDING', manifestVersion: 1, reservationVersion: 1 },
    ],
    blockers: [{ shipmentId: 'a', codes: ['ACTIVE_WORK_ITEM', 'ACTIVE_INVOICE'] }],
  };

  it('원본·막힘 순서에 흔들리지 않는다', () => {
    const shuffled = {
      ...base,
      sources: [...base.sources].reverse(),
      blockers: [{ shipmentId: 'a', codes: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'] }],
    };
    expect(readinessFingerprint(shuffled)).toBe(readinessFingerprint(base));
  });

  it('막힘이 하나 풀리면(송장 취소) 바뀐다 — 포기 뒤 운영자가 원인을 고치면 다시 시도한다', () => {
    expect(readinessFingerprint({ ...base, blockers: [{ shipmentId: 'a', codes: ['ACTIVE_WORK_ITEM'] }] })).not.toBe(
      readinessFingerprint(base),
    );
  });

  it('원본의 버전이 바뀌면 바뀐다', () => {
    const bumped = { ...base, sources: [{ ...base.sources[0], reservationVersion: 3 }, base.sources[1]] };
    expect(readinessFingerprint(bumped)).not.toBe(readinessFingerprint(base));
  });
});
```

`resume-pending-consolidation.rule.integration.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  inRollbackTx,
  makeConsolidationService,
  makeDb,
  makeDbService,
  pendingConsolidationBlockedByWaybill,
  wireLogistics,
} from '../../services/__support__';
import { OrderProgressManager } from '../../order-progress/order-progress.manager';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { OrderReconcileRepository } from '../order-reconcile.repository';
import { RunnableReconcileRule } from '../order-reconcile.rule';
import { OrderReconcileRunner } from '../order-reconcile.runner';
import { ShipmentReconcileRepository } from '../shipment-reconcile.repository';
import { ResumePendingConsolidationRule } from './resume-pending-consolidation.rule';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const gate = (mode: 'v2' | 'maintenance') =>
  new FulfillmentWorkflowGate(
    new ConfigService({ FULFILLMENT_WORKFLOW_MODE: mode, FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
  );

/** 관찰 모드 규칙을 실행 모드로 감싼다 — 실행 전환 PR 뒤의 동작을 미리 본다 */
const acting = (rule: ResumePendingConsolidationRule): RunnableReconcileRule => ({
  name: rule.name,
  row: rule.row,
  mode: 'act',
  subject: rule.subject,
  situation: rule.situation,
  fingerprint: (id, tx) => rule.fingerprint(id, tx),
  check: (id, tx) => rule.check(id, tx),
  act: (id, tx) => rule.act(id, tx),
});

describeIfDb('ResumePendingConsolidationRule (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await client.end();
  });

  function wire(mode: 'v2' | 'maintenance' = 'v2') {
    const dbs = makeDbService(db);
    const w = wireLogistics(dbs, 'v2');
    const consolidation = makeConsolidationService(dbs, w);
    const reader = new OrderProgressReader(dbs);
    const rule = new ResumePendingConsolidationRule(consolidation, gate(mode), reader);
    const runner = new OrderReconcileRunner(
      dbs,
      new OrderReconcileRepository(dbs),
      new ShipmentReconcileRepository(dbs),
      reader,
      [rule],
    );
    return { dbs, w, consolidation, rule, runner };
  }

  async function project(tx: DbTx, dbs: ReturnType<typeof makeDbService>, salesOrderIds: string[], now: Date) {
    await new OrderProgressManager(dbs).refreshScope(
      sql`SELECT unnest(ARRAY[${sql.join(salesOrderIds.map((id) => sql`${id}::uuid`), sql`, `)}])`,
      now,
      tx,
    );
  }

  async function targets(tx: DbTx, base: { warehouseId: string }) {
    return (
      await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.warehouseId, base.warehouseId))
    ).filter((s) => s.status === 'draft');
  }

  it('송장이 살아 있으면 check false·지문에 ACTIVE_INVOICE, 송장을 취소하면 지문이 바뀌고 check true', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation, rule } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      const before = await rule.fingerprint(p.first.shipment.id, tx);
      expect(before).toContain('ACTIVE_INVOICE');
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);

      await p.voidWaybill();

      expect(await rule.fingerprint(p.first.shipment.id, tx)).not.toBe(before);
      expect(await rule.check(p.first.shipment.id, tx)).toBe(true);
    });
  });

  it('act: 재개해 끝내면 acted(원본 대체·대상 상자 1개), 같은 작업의 다른 원본으로 다시 부르면 noop', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation, rule } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();

      expect(await rule.act(p.first.shipment.id, tx)).toBe('acted');
      expect(await rule.act(p.second.shipment.id, tx)).toBe('noop');

      const sources = await tx
        .select({ status: wmsTables.shipments.status })
        .from(wmsTables.shipments)
        .where(inArray(wmsTables.shipments.id, [p.first.shipment.id, p.second.shipment.id]));
      expect(sources.map((s) => s.status)).toEqual(['superseded', 'superseded']);
      expect(await targets(tx, p.base)).toHaveLength(1);
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
    });
  });

  it('정비 모드면 check false — 일시적 막힘은 시도로 세지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { w, consolidation } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      const { rule } = wire('maintenance');
      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
    });
  });

  it('투영 → 러너 → 규칙 끝까지: 관찰 모드는 두 원본에 would_act 만 남기고, 실행 모드는 한 번만 합포장한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, consolidation, rule, runner } = wire();
      expect(rule.mode).toBe('observe');
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      const now = new Date('2099-06-01T00:00:00.000Z');
      await project(tx, dbs, [p.first.salesOrderId, p.second.salesOrderId], now);

      const ours = async () =>
        (await tx.select().from(wmsTables.shipmentReconcileState))
          .filter((r) => r.shipmentId === p.first.shipment.id || r.shipmentId === p.second.shipment.id)
          .map((r) => r.lastResult)
          .sort();

      await runner.runRule(rule, now, tx);
      expect(await ours()).toEqual(['would_act', 'would_act']);
      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBe(p.operationId);

      // 10분 뒤 다시 볼 때가 된다. 먼저 온 원본이 재개해 끝내고, 다른 원본은 대체돼 게이트에서 걸러진다
      await runner.runRule(acting(rule), new Date('2099-06-01T00:11:00.000Z'), tx);
      expect(await ours()).toEqual(['acted', 'not_needed']);
      expect(await targets(tx, p.base)).toHaveLength(1);
    });
  });

  it('형제 원본의 주문이 셀메이트로 출고되면 실행 모드여도 합포장하지 않는다(D16 은 원본 전부에 건다)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { dbs, w, consolidation, rule, runner } = wire();
      const p = await pendingConsolidationBlockedByWaybill(tx, w, consolidation);
      await p.voidWaybill();
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'shipped' })
        .where(eq(wmsTables.salesOrders.id, p.second.salesOrderId));
      const now = new Date('2099-06-01T00:00:00.000Z');
      await project(tx, dbs, [p.first.salesOrderId, p.second.salesOrderId], now);

      expect(await rule.check(p.first.shipment.id, tx)).toBe(false);
      await runner.runRule(acting(rule), now, tx);

      expect(await consolidation.findPendingOperationIdForSource(p.first.shipment.id, tx)).toBe(p.operationId);
      expect(await targets(tx, p.base)).toHaveLength(0);
    });
  });
});
```



- [ ] **Step 2: 실패 확인**

Run: `npx jest apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.spec.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 규칙 구현**

`rules/resume-pending-consolidation.rule.ts`:

```ts
// apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.ts
import { Injectable } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { OrderProgressReader } from '../../order-progress/order-progress.reader';
import { ConsolidationResumeReadiness, ConsolidationService } from '../../services/consolidation.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { ReconcileActResult, ShipmentReconcileRule, ShipmentReconcileSituation } from '../order-reconcile.rule';
import { ReconcileMode } from '../order-reconcile.state';
import { shipmentInSituation } from '../order-reconcile.subject';

/**
 * #1016 25번 행: 송장 등으로 막혀 CONSOLIDATION_PENDING 으로 멈춘 합포장을, 막힘이 풀린 뒤 재개한다.
 * 재개 신호는 «작업 항목이 배치에서 빠짐»(excludeShipment) 하나뿐이라 송장 취소·회수로 풀린 경우는 영영 멈춰 있었다 —
 * 그 경로들에 재개를 더하지 않고 여기서 보장한다(스펙 D4). 첫 «상자 대상» 규칙이다(D20).
 */
@Injectable()
export class ResumePendingConsolidationRule implements ShipmentReconcileRule {
  readonly name = 'resume-pending-consolidation';
  readonly row = 25;
  readonly subject = 'shipment' as const;
  // 관찰로 배포해 거짓 양성 0건을 확인한 뒤 실행으로 바꾼다(스펙 D5·§7)
  readonly mode: ReconcileMode = 'observe';
  readonly situation: ShipmentReconcileSituation = { stage: 'pick', states: ['CONSOLIDATION_PENDING'] };

  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly progress: OrderProgressReader,
  ) {}

  async fingerprint(shipmentId: string, tx: DbTx): Promise<string> {
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return 'none';
    const readiness = await this.consolidation.resumeReadiness(operationId, tx);
    return readiness ? readinessFingerprint(readiness) : `${operationId}|not_pending`;
  }

  async check(shipmentId: string, tx: DbTx): Promise<boolean> {
    // 정비 모드는 몇 시간 이어질 수 있다 — 시도로 세면 포기가 잘못 찍힌다(§4.4-5)
    if (!this.workflowGate.allowsOperationalMutations()) return false;
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return false;
    const readiness = await this.consolidation.resumeReadiness(operationId, tx);
    if (!readiness || readiness.blockers.length > 0) return false;
    // 재개는 원본 전부를 한꺼번에 바꾼다. 틀의 게이트는 후보 상자 하나만 보므로, 형제 원본의 주문이 셀메이트 출고·채널 취소
    // 요청·반품 중이면 여기서 멈춘다 — 같은 판정(judgeShipment)과 같은 순수 함수(D16)를 원본마다 부른다
    const now = new Date();
    for (const source of readiness.sources) {
      if (!shipmentInSituation(this.situation, await this.progress.judgeShipment(source.shipmentId, now, tx))) return false;
    }
    return true;
  }

  /** 막힘이 남았거나(그새 새 송장) 이미 끝났으면(같은 작업의 다른 원본이 먼저 재개) noop — 시도로 세지 않는다(D13) */
  async act(shipmentId: string, tx: DbTx): Promise<ReconcileActResult> {
    const operationId = await this.consolidation.findPendingOperationIdForSource(shipmentId, tx);
    if (!operationId) return 'noop';
    return (await this.consolidation.tryResumePending(operationId, tx)) === 'completed' ? 'acted' : 'noop';
  }
}

/** 재개를 막거나 바꿀 수 있는 것 전부 — 운영자가 송장을 취소하거나 박스를 빼면 바뀌어 횟수·포기가 리셋된다. 순서에 흔들리지 않는다 */
export function readinessFingerprint(r: ConsolidationResumeReadiness): string {
  const sources = r.sources
    .map((s) => `${s.shipmentId}:${s.status}:${s.recoveryCode ?? ''}:${s.manifestVersion}:${s.reservationVersion}`)
    .sort();
  const blockers = r.blockers.map((b) => `${b.shipmentId}:${[...b.codes].sort().join('+')}`).sort();
  return `${r.operationId}|${sources.join(',')}|${blockers.join(',')}`;
}
```

- [ ] **Step 4: 등록**

`order-reconcile.registry.ts`:

```ts
import { ResumePendingConsolidationRule } from './rules/resume-pending-consolidation.rule';
…
export const ORDER_RECONCILE_RULE_CLASSES: Type<ReconcileRule>[] = [
  WakeAwaitingMatchingRule, // #1016 12번
  ResumePendingConsolidationRule, // #1016 25번
];
```

`order-reconcile.module.ts` 의 imports 에 `FulfillmentModule` 을 더한다(`import { FulfillmentModule } from '../fulfillment.module';`). `ConsolidationService` 는 Task 7 에서 export 됐다. `FulfillmentWorkflowGate` 는 기존 `FulfillmentOrderCreationBacklogModule` 에서, `OrderProgressReader` 는 기존 `OrderProgressModule` 에서 온다.

- [ ] **Step 5: 통과 확인**

Run: `npm run type-check && npx jest apps/core/src/modules/fulfillment/order-reconcile`
Expected: 0 / PASS

Run (임시 DB): `… npx jest --runInBand --runTestsByPath apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.integration.spec.ts`
Expected: 5 PASS

- [ ] **Step 6: core 부팅 — DI 가 풀리는지**

로컬 인프라가 떠 있는 상태에서(`npm run bootstrap:e2e:local`):

Run: `npm run start:main:dev` 을 띄우고 로그에 `Nest application successfully started` 가 나오고 `Nest can't resolve dependencies` 가 없는지 본다. 1~2분 기다려 `order-reconcile` 로그가 예외 없이 지나가는지(후보가 없으면 줄이 안 찍히는 게 정상) 본 뒤 끈다.
Expected: 부팅 성공. `FulfillmentModule` 을 import 하며 순환이 생기면 여기서 드러난다 — 생기면 멈추고 보고한다

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/fulfillment/order-reconcile/
git commit -m "feat(core): #1016 25번 — 막힘이 풀린 대기 중 합포장을 리컨실러가 재개한다(관찰 모드)"
```

---

### Task 9: 스펙 갱신 · 전체 게이트 · PR

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-order-reconciler-design.md`

- [ ] **Step 1: 스펙에 25번과 «한 걸음 더 간 결정»을 옮긴다**

1. §11.4-1 의 «진행 중 주문 범위» 뒤에 한 문장: «범위는 진행 중 주문과 그 주문과 상자를 나눈 주문이다 — 투영에서 종료된(셀메이트 출고) 주문이 합포장 상자에 같이 있어도 그 주문을 판정해야 D16 제외가 걸린다(`openShipmentScopeSql`).»
2. D17 행 뒤(표 아래)에 한 줄: «구현은 저장소 클래스 둘(`OrderReconcileRepository`·`ShipmentReconcileRepository`)과 러너의 대상 종류별 포트다. 상자 테이블엔 `(rule, next_check_at)` 인덱스를 두지 않는다 — 상자 후보는 판정에서 고른 id 로 PK 를 찾는다.»
3. §11.7 앞에 새 절:

```markdown
### 11.8 25번 규칙 `resume-pending-consolidation` (2026-10-10)

합포장(`consolidate`)은 원본 상자에 살아 있는 송장·작업 항목·집은 몫·발송 시도가 있으면 원본을 `recovery_required` +
`CONSOLIDATION_PENDING` 으로 두고 작업을 `pending` 으로 남긴다. 재개(`resumePending`)를 부르는 곳은 «작업 항목이 배치에서 빠짐»
(`excludeShipment`·박스 반환) 하나뿐이라, 송장 취소로 풀린 경우는 영영 멈춘다.

| 항목 | 내용 |
| --- | --- |
| `row` / `subject` / `mode` | 25 / `shipment` / `observe` (첫 배포) |
| `situation` | `pick` / `CONSOLIDATION_PENDING` (상자별 판정) |
| `fingerprint` | 대기 중 작업 id + 원본마다 상태·recovery_code·버전 + 막힘 코드(정렬). 작업이 없으면 `none` |
| `check` | ① 정비 모드면 false ② 이 상자를 원본으로 둔 대기 중 작업 ③ `resumeReadiness` 의 막힘 0(`resumePending` 이 쓰는 `collectBlockers` 그대로) ④ **원본 상자 전부**가 지금 상자 판정으로 칸 안 |
| `act` | `tryResumePending` — `completed` 만 `acted`, 나머지는 `noop` |

④가 있는 이유: 재개는 원본 전부를 바꾸는데 틀의 게이트(D12·D16)는 후보 상자 하나만 본다. 형제 원본의 주문이 셀메이트로
출고됐으면 그 원본까지 합포장해 유령 예약을 만든다(§1.3 과 같은 꼴). 규칙이 판정을 다시 구현하지 않고 같은 `judgeShipment` 와
같은 순수 함수 `shipmentInSituation` 을 원본마다 부른다.

같은 작업의 원본이 둘 다 후보로 오면 먼저 온 쪽이 재개해 끝내고, 다른 쪽은 대체(`superseded`)돼 게이트에서 걸러진다.
관찰 기간의 `would_act` 는 원본 수만큼 나온다 — 작업 단위로 세려면 아래 SQL 의 `operation_id` 로 묶는다.

관찰 SQL:

    SELECT s.shipment_id, s.last_result, s.fingerprint, s.updated_at,
           sh.status, sh.recovery_code, m.operation_id
      FROM shipment_reconcile_state s
      JOIN shipments sh ON sh.id = s.shipment_id
      LEFT JOIN shipment_operation_members m ON m.shipment_id = s.shipment_id AND m.role = 'source'
      LEFT JOIN shipment_operations op ON op.id = m.operation_id AND op.type = 'consolidate' AND op.status = 'pending'
     WHERE s.rule = 'resume-pending-consolidation' AND s.last_result = 'would_act'
     ORDER BY s.updated_at DESC;
```

- [ ] **Step 2: 전체 게이트**

Run: `npm run type-check`
Expected: 0

Run: `npx jest --maxWorkers=2`
Expected: 실패 0

Run (임시 DB, 이 PR 이 건드린 통합 스펙 전부):
```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/core_row25_it npx jest --runInBand --runTestsByPath \
  apps/core/src/modules/fulfillment/order-progress/order-progress.judge.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.judge-shipments.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.refresh.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-progress/order-progress.board.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.repository.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/shipment-reconcile.repository.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/order-reconcile.runner.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/rules/wake-awaiting-matching.rule.integration.spec.ts \
  apps/core/src/modules/fulfillment/order-reconcile/rules/resume-pending-consolidation.rule.integration.spec.ts \
  apps/core/src/modules/fulfillment/services/consolidation.integration.spec.ts
```
Expected: 전부 PASS. 실패가 있으면 `git stash` 로 develop 상태에서 같은 스펙이 원래 실패하는지 확인하고, 원래 실패면 PR 본문에 «기존 RED» 로 적는다(고치지 않는다)

Run: `npm run lint`
Expected: 이 PR 이 건드린 파일에 에러 0

- [ ] **Step 3: Commit · push · PR**

```bash
git add docs/superpowers/specs/2026-10-08-order-reconciler-design.md
git commit -m "docs: 리컨실러 25번 규칙과 상자 판정 범위·저장소 결정을 스펙에 옮긴다 (#1016)"
git push -u origin feat/1016-row25-consolidation-reconcile
```

PR(develop 대상) 본문에 반드시 넣는다:
- 마이그 1건 additive → **`db:migrate` → `sst deploy`** 순서와 그 이유(먼저 배포하면 정체 보드 요약 API 500)
- 25번은 관찰 모드 — 실행 전환은 관찰 뒤 별도 PR
- 스펙에서 한 걸음 더 간 결정 4개(위 절)
- 게이트 결과(type-check·jest·통합 스펙 목록)

---

## 배포 (PR 머지 뒤, 사람이 한다)

1. **배포 전 라이브 실측(읽기 전용)** — 기대치를 적어 두고 관찰 결과와 비교한다:

```sql
SELECT count(*) FROM shipments WHERE status = 'recovery_required' AND recovery_code = 'CONSOLIDATION_PENDING';
SELECT count(*) FROM shipment_operations WHERE type = 'consolidate' AND status = 'pending';
```

   그리고 상자 판정 한 번의 시간을 잰다 — 리컨실러는 1분마다 이걸 한 번 돈다(투영 갱신과 별도). scratchpad 에서
   `new PgDialect().sqlToQuery(judgedShipmentsSql(openShipmentScopeSql(), new Date().toISOString()))` 로 SQL 을 뽑아
   `BEGIN READ ONLY; EXPLAIN ANALYZE <sql>; ROLLBACK;` 로 돌린다. **5초를 넘으면 배포를 멈추고** 범위를 좁힐지 정한다.
2. `npm run db:migrate -- --stage live --deployment lcnine-services --yes` → `__drizzle_migrations` 가 한 행 늘었고 `shipment_reconcile_state` 가 있는지 직접 본다
3. `sst deploy` → Core 태스크 정의 번호가 올랐는지 ECS 에서 직접 본다(«배포했다»는 말만 믿지 않는다)
4. 관찰: Core 로그에 `resume-pending-consolidation(#25, observe)` 줄과 `gated` 값, 위 §11.8 관찰 SQL. 라이브에 대기 중 합포장이 0건이면 `would_act` 도 0 이 정상이다 — 그 경우 근거는 «엉뚱한 상자를 안 고른다»(로그에 줄이 없음)까지이고, «제대로 재개한다»는 Task 8 의 통합 테스트가 증명한다
5. #1016 25번 행의 해결·문서 칸 갱신, 운영 작업 체크박스 «25번 관찰 → 실행 전환» 추가
