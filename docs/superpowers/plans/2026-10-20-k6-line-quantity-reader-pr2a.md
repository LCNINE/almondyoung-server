# K6 PR 2a — 읽는 문 + SQL 조각 + 일치 spec, 취소 수량 소비자 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 라인의 취소 수량을 `sales_order_cancellation_lines`(PR 1) 한 곳에서만 읽게 한다. SQL 조각 한 벌과 그것을 select 하는 TS 문 하나를 두고, `metadata.cancelledLines` 를 직접 파싱하던 취소 수량 소비자 여섯을 그 문으로 옮긴다.

**Architecture:** 정의는 `line-quantities.sql.ts` 의 Drizzle `sql` 조각 둘(`lineCanceledQuantitySql`, `lineDemandSql`)뿐이다. TS 문 `readLineQuantities(trx, salesOrderId)` 는 `sales_order_lines` 를 그 조각들과 함께 select 해 라인별 판매 단위 수량 묶음을 돌려주고 TS 에서 산술을 하지 않는다. SQL 소비자(수요 통계·인쇄 보드)는 같은 조각을 끼워 넣는다. 주입 서비스가 아니라 `trx` 를 받는 함수로 둔다(`selectFrozenCompositions`·`recordSalesOrderCancellation` 의 본) — product-matching·print-order 가 sales-order 모듈을 DI 로 물지 않게.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js), Jest(유닛 + `describeIfDb` 통합), 소스 텍스트 가드 spec.

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§6.1 판매 단위 층, §6.2 취소 행, §6.3 읽는 문, §6.5, §9 2단계). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`. 앞선 계획: `docs/superpowers/plans/2026-10-20-k6-line-quantity-facts-pr1.md`.

**2a/2b 분할(사용자 2026-10-20):** 스펙 §9 2단계 중 이 PR 은 «읽는 문 + SQL 조각 + 일치 spec + 취소 수량 소비자»다. 진행 단계 순수 함수·관리자 뱃지·일별 통계·관리자 카드·고객 actions·셀메이트 F12(= 출고·배송 쪽 사실과 화면 숫자)는 2b 다. 그래서 이 PR 의 문은 **판매 단위 취소 층만** 낸다: `ordered`, `canceledBeforeShipment`, `canceledAfterShipment`, `canceled`, `demand`. SKU 층(`shipped`·`forwarded`·`delivered`·`cancellable`…)은 2b 가 같은 파일에 더한다.

## 2a 의 이름 붙은 동작 변경 (스펙 G5 — 사용자 확인 필요)

라이브 영향은 둘 다 **지금 0** 이다: 라이브 취소는 전부 V1·`before_shipment`(PR 1 백필 196주문·1,031행, `after_shipment` 0행)이고 V1 전체취소 주문은 SO `status='cancelled'` 라 아래 소비자들의 기존 가드에 먼저 걸린다.

- **E1. 전체취소도 센다(F6).** 옛 파서는 `scope='partial'` 만 셌다(구성 리더만 V2 전체의 `cancelledLines` 까지). 이제 모든 소비자가 V1·V2 전체취소의 라인 행을 센다. 바뀌는 곳: 채널 diff 의 «유효 수량», 인쇄 보드 «환불 안 열림», 수요 통계 — 전부 «전체취소됐지만 SO 가 `cancelled` 가 아닌» 주문(V2 전체 + 남은 출고분)에서만 달라진다.
- **E2. 수요와 FO 생성 수량은 «출고 전 취소»만 뺀다(스펙 §6.1 `demand = ordered − canceledBeforeShipment`).** 이미 나간 수량의 취소(V1 사후취소)는 물건이 창고를 떠났으므로 수요 통계에서 빼지 않는다. 구성 리더의 `fulfillableQuantity` 도 `demand` 다. 취소 엔진·채널 diff·인쇄의 «남은 수량»은 갈래 무관 `canceled` 를 뺀다(불변식 `취소 ≤ 주문`).

## Global Constraints

- 새 파일 위치: `apps/core/src/modules/sales-order/line-quantities/` (스펙 §6.3).
- 문은 `wmsTables` 만 읽으므로 `DbService<MergedSchema>` 목록에 더하지 않는다 — 함수가 호출자의 `trx: DbTx` 를 받는다(ADR-0025). 새 `inTx` 헬퍼 금지.
- 정의는 SQL 한 벌. TS 에서 `ordered − canceled` 같은 뺄셈을 다시 하지 않는다 — 필요한 값은 조각이 칼럼으로 낸다.
- 조각의 합계는 `::int` 로 캐스트한다(postgres `sum(integer)` 는 `bigint` 라 postgres.js 가 문자열로 준다).
- 옛 파서 처리: `cancelledQuantitySql`(파일째)·`getCancelledQuantityByLine`·`loadPriorPartialCancellationContext` 는 이 PR 에서 지운다(소비자가 0 이 되므로). `sumCancelledByLine` 은 남긴다 — 쓰기 문(`record-cancellation.ts`)의 백필 전 대비와 두 백필 스크립트가 쓴다. 지우는 건 PR 6(contract).
- `metadata.cancelledLines` 쓰기는 그대로(이중 기록 유지). 마이그레이션 없음.
- 통합 테스트는 스크래치 DB `k6_it` 에서 돈다: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 브랜치 시작 때 한 번 `DATABASE_URL=…/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`.
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/{sales-order,fulfillment,print-order,product-matching,inventory/replenishment}` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. «새 실패 0» 은 그 목록 대비다(PR 1 때 기준선 실패 2건: planning tombstone entrance password, waybill durable failed row).
- 금지: `any`, 근거 없는 `as`, 스펙 안 `dotenv.config()`, 가드 없는 DB 통합 스펙.
- 커밋 메시지는 한국어 `feat(sales-order): … (K6 PR2a)` 꼴. 시스템이 주는 attribution 줄이 있으면 끝에 붙인다.

