# 컷오버: 셀메이트 시기 자사몰 잔재 닫기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 드레인이 끝난 뒤 한 번 돌리는 dry-run 기본 스크립트로, 셀메이트로 나간 자사몰 주문(판매주문 `shipped`·`delivered`)의 열린 출고주문·상자·예약·대기열 행을 기존 스크립트 문장과 도메인 명령으로 닫고, 취소 주문은 대기열만 닫는다.

**Architecture:** 주문마다 무엇을 할지는 순수 함수(`classifyLeftover`)가 정한다. 상자·예약 종결 SQL 은 `close-shipped-shipments.ts` 에서 문장 목록으로 떼어 내 그 CLI 와 새 스크립트가 같이 쓰고, 새 스크립트는 임시 표 `leftover_scope` 로 대상 주문에 좁힌 CTE 를 넘긴다. 한 묶음(판매주문 200개)이 한 drizzle 트랜잭션이고, dry-run 은 같은 경로를 돌린 뒤 롤백해 정확한 건수를 낸다.

**Tech Stack:** TypeScript · tsx · drizzle-orm(postgres-js) · jest

**Spec:** `docs/superpowers/specs/2026-11-17-cutover-close-sellmate-leftovers-design.md`

## Global Constraints

- 대상은 `sales_orders.sales_channel = 'medusa'` 만. 시각으로 자르지 않는다 — 판매주문 상태만 본다.
- 상태를 바꾸는 **새** SQL 을 쓰지 않는다. 쓰는 것: `scripts/ops/cellmate-local/mark-core-shipped.sql.js` 의 `MARK_FULFILLMENT_ORDERS_SHIPPED`·`MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED`, `close-shipped-shipments.ts` 에서 떼어 낸 종결 문장, `FulfillmentOrderCreationBacklogService.closeOpenForSalesOrder`, `markLineStateDirty`, `ProductSellableQuantityService.recalculateAndPublishForSkus`.
- 기본 dry-run, `--apply` 일 때만 커밋. `DATABASE_URL`(테넌트 1 core DB) 필수.
- 묶음 크기 200(판매주문). 묶음마다 한 트랜잭션: FO → 상자·예약 → 대기열 → `markLineStateDirty`.
- 보고 목록 기본 경로 `apps/core/tmp/cutover-1243-report-<YYYYMMDDHHmmss>.txt`(`.gitignore` 의 `tmp/` 에 걸린다). 주문 식별자가 들어가므로 커밋하지 않는다.
- `close-shipped-shipments.ts` CLI 의 동작은 바꾸지 않는다(같은 문장, 같은 순서, 같은 출력).
- 전체 `npm run type-check`·`npx jest` 는 PR 을 ready 로 바꾸기 직전 한 번만, `--maxWorkers=2` 로(Task 4). E2E 스택이 떠 있으면 돌리지 않는다.
- 코드 주석·커밋 메시지는 한국어. 커밋 끝에 `Claude-Session: https://claude.ai/code/session_01LKjrK51xEAX1NWhyEqYPJT`.

## Review Focus

1. 합배송 상자 — 한 상자에 외부 출고 주문의 FO 와 앱이 출고할(`confirmed`) 주문의 FO 가 섞였다 → 상자를 닫지 않는다 → Task 3 테스트 «섞인 상자는 그대로».
2. 판매주문은 `shipped` 인데 FO 가 아예 없고 대기열만 `awaiting_matching` → 대기열만 닫힌다 → Task 3 테스트.
3. 상자가 `recovery_required`(집은 물건이 있을 수 있다) → 닫지 않고 보고 → Task 3 테스트.
4. 같은 입력으로 `--apply` 두 번 → 두 번째는 모든 건수 0 → Task 3 테스트.
5. `sellmate_handed_over_orders` 가 비었다(init 전 리허설) → «드레인 미완료»는 `null`(«집합 없음»), 실행은 계속 → Task 3 테스트.

---

### Task 1: 주문별 처리 판정 `classifyLeftover`

**Files:**
- Create: `scripts/sellmate/leftovers-plan.ts`
- Test: `scripts/sellmate/leftovers-plan.spec.ts`