## Review Focus

1. **전체취소 뒤 다시 취소 요청** — 옛 파서는 전체취소를 안 셌으므로 `planCancellation` 의 전체 갈래가 «남은 수량 0 → `no outstanding physical quantity`»로 먼저 끝나 문구가 `이미 전체 취소 처리된 주문입니다.` 에서 바뀔 수 있다. 문구는 그대로여야 한다. Task 2 `plan after a full cancellation keeps the full-exists message` 가 고정한다.
2. **백필 안 된 환경(로컬·dev DB)** — 라인 행이 없는 옛 취소는 문에 안 보인다. 코드로 덮지 않는다(ADR-0047 PR 2 착수 조건). 대신 배포 절차에 게이트 SQL 을 두고(아래 Task 6), 로컬은 백필 `--apply` 를 안내한다.
3. **출고 뒤 취소가 있는 라인의 FO 생성·수요** — `demand` 는 출고 후 취소를 빼지 않는다(E2). FO 는 출고 뒤에만 그런 취소가 생기므로 새 FO 수량에 영향이 없어야 하고, 수요 통계는 그 수량을 수요로 남겨야 한다. Task 4 `after-shipment cancellation stays in demand`, Task 5 `fulfillable excludes only before-shipment cancellations` 가 고정한다.
4. **세트 라인에서 구성품 하나만 나간 뒤 취소** — PR 1 규칙상 그 단위는 `after_shipment`. 문은 라인 행을 그대로 합할 뿐 재해석하지 않아야 한다. Task 1 일치 spec 의 `bundle with one shipped component` 시나리오가 고정한다.
5. **한 주문에 판매 라인 여럿·취소 여럿 + 취소 없는 라인** — 취소 없는 라인도 결과에 `canceled 0` 으로 나와야 한다(맵에 빠지면 소비자가 `?? 0` 으로 덮어 오류가 숨는다). Task 1 `lines without cancellations appear with zeros` 가 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts` (생성) | 정의 한 벌: `lineCanceledQuantitySql`, `lineDemandSql` |
| `apps/core/src/modules/sales-order/line-quantities/line-quantities.reader.ts` (생성) | TS 문 `readLineQuantities`, 타입 `LineQuantities` |
| `apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts` (생성) | 일치 spec |
| `apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts` (생성) | 읽기 가드 |
| `apps/core/src/modules/sales-order/cancellation-record/__support__/cancellation-scenarios.ts` (생성) | PR 1 통합 spec 의 `wire`·`seedOrder`·`seedShippedV1Fulfillment` 를 옮겨 공유 |
| `apps/core/src/modules/sales-order/services/sales-orders.service.ts` (수정) | 엔진 내부 읽기 전환, 옛 파서 둘 삭제, `planCancellation` 거절 순서 |
| `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts` (수정) | 유효 수량 = 문 |
| `apps/core/src/modules/print-order/services/print-cancel-remaining.reader.ts` (수정) | 남은 수량 = 문 |
| `apps/core/src/modules/print-order/services/print-order.reader.ts` (수정) | `refundNotOpenedSql` 이 조각 사용 |
| `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts` (수정) | 수요 = `lineDemandSql` |
| `apps/core/src/modules/sales-order/services/cancelled-quantity.sql.ts` (삭제) | |
| `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts` (수정) | `fulfillableQuantity` = `demand` |
| 취소를 raw INSERT 로 심는 spec 들(각 Task 에 나열) | 씨앗을 `recordSalesOrderCancellation` 경유로 |
| `docs/adr/0047-line-quantity-facts-one-record-one-reader.md` (수정) | 2a 결과·E1·E2 기록 |

---

### Task 1: SQL 조각 + TS 문 + 일치 spec

**Files:**
- Create: `apps/core/src/modules/sales-order/line-quantities/line-quantities.sql.ts`, `line-quantities.reader.ts`, `line-quantities.integration.spec.ts`
- Create: `apps/core/src/modules/sales-order/cancellation-record/__support__/cancellation-scenarios.ts`
- Modify: `apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts` (로컬 `wire`·`seedOrder`·`seedShippedV1Fulfillment` 를 위 support 에서 import)

**Interfaces:**
- Consumes: PR 1 `wmsTables.salesOrderCancellationLines`, `CancellationShipmentPhase`, `recordSalesOrderCancellation`.
- Produces:
  ```ts
  // line-quantities.sql.ts
  export function lineCanceledQuantitySql(
    salesOrderLineId: SQLWrapper,
    phase: CancellationShipmentPhase | 'any',
  ): SQL; // coalesce((select sum(quantity) from sales_order_cancellation_lines where sales_order_line_id = X [and shipment_phase = p]), 0)::int
  export function lineDemandSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL;
  // (lineQuantity − lineCanceledQuantitySql(id, 'before_shipment'))::int
  export function lineRemainingSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL;
  // (lineQuantity − lineCanceledQuantitySql(id, 'any'))::int — GREATEST 로 덮지 않는다(음수면 불변식 위반이 보여야 한다)

  // line-quantities.reader.ts
  export type LineQuantities = {
    salesOrderLineId: string;
    ordered: number;
    canceledBeforeShipment: number;
    canceledAfterShipment: number;
    canceled: number;   // 갈래 무관 합 — «남은 수량» 계산용
    demand: number;     // ordered − canceledBeforeShipment
    remaining: number;  // ordered − canceled — 더 취소할 수 있는 판매 단위의 상한
  };
  export function readLineQuantities(trx: DbTx, salesOrderId: string): Promise<Map<string, LineQuantities>>;
  // 그 주문의 모든 판매 라인이 키로 있다(취소 없는 라인도 0 으로). 칼럼은 전부 조각에서 select — TS 산술 없음.

  // cancellation-record/__support__/cancellation-scenarios.ts
  export function wireCancellation(tx: DbTx): { logistics: ReturnType<typeof wireLogistics>; salesOrders: SalesOrdersService };
  export function seedCancellableOrder(tx: DbTx, w: ReturnType<typeof wireCancellation>, quantity: number):
    Promise<{ salesOrderId: string; lineId: string; warehouseId: string; skuId: string }>;
  export function seedShippedV1Fulfillment(tx: DbTx, o: { salesOrderId: string; lineId: string; warehouseId: string; skuId: string }, qty: number): Promise<void>;
  ```
  support 는 PR 1 spec 의 세 함수를 이름만 바꿔 옮긴 것이다(본문 그대로). `__support__` 는 PR 1 쓰기 가드의 훑기 대상이 아니다.

- [ ] **Step 1: PR 1 spec 의 헬퍼를 support 로 옮기고 PR 1 spec 이 그대로 초록인지 본다.**
  Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/cancellation-record/record-cancellation.integration.spec.ts`
  Expected: PASS(옮기기 전과 같은 수).

- [ ] **Step 2: 실패하는 일치 spec 을 쓴다.** 각 시나리오는 실제 쓰기 경로(`salesOrders.cancel(...)`)로 만들고, 두 가지를 단언한다 — (가) `readLineQuantities` 결과가 아래 기대값과 같다, (나) 같은 결과를 **문을 거치지 않고** `trx.select({ id, ordered: sol.quantity, before: lineCanceledQuantitySql(sol.id,'before_shipment'), after: …, canceled: …'any', demand: lineDemandSql(sol.quantity, sol.id) }).from(sol).innerJoin(sales_orders …)` 처럼 다른 조인 모양으로 구해도 같다. 시나리오가 «전체취소 없음»이면 (다) 옛 정의(`sumCancelledByLine` 에 그 주문 partial 취소의 `metadata` 를 넣은 값)와 `canceled` 가 같다 — 소비자 전환이 동작을 안 바꾼다는 근거.
  기대값 표기 `{ordered, before, after, canceled, demand, remaining}`:
  - `no cancellations` — qty 3 → `{3,0,0,0,3,3}`; (다) 성립
  - `lines without cancellations appear with zeros` — 라인 둘(qty 2, qty 1), 첫 라인만 부분취소 1 → 둘째 라인 키가 있고 `{1,0,0,0,1,1}`
  - `repeated partial before shipment` — qty 3, 부분취소 1 두 번 → `{3,2,0,2,1,1}`; (다) 성립
  - `partial after shipment` — qty 3, `seedShippedV1Fulfillment(…,3)` 뒤 부분취소 1 → `{3,0,1,1,3,2}`; (다) 성립
  - `bundle with one shipped component` — 라인 qty 1, 매칭 SKU A×1·B×1, FO 의 A FOI 만 `shipped_qty=1` 로 표시 뒤 부분취소 1 → `{1,0,1,1,1,0}`
  - `v1 full after partial` — qty 3, 부분취소 1 → 전체취소 → `{3,3,0,3,0,0}`; (다)는 성립하지 **않음**을 단언한다(옛 정의 1 ≠ 새 정의 3 — E1 을 문서화하는 단언)
  - `v2 full with digital line` — PR 1 `v2 full writes outstanding lines` 와 같은 상자 시나리오에 디지털 라인(qty 1)을 더해 전체취소 → 물리 라인 `canceled = outstanding`, 디지털 라인 `{1,1,0,1,0,0}`