**Interfaces:**
- Produces:
```ts
export type LeftoverOrder = {
  salesOrderId: string;
  channelOrderId: string;
  salesChannel: string;                 // 'medusa' | 'naver' | 'coupang' | '3pl'
  soStatus: string;                     // order_status
  foStatus: string | null;              // fulfillment_status, FO 없으면 null (판매주문:FO = 0..1)
  openBacklogs: number;                 // pending·failed·processing·awaiting_matching
  openShipments: number;                // draft·planned·recovery_required 상자
};
export type LeftoverAction = {
  closeFo: boolean;          // MARK_* 두 문장
  closeShipments: boolean;   // leftover_scope 에 넣는다
  closeBacklogs: boolean;    // closeOpenForSalesOrder
  report: null | 'human-fo' | 'cancelled-open';
};
export function classifyLeftover(o: LeftoverOrder): LeftoverAction;
export const FO_CLOSABLE: readonly string[];   // ['created','partially_reserved','ready']
export const FO_HUMAN: readonly string[];      // ['processing','partially_shipped','recovery_required']
```

- [ ] **Step 1: 실패하는 테스트** — `it.each` 표(기본: medusa·`shipped`·FO `ready`·backlog 1·상자 1):
  - 기본 → `{closeFo:true, closeShipments:true, closeBacklogs:true, report:null}`
  - `soStatus 'delivered'` → 기본과 같음
  - `foStatus null`, `openShipments 0` → `{closeFo:false, closeShipments:false, closeBacklogs:true, report:null}`
  - `foStatus 'shipped'`(이미 닫힘), backlog 0, 상자 1 → `{closeFo:false, closeShipments:true, closeBacklogs:false, report:null}`
  - `foStatus` 가 `processing`·`partially_shipped`·`recovery_required` 각각 → 전부 false, `report 'human-fo'`
  - `salesChannel 'naver'` → 전부 false, `report null`
  - `soStatus 'confirmed'`·`'pending'` → 전부 false, `report null`
  - `soStatus 'cancelled'`, FO `ready`, backlog 1, 상자 1 → `{closeFo:false, closeShipments:false, closeBacklogs:true, report:'cancelled-open'}`
  - `soStatus 'cancelled'`, FO `canceled`, backlog 1, 상자 0 → `{closeBacklogs:true, report:null, 나머지 false}`
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/leftovers-plan.spec.ts` / FAIL
- [ ] **Step 3: 구현** — 위 표 그대로. 취소 주문의 «열림» = FO 가 terminal(`shipped`·`completed`·`canceled`) 아님 또는 `openShipments > 0`.
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: 커밋** — `[scripts] 셀메이트 시기 잔재 주문별 처리 판정 (#1243)`

### Task 2: `close-shipped-shipments` 종결 문장을 떼어 낸다

**Files:**
- Modify: `scripts/sellmate/close-shipped-shipments.ts`
- Test: `scripts/sellmate/close-shipped-shipments.spec.ts` (새 파일)

**Interfaces:**
- Produces:
```ts
export const CLOSEOUT_CTE: string;                       // 지금 값 그대로
export const SCOPED_CLOSEOUT_CTE: string;                // 임시 표 leftover_scope(sales_order_id uuid) 를 참조
export function closeoutStatements(cte: string): string[];
// 순서: CREATE TEMP TABLE closeout … AS <cte> → CREATE TEMP TABLE closeout_reservation … →
//       UPDATE shipments → UPDATE stock_reservations → UPDATE shipment_lines → UPDATE fulfillment_order_items → UPDATE fulfillment_orders
```
- `SCOPED_CLOSEOUT_CTE` 의 조건: `s.status IN ('draft','planned')`(`recovery_required` 는 빼고 보고로 돌린다), 진행 중 작업 항목(`outbound_batch_work_items.shipment_id = s.id AND status NOT IN ('excluded','completed')`)이 없는 상자, `HAVING bool_and(fo.sales_order_id IN (SELECT sales_order_id FROM leftover_scope) AND fo.status IN ('shipped','completed','canceled'))`. `new_status` 식은 `CLOSEOUT_CTE` 와 같게.

- [ ] **Step 1: 실패하는 테스트** — `closeoutStatements(CLOSEOUT_CTE)` 길이 7, [0] 이 `CREATE TEMP TABLE closeout ON COMMIT DROP AS` 로 시작하고 `CLOSEOUT_CTE` 를 담는다, `UPDATE shipments` 의 위치 < `UPDATE stock_reservations` 의 위치(상자 먼저 — 파일 머리 주석의 이유). `SCOPED_CLOSEOUT_CTE` 에 `leftover_scope`·`outbound_batch_work_items` 가 있고 `recovery_required` 가 없다.
- [ ] **Step 2: 실패 확인** — `npx jest scripts/sellmate/close-shipped-shipments.spec.ts` / FAIL
- [ ] **Step 3: 구현** — `main()` 의 `sql.begin` 안 문장들을 `closeoutStatements(CLOSEOUT_CTE)` 를 차례로 `trx.unsafe` 하는 것으로 바꾼다. 맨 끝 `main().catch(…)` 를 `if (require.main === module)` 로 감싼다(import 할 때 돌면 안 된다). 머리 주석에 한 줄: «T 뒤에는 단독으로 돌리지 않는다 — 앱이 맡은 취소 주문의 상자를 도메인 경로 밖에서 닫는다. 드레인 끝 정리는 `close-sellmate-leftovers.ts` (#1243)».
- [ ] **Step 4: 통과 확인** — 같은 명령 / PASS
- [ ] **Step 5: 커밋** — `[scripts] close-shipped-shipments 종결 문장을 함수로 떼어 낸다 (#1243)`

### Task 3: 스크립트 `close-sellmate-leftovers.ts`

**Files:**
- Create: `scripts/sellmate/close-sellmate-leftovers.ts`
- Test: `scripts/sellmate/close-sellmate-leftovers.spec.ts` (`bindTextArrayParam` 단위)
- Test: `scripts/sellmate/close-sellmate-leftovers.integration.spec.ts` (`describeIfDb`)

**Interfaces:**
- Consumes: Task 1 `classifyLeftover`·`LeftoverOrder`; Task 2 `SCOPED_CLOSEOUT_CTE`·`closeoutStatements`; `FulfillmentOrderCreationBacklogService.closeOpenForSalesOrder(salesOrderId, tx)`; `markLineStateDirty(tx, salesOrderIds)` (`apps/core/src/modules/sales-order/line-reservation-state/line-state-dirty.ts`); `ProductSellableQuantityService.recalculateAndPublishForSkus(skuIds)`
- Produces:
```ts
export function bindTextArrayParam(text: string, ids: readonly string[]): SQL;   // '$1::text[]' 자리마다 drizzle 파라미터
export type LeftoverReport = {
  closedFo: number; closedShipments: number; releasedReservations: number; closedBacklogs: number;
  releasedSkuIds: string[];
  humanFo: string[];               // channel_order_id
  cancelledOpen: string[];
  recoveryShipments: string[];     // shipment id — 대상 주문의 recovery_required 상자
  activeWorkShipments: string[];   // shipment id — 진행 중 작업 항목이 걸린 대상 주문 상자
  drainIncomplete: number | null;  // null = sellmate_handed_over_orders 가 비었다
};
export async function runLeftoverClose(
  dbService: DbService<typeof wmsSchema>,
  deps: {
    backlog: Pick<FulfillmentOrderCreationBacklogService, 'closeOpenForSalesOrder'>;
    sellable: Pick<ProductSellableQuantityService, 'recalculateAndPublishForSkus'>;
  },
  opts: { apply: boolean },
): Promise<LeftoverReport>;
```

- [ ] **Step 1: 단위 테스트** — `bindTextArrayParam('a=any($1::text[]) and b=any($1::text[])', ['x','y'])` 를 `PgDialect().sqlToQuery` 로 돌리면 파라미터 2개(`['x','y']` 둘) 이고 `$1::text[]` 문자열이 남지 않는다; 자리가 없는 문장이면 throw.
- [ ] **Step 2: 통합 테스트 작성** — 머리 주석에 실행 명령(`COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'close-sellmate-leftovers\.integration\.spec\.ts$'`). `makeDb`·`inRollbackTx`(`apps/core/src/modules/fulfillment/services/__support__`), `dbServiceFor(tx as Database)`(`inbound-harness.ts`), 시드는 `apps/core/src/modules/fulfillment/order-progress/__support__/order-progress.fixtures.ts` 의 `seedWorld`·`seedOrder`·`seedFo`·`seedBox`·`seedFullReservations`·`seedBacklog`·`seedWorkItem`. `deps.sellable` 은 호출 인자를 모으는 가짜. 마켓 주문은 `seedOrder` 뒤 `sales_channel` 을 `'naver'` 로 UPDATE. 넘긴 주문은 `sellmate_reconcile_runs`(kind `'init'`, status `'applied'`, `input_sha256` 랜덤 64자, `input_snapshot_at` now) 한 행 뒤 `sellmate_handed_over_orders` insert. 테스트:
  - «외부 출고 주문을 닫는다»: `shipped` 주문 + FO `ready` + `draft` 상자 + 확정 예약 + `awaiting_matching` 대기열 → `apply` 후 FO `shipped`, FOI `shipped_qty = qty`, 상자 `shipped`, 예약 `released`, 대기열 `not_required`, `sales_order_line_state_marks` 에 그 판매주문 행, `deps.sellable` 이 그 SKU 로 불림, 보고 건수 각 1
  - «dry-run 은 건수만»: 같은 시드, `apply false` → 보고 건수는 위와 같고 DB 는 그대로, `deps.sellable` 안 불림
  - «다시 돌려도 0»: `apply` 두 번 → 두 번째 보고의 건수 전부 0
  - «앱 주문·마켓 주문은 그대로»: `confirmed` 주문(FO `ready`, 상자 `draft`)과 `naver`·`shipped` 주문 → 아무것도 안 바뀜
  - «FO 없이 대기열만»: `shipped`, FO 없음, `awaiting_matching` → 대기열만 `not_required`
  - «취소 주문은 대기열만»: `cancelled` + FO `ready` + `draft` 상자 + `pending` 대기열 → 대기열 `not_required`, FO·상자 그대로, `cancelledOpen` 에 그 주문
  - «사람이 볼 FO»: `shipped` + FO `processing` → 그대로, `humanFo` 에 그 주문
  - «섞인 상자는 그대로»: 한 상자에 `shipped` 주문 FO 항목과 `confirmed` 주문 FO 항목 → 상자 `draft` 그대로, 그 상자의 예약 그대로
  - «진행 중 작업 항목»: 대상 상자에 `seedWorkItem(status 'picking')` → 상자 그대로, `activeWorkShipments` 에 그 상자
  - «recovery_required 상자»: 대상 주문의 상자 `recovery_required` → 그대로, `recoveryShipments` 에 그 상자
  - «드레인 미완료»: 넘긴 주문 둘(`shipped` 하나, `confirmed` 하나) → `drainIncomplete 1`; 넘긴 주문 표가 비었으면 `null`
- [ ] **Step 3: 실패 확인** — 단위·통합 명령 / FAIL
- [ ] **Step 4: 구현** — `runLeftoverClose`:
  - 후보 읽기: 자사몰 판매주문 중 상태 `shipped`·`delivered`·`cancelled` 이면서 (FO 가 terminal 아님 OR 열린 대기열 > 0 OR 열린 상자 > 0) 인 것의 `LeftoverOrder` 행. 열린 것이 없는 주문은 안 읽힌다 — 그게 멱등이다.
  - `classifyLeftover` → 200개씩 묶어 `dbService.run(async tx => …)`: ① `closeFo` 주문의 `channel_order_id` 로 `MARK_FULFILLMENT_ORDERS_SHIPPED` → `MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED`(`bindTextArrayParam`, `rowCount` 합산) ② `CREATE TEMP TABLE leftover_scope (sales_order_id uuid) ON COMMIT DROP` + `INSERT … SELECT unnest(${ids}::uuid[])`(`closeShipments` 주문) → 보고용으로 그 범위의 `recovery_required` 상자·진행 중 작업 항목 상자 id 를 먼저 읽고 → `closeoutStatements(SCOPED_CLOSEOUT_CTE)` 를 차례로 `tx.execute(sql.raw(…))` → `closeout` 행 수, `closeout_reservation` 행 수와 `DISTINCT sku_id` 를 읽는다 ③ `closeBacklogs` 주문마다 `deps.backlog.closeOpenForSalesOrder(id, tx)` ④ 손댄 주문 전부 `markLineStateDirty(tx, ids)` ⑤ dry-run 이면 묶음 끝에서 `class DryRunRollback extends Error` 를 던져 롤백하고 바깥에서 잡는다(건수는 던지기 전에 모아 둔다).
  - 묶음이 끝나면 `apply` 일 때만 `releasedSkuIds` 를 200개씩 `deps.sellable.recalculateAndPublishForSkus`.
  - `drainIncomplete`: `sellmate_handed_over_orders` 행이 0 이면 `null`, 아니면 그 판매주문 중 상태가 `shipped`·`delivered`·`cancelled` 아닌 수.
  - CLI `main()`(`require.main === module`): `close-sellmate-csv-inbound.ts` 와 같은 방식으로 `DbService` 를 세우고, `new FulfillmentOrderCreationBacklogService(dbService, unused('FulfillmentWorkflowGate'))`(그 파일의 `unusedByShortCloseLine` 꼴 Proxy — `closeOpenForSalesOrder` 는 gate 를 안 쓴다), `ProductSellableQuantityService`(outbox `outboxPublisherFor(INVENTORY_STREAM, …)`). 요약 출력(단계별 건수, 보고 항목 수, `drainIncomplete` — `null` 이면 «넘긴 주문 집합 없음(init 전)», 0 이 아니면 «드레인이 덜 끝났다 — 끝난 뒤 다시 돌린다»), 보고 목록 파일 쓰기.
  - 머리 주석: 무엇·왜(설계 §1·§4), 실행 시점(드레인 끝, `mark-shipped-from-csv`·`mark-core-shipped`·`mark-medusa-shipped` 뒤), «T 뒤엔 `close-shipped-shipments` 를 단독으로 돌리지 않는다», 실행 예 `bash scripts/sellmate/run.sh live close-sellmate-leftovers` → 숫자 확인 → `--apply`.
- [ ] **Step 5: 통과 확인** — 단위·통합 명령 / PASS
- [ ] **Step 6: 커밋** — `[scripts] 컷오버: 셀메이트 시기 자사몰 잔재를 닫는 스크립트 (#1243)`

### Task 4: 판정 스크립트 문구 · 런북 · PR 직전 검증

**Files:**
- Modify: `scripts/ops/cutover-preflight/checks/outbound.ts` («출고 6» `r.dayOf` 의 fix 문구, 165행 부근)
- 이슈 본문: #1233 «당일 순서» 4번, #1251(런북) — 코드 아님

- [ ] **Step 1: 문구 고치기** — fix 를 `'드레인 끝에 bash scripts/sellmate/run.sh live close-sellmate-leftovers 후 --apply (#1243)'` 로. «출고 4» 유령 예약 `r.bad` 의 fix 에도 «드레인 끝이면 close-sellmate-leftovers (#1243)»를 덧붙인다.
- [ ] **Step 2: 커밋** — `[scripts] 컷오버 판정: 잔재 닫기 명령을 안내한다 (#1243)`
- [ ] **Step 3: 이슈 본문** — #1233 «당일 순서» 4: `close-shipped-shipments` 를 `close-sellmate-leftovers`(#1243)로 바꾸고 «T 뒤 `close-shipped-shipments` 단독 실행 금지»를 덧붙인다. #1251 본문에 실행 시점 한 줄(드레인 끝, mark 셋 뒤, dry-run → `--apply`, 완료 판정 = «드레인 미완료» 0 + «출고 6» ◆ 0 + «출고 4» 유령 예약 0). 고치기 전에 지금 본문을 읽고, 바꾼 줄만 바꾼다.
- [ ] **Step 4: E2E 스택이 떠 있지 않은지 확인** — `docker ps --format '{{.Names}}' | grep -E 'kafka|postgres'`, `ss -ltn | grep -E ':(3000|9000|9092)\b'`. 떠 있으면 멈추고 사용자에게 묻는다.
- [ ] **Step 5: 전체 type-check** — `npm run type-check` / 에러 0
- [ ] **Step 6: 전체 jest** — `npx jest --maxWorkers=2` / 실패 0
- [ ] **Step 7: push** — 라이브 리허설 dry-run 은 사용자에게 터널을 부탁한 뒤 `bash scripts/sellmate/run.sh live close-sellmate-leftovers` (읽기 전용) — 건수를 PR 본문 Evidence 에 붙인다.