- [ ] **Step 3:** Run: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 4:** `line-quantities.sql.ts`·`line-quantities.reader.ts` 를 위 Interfaces 대로 구현한다. 문은 `sales_order_lines where sales_order_id = ?` 를 `id` 순으로 select 해 Map 으로 접는다.
- [ ] **Step 5:** 같은 명령 → PASS. `npm run type-check` → 0.
- [ ] **Step 6:** 커밋 — `feat(sales-order): 라인 수량 읽는 문 — 취소 수량은 취소 라인 행 한 곳에서 (K6 PR2a)`

### Task 2: 취소 엔진 내부 읽기 전환

**Files:**
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `type PriorPartialCancellationContext`(:120), `loadPriorPartialCancellationContext`(:2160), 호출 4곳(:1433 `cancelPartial`, :1693 V2 계획, :2066 `planCancellation`, `leavesNothing` :2144), `planCancellation` 전체 갈래(:2079~)
- Test: `apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts` 에 엔진 시나리오 추가(또는 `sales-orders.cancellation-reads.integration.spec.ts` 새 파일 — 빌더 선택)
- 씨앗 갱신(raw INSERT 로 취소를 심으면 `recordSalesOrderCancellation` 경유로): `sales-orders.service.spec.ts`(유닛 — select 체인 목이 취소 metadata 를 돌려주면 라인 행 목도 맞춘다), `sales-orders.v2-cancellation-composition.integration.spec.ts`, `channel-cancel-request/cancellation-plan.integration.spec.ts`, `channel-cancel-settling.integration.spec.ts`, `channel-cancel-request.integration.spec.ts`

**Interfaces:**
- Consumes: Task 1 `readLineQuantities`.
- Produces(서비스 내부):
  ```ts
  type PriorCancellationContext = {
    cancelledByLine: Map<string, number>;                  // = readLineQuantities(...).canceled (갈래·scope 무관)
    preservedShippedByFulfillmentItem: Map<string, number>; // effects 의 preserved_shipped_fulfillment_order_item 합 — 그대로
  };
  private async loadPriorCancellationContext(salesOrderId: string, trx: DbTx): Promise<PriorCancellationContext>;
  ```
  `preservedShippedByFulfillmentItem` 은 «취소 수량»이 아니라 «어느 FOI 의 출고분을 이미 보존 처리했나»라는 엔진 내부 상태다. 라인 행의 `after_shipment` 수량에서 FOI 별 값을 되살릴 수 없으므로(세트에서 한 구성품만 나간 단위도 `after` 1) `effects` 파싱을 유지하되, 모든 scope 의 취소에서 읽는다(전체취소 뒤엔 어차피 더 취소가 없다 — `CANCEL_MSG_FULL_CANCELLATION_EXISTS` 가드 셋).
- `getCancelledQuantityByLine` 은 Task 3 이 지운다(호출자가 거기 있다).

- [ ] **Step 1: 실패하는 테스트를 쓴다:**
  - `plan after a full cancellation keeps the full-exists message` — qty 2, V1 전체취소를 SO `status` 를 `cancelled` 로 바꾸지 않은 상태로 만든다(`recordSalesOrderCancellation(tx, { scope:'full', … })` 를 직접 불러 기록만) → `salesOrders.planCancellation(id, undefined, tx)` 가 `BadRequestException('이미 전체 취소 처리된 주문입니다.')`. 지금 코드로는 통과할 수 있다 — Step 3 의 전환 직후 빨개지는지 보고, 거절 순서를 고쳐 다시 초록으로.
  - `partial remaining counts every prior cancellation` — qty 3, 부분취소 2 → 부분취소 2 요청이 `cancelQuantityExceedsMessage(2, 1)` 400(옛 동작과 같음, 회귀 고정)
- [ ] **Step 2:** Run: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath <위 spec>` → 첫 테스트는 아직 PASS 일 수 있음(기록).
- [ ] **Step 3:** `loadPriorCancellationContext` 로 바꾼다 — `cancelledByLine` 은 `readLineQuantities` 의 `canceled`, `metadata.cancelledLines` 파싱 삭제. 이어 `planCancellation` 의 전체 갈래(`if (!lines)`)에서 `fullCancellation` 거절을 `remainingOf` 계산보다 앞에 둔다(부분 갈래 :2120 과 같은 «`cancelled` → 전체취소 존재 → 수량» 순서).
- [ ] **Step 4:** 위 spec PASS. 회귀: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath $(git ls-files 'apps/core/src/modules/sales-order/**/*.integration.spec.ts')` → 기준선 대비 새 실패 0. `npx jest apps/core/src/modules/sales-order` → 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(sales-order): 취소 엔진의 «이미 취소된 수량»은 읽는 문에서 (K6 PR2a)`

### Task 3: 채널 diff·인쇄 남은 수량 전환, `getCancelledQuantityByLine` 삭제

**Files:**
- Modify: `apps/core/src/modules/sales-order/channel-order-change/channel-order-change.reader.ts` — 생성자에서 `SalesOrdersService` 제거(모듈 provider 배선은 Nest 가 생성자에서 읽으므로 따로 고칠 것 없음), `lockEffectiveOrder` 의 `effectiveQuantity` = `Math.max(0, 문.remaining)`.
- Modify: `apps/core/src/modules/print-order/services/print-cancel-remaining.reader.ts` — `SalesOrdersService` 의존 제거, `readLineQuantities(tx, target.salesOrderId).get(target.salesOrderLineId)?.remaining ?? 0`. 라인이 없으면 0(지금과 같음: `max(0, …)`).
- Modify: `apps/core/src/modules/sales-order/services/sales-orders.service.ts` — `getCancelledQuantityByLine` 삭제.
- 생성자 배선 갱신: `channel-order-change.integration.spec.ts`(`new ChannelOrderChangeReader(...)` 와 `getCancelledQuantityByLine` 단언 4곳 → `readLineQuantities(...).canceled`), `channel-cancel-request.integration.spec.ts`(단언 2곳 :123·:393), `print-orders.service.spec.ts`(필요 시).

**Interfaces:**
- Consumes: Task 1 `readLineQuantities` → `LineQuantities.remaining`. 소비자 쪽 `Math.max(0, …)` 는 지금 의미 보존을 위해 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다:**
  - `channel-order-change.integration.spec.ts` 에 `effective quantity after a v2 full cancellation is zero` — Task 1 의 V2 전체 시나리오에서 `lockEffectiveOrder` 의 물리 라인 `effectiveQuantity` 가 `ordered − outstanding` (E1: 옛 코드는 전체취소를 안 세 `ordered` 였다).
- [ ] **Step 2:** 해당 spec 들 → FAIL.
- [ ] **Step 3:** 구현(위 Files 그대로).
- [ ] **Step 4:** `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath <line-quantities·channel-order-change·channel-cancel-request 통합 spec>` → PASS. `npx jest apps/core/src/modules/print-order apps/core/src/modules/sales-order` → 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(sales-order): 채널 diff·인쇄 남은 수량은 읽는 문에서, getCancelledQuantityByLine 삭제 (K6 PR2a)`

### Task 4: SQL 소비자 — 수요 통계·인쇄 보드, `cancelledQuantitySql` 삭제

**Files:**
- Modify: `apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.ts:95,102` — `line_qty` = `${lineDemandSql(sql\`sol.quantity\`, sql\`sol.id\`)}`, 필터 `> 0`. 위 주석(«부분취소는 metadata 에만 남는다»)을 «취소는 `sales_order_cancellation_lines`, 출고 전 취소만 뺀다(K6 E2)»로.
- Modify: `apps/core/src/modules/print-order/services/print-order.reader.ts:76` — `${lines.quantity} > ${lineCanceledQuantitySql(lines.id, 'any')}`.
- Delete: `apps/core/src/modules/sales-order/services/cancelled-quantity.sql.ts`
- 씨앗 갱신: `demand-series.writer.integration.spec.ts` 의 `seedOrder` 가 `partialCancelledQty` 를 raw INSERT 하는 부분 → 라인 행도 같이 심도록(`recordSalesOrderCancellation` 경유가 가장 짧다), `print-order.reader.integration.spec.ts` 의 취소 씨앗도 같은 식.

**Interfaces:**
- Consumes: Task 1 `lineDemandSql`, `lineCanceledQuantitySql`.

- [ ] **Step 1: 실패하는 테스트를 쓴다(`demand-series.writer.integration.spec.ts` 의 «부분취소 반영» describe 에):**
  - `after-shipment cancellation stays in demand` — qty 5, `recordSalesOrderCancellation(tx, { scope:'partial', metadata:{ cancelledLines:[{L,2}] }, effects:[{ type:'preserved_shipped_fulfillment_order_item', metadata:{ salesOrderLineId:L, skuId, requestedFulfillmentQuantity:2, affectedShippedQuantity:2 } }] … })` 로 라인 행 `after_shipment` 2 → 수요 qty 5
  - `v2 full on a non-cancelled order removes its lines from demand` — SO `status` 가 `cancelled` 가 아닌 주문에 `scope:'full'` + `cancelledLines` 전량 → 그 라인 수요 없음(E1)
  - `print-order.reader.integration.spec.ts`: `a full cancellation on a non-cancelled sales order closes refund-not-opened` — 인쇄 `cancelled`, SO `paid`, 전체취소 라인 행이 라인 수량 전부 → «환불 안 열림» 아님(E1)
- [ ] **Step 2:** 두 spec → 새 테스트 FAIL, 기존 «부분취소 반영» 세 건은 씨앗 갱신 전이면 FAIL 이 정상.
- [ ] **Step 3:** 구현 + 씨앗 갱신 + 파일 삭제.
- [ ] **Step 4:** `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/inventory/replenishment/demand/demand-series.writer.integration.spec.ts apps/core/src/modules/print-order/services/print-order.reader.integration.spec.ts` → PASS. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(core): 수요 통계·인쇄 보드는 같은 SQL 조각으로, cancelledQuantitySql 삭제 (K6 PR2a)`

### Task 5: 구성 리더 전환

**Files:**
- Modify: `apps/core/src/modules/product-matching/line-composition/line-composition.reader.ts:48-61` — 취소 행 select·`sumCancelledByLine` 제거, `fulfillableQuantity` = `readLineQuantities(trx, salesOrderId).get(line.id)?.demand`. 라인이 맵에 없으면 프로그램 결함이므로 `throw new Error(...)`(같은 주문 라인을 같은 트랜잭션에서 읽었으므로 없을 수 없다 — `?? line.quantity` 로 덮지 않는다).
- 씨앗 갱신: `line-composition.integration.spec.ts`, `wake-awaiting-matching.rule.integration.spec.ts`, `fulfillments.service.spec.ts`(유닛 목), 필요하면 `fulfillment/order-progress/__support__/order-progress.fixtures.ts`.

**Interfaces:**
- Consumes: Task 1 `readLineQuantities` → `LineQuantities.demand`.
- `ResolvedSalesOrderLine.fulfillableQuantity` 의 주석을 «주문 수량 − 출고 전 취소(K6 `demand`)»로.

- [ ] **Step 1: 실패하는 테스트를 쓴다(`line-composition.integration.spec.ts`):**
  - `fulfillable excludes only before-shipment cancellations` — 라인 qty 3, 라인 행 `before_shipment` 1 + `after_shipment` 1 → `fulfillableQuantity` 2
  - `v1 full cancellation leaves nothing fulfillable` — qty 2, V1 전체취소(라인 행 before 2, `cancelledLines` 없음) → 0 (옛 코드는 2 였다 — E1)
  - `wake-awaiting-matching.rule.integration.spec.ts` 의 기존 지문 단언이 바뀌면 기대값을 E1 로 고치지 말고 왜 바뀌었는지 먼저 본다 — V1 전체취소는 백로그를 닫으므로(`closeOpenFulfillmentBacklogEffects`) 리컨실러 대상이 아니어야 한다.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** 구현 + 씨앗 갱신.
- [ ] **Step 4:** `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath $(git ls-files 'apps/core/src/modules/product-matching/**/*.integration.spec.ts' 'apps/core/src/modules/fulfillment/**/*.integration.spec.ts')` → 기준선 대비 새 실패 0. `npx jest apps/core/src/modules/product-matching apps/core/src/modules/fulfillment` → 실패 0.
- [ ] **Step 5:** 커밋 — `refactor(product-matching): FO 생성 수량은 읽는 문의 demand 로 (K6 PR2a)`

### Task 6: 읽기 가드 · ADR · 게이트 · PR

**Files:**
- Create: `apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts`
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`

**Interfaces:**
- Consumes: Task 1~5 의 파일 경로. 훑기 방식은 `cancellation-record/cancellation-write.guard.spec.ts` 의 `walk`/`filesMatching` 그대로(`__support__`·`__fixtures__`·`.spec.ts` 제외, 스키마 파일 제외).

- [ ] **Step 1: 테스트를 쓴다:**
  - `only the line-quantity kernel and the recorder read cancellation lines` — `/salesOrderCancellationLines/` 를 쓰는 파일이 `toEqual([…/cancellation-record/record-cancellation.ts, …/line-quantities/line-quantities.sql.ts])`
  - `retired cancelled-quantity parsers stay gone` — `/\bcancelledQuantitySql\b|\bloadPriorPartialCancellationContext\b|\bgetCancelledQuantityByLine\b/` 에 걸리는 파일 `[]`
  - `sumCancelledByLine stays with the recorder` — `/\bsumCancelledByLine\b/` 쓰는 `apps/core/src` 파일이 `[record-cancellation.ts, partial-cancellation.ts]` (PR 6 이 둘 다 지운다)
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts` → PASS. 실제로 잡는지: `demand-series.writer.ts` 에 임시로 `wmsTables.salesOrderCancellationLines` 를 참조하는 한 줄을 넣어 첫 테스트 FAIL 을 보고 되돌린다.
- [ ] **Step 3:** ADR-0047 갱신 — «이후 PR» 의 PR 2 줄을 2a(이 PR: 문·조각·일치 spec·취소 소비자 여섯, E1·E2)와 2b(진행 단계·화면 숫자·F12)로 나누고, «대체되는 것»에 이 PR 이 지운 셋과 PR 6 에 남은 `sumCancelledByLine` 을 적는다.
- [ ] **Step 4: 게이트.** `npm run type-check` → 0. `npx jest` → 실패 0(OOM 이면 `--maxWorkers=2`). 기준선 통합 묶음 → 새 실패 0.
- [ ] **Step 5:** 커밋 — `test(sales-order): 취소 라인은 읽는 문과 쓰기 문만 읽는다 + ADR-0047 2a (K6 PR2a)`
- [ ] **Step 6:** PR 을 연다(`mattpocock-skills:pr`). 본문에 E1·E2 와 배포 절차:
  1. 배포 단위: Core 만, 마이그 없음. `npm run deploy:preflight -- --stage live`(배치 배포 방침).
  2. **배포 전 게이트(터널은 사용자) — 라인 행 없는 취소 0:**
     ```sql
     SELECT count(*) FROM sales_order_cancellations c
     WHERE NOT EXISTS (SELECT 1 FROM sales_order_cancellation_lines l WHERE l.cancellation_id = c.id);
     ```
     기대 0(PR 1 백필 뒤 10-20 실측 0). 0 이 아니면 그 취소들을 백필(`scripts/ops/k6-backfill-cancellation-lines.ts --apply`)하거나 ambiguous 로 판단한 뒤에만 배포한다 — 문은 라인 행 없는 취소를 못 본다.
  3. **배포 전 대조 — 전체취소 없는 주문에서 옛 정의와 새 정의가 같다:**
     ```sql
     WITH old AS (
       SELECT (cl->>'salesOrderLineId')::uuid AS line_id, sum((cl->>'quantity')::int) AS q
       FROM sales_order_cancellations c, jsonb_array_elements(c.metadata->'cancelledLines') cl
       WHERE c.cancellation_scope = 'partial' GROUP BY 1),
     new AS (SELECT sales_order_line_id AS line_id, sum(quantity) AS q FROM sales_order_cancellation_lines GROUP BY 1)
     SELECT count(*) FROM sales_order_lines sol
     LEFT JOIN old ON old.line_id = sol.id LEFT JOIN new ON new.line_id = sol.id
     WHERE NOT EXISTS (SELECT 1 FROM sales_order_cancellations f WHERE f.sales_order_id = sol.sales_order_id AND f.cancellation_scope = 'full')
       AND coalesce(old.q,0) <> coalesce(new.q,0);
     ```
     기대 0. 그리고 `SELECT count(*) FROM sales_order_cancellation_lines WHERE shipment_phase='after_shipment'` 를 함께 찍어 E2 영향 범위를 남긴다(10-20 기준 0).
  4. dev 스테이지·로컬: 같은 게이트 SQL 이 0 이 아니면 백필 `--apply` 먼저.

---

## 이 PR 에서 하지 않는 것

- SKU 층 사실(`shipped`·`forwarded`·`delivered`·`anyShipped`·`cancellable`), 진행 단계 함수, 관리자 뱃지·일별 통계·카드(F10), 고객 actions, 셀메이트 F12, 배송조회 F11 — 2b.
- `outstandingSalesUnits`·`getCancellableUnprocessedFulfillmentQty`·`getEffectiveShippedFulfillmentQty`(FOI 기준 «취소 가능» 계산) — 2b 의 `cancellable` 과 함께.
- `record-cancellation.ts` 의 백필 전 대비(`metadata` 폴백)와 `sumCancelledByLine` 삭제 — PR 6.
