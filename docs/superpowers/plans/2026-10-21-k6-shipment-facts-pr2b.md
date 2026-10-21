# K6 PR 2b — SKU 층 출고·배송 사실, 진행 단계 한 벌, 화면 숫자 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 판매 라인의 «출고·파트너 넘김·배송완료·남은 미출고» 수량을 SKU(구성품) 단위 SQL 관계 한 벌로 정의하고, 관리자 뱃지·일별 통계·관리자 카드·고객 actions·V2 전체취소 재계획·V1 취소 엔진의 출고 판정이 모두 그 한 벌을 읽게 한다.

**Architecture:** PR 2a 의 `line-quantities/` 에 SKU 층 관계 조각 `lineSkuQuantitiesSql(scope)` 를 더한다(행 = 주문 × 판매 라인 × SKU). TS 문 `readLineQuantities` 는 그 관계를 select 해 라인마다 `skus` 를 붙이고, 진행 단계 SQL `orderFulfillmentPhaseSql(scope)` 은 같은 관계를 주문별로 접어 단계 사다리 하나에서 관리자 값·고객 값·`any_shipped` 를 함께 낸다. 판매 단위 환산(`cancellableSalesUnits`)은 SQL 소비자가 없어 TS 순수 함수 한 벌로 둔다.

**Tech Stack:** NestJS, Drizzle ORM(postgres.js, raw `sql` 조각), Jest(유닛 + `describeIfDb` 통합), 소스 텍스트 가드 spec.

**Spec:** `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md` (§6.1 SKU 층, §6.4 진행 단계, §6.5 소비자, §7 셀메이트·직배·인쇄, §8 D9, §5 F10·F11·F12). ADR: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`. 앞선 계획: `docs/superpowers/plans/2026-10-20-k6-line-quantity-reader-pr2a.md`.

## 스펙에서 벗어나는 판단 두 개 (사용자 확인)

- **진행 단계 규칙은 TS 순수 함수가 아니라 SQL 한 벌이다(스펙 §6.4 는 «순수 함수 하나 + 필요하면 SQL 판과 일치 spec»).** 일별 통계는 기간 상한이 없는 집계(`DailyStatsQueryDto` 에 범위 제한 없음)라 SQL 이어야 하고, TS 판을 하나 더 두면 두 판의 일치 spec 을 영구히 들고 가야 한다. 고객 화면도 같은 SQL 을 주문 하나로 부른다. ADR-0047 2a 의 «정의는 SQL 한 벌, TS 에서 다시 계산하지 않는다»와 같은 결이다.
- **`anyShipped`·`shippedComplete` 는 라인 단위로 내지 않는다.** 2b 의 소비자는 전부 주문 단위(셀프취소 차단·카드)라 주문 단위 `any_shipped` 와 SKU 행의 `outstanding` 으로 충분하다. 라인 단위가 필요한 K7·PR 3 이 그때 더한다(YAGNI).

## 2b 의 이름 붙은 동작 변경 (스펙 G5 — 사용자 확인 필요)

라이브 영향 판단의 전제: 라이브 출고는 전부 셀메이트(SO `shipped` + FOI `shipped_qty=qty`, 상자 없음), 직배는 사용 중, 인쇄 외주는 사용 중, V2 상자·소포 추적은 라이브 0회.

- **P1 (D9). 관리자 뱃지·일별 통계가 인쇄 외주를 센다.** 인쇄만 있는 주문이 `preparing` 고정에서 벗어나고(인쇄 shipped → `shipping`, 전량 delivered → `delivered`), 창고 몫이 배송완료여도 인쇄가 안 끝났으면 `shipping`. **라이브 영향 있음**(인쇄 주문의 뱃지·통계 칸이 바뀜). 대상은 SO 가 아직 `confirmed` 이고 활성 인쇄 행이 있는 주문뿐이다 — 셀메이트가 SO 를 `shipped` 로 바꾼 주문은 3번 칸(`external_shipped`)이 먼저 이긴다. 일별 통계는 저장값이 아니라 매번 다시 세므로 **지난 날짜의 칸도 바뀐다**. 인쇄 `delivered` 는 와우프레스 추적 크론(`print-order-tracking`, 30분)이 `ordstat` 로 찍는다 — 와우프레스가 배송완료를 끝내 안 주는 행의 주문은 `shipping` 에 머문다(배포 전 G-d 로 센다).
- **P2. FO 가 취소됐고 SO 는 취소가 아닌 주문 → 관리자 `cancelled`**(전엔 `preparing`). FO 취소 버튼(D11, PR 4 에서 제거)으로만 생긴다.
- **P3. SO `cancelled`·`timeout` → 고객 `canceled`**(전엔 FO 로 판정 — FO 생성 전 취소면 `not_created`). 고객 화면 라벨은 스토어프론트(PR 5, F1)가 정하므로 지금 화면에 보이는 변화는 스토어프론트 매핑에 달렸다.
- **P4. 셀메이트 출고(SO `shipped`·`delivered`) → 고객 `shipping`, 셀프취소 차단**(전엔 상자가 없어 `preparing`). **라이브 영향 있음.** 지금 FO 가 없는 셀메이트 주문(스크립트 출력의 `missingFO`)은 출고 증거가 없어 셀프취소 **버튼이 보인다**. 전체취소 요청은 엔진이 SO `shipped` 로 거절하지만(`sales-orders.service.ts:511`) 고객이 받는 문구가 운영자용 «부분 취소로 진행해 주세요»다. **돈이 새는 길은 하나** — 인쇄 취소가 거절된 주문에서 «인쇄 빼고 취소»(`excludePrint`)를 고르면 요청이 라인 지정 부분취소가 되고, 그 V1 부분취소 경로엔 SO `shipped` 가드가 없어 이미 나간 물건이 환불될 수 있다. P4 가 둘 다 막는다. 고객 화면 라벨은 그대로다 — 스토어프론트는 `shipping` 을 몰라(`order-status-display.ts` 의 `FO_DISPLAY_LABELS`) SO 상태 라벨 «배송 중»으로 떨어지고, 그게 지금과 같다. 바뀌는 건 취소 버튼이 사라지는 것뿐이다.
- **P5. «움직임»·«배송완료»를 상자 상태가 아니라 수량으로 판정한다**(FOI `shipped_qty`, 소포 단위 추적 `delivered`, 직배 `forwarded`·`completed`). 실제 쓰기 경로가 만든 데이터에서는 상자 판정과 같다(발송은 `shipped_qty` 를 올리고 회수는 내린다 — `shipment-dispatch.service.ts:1034`, `shipment-recall.service.ts:436`). 상자 상태만 있고 수량이 없는 «만든» 데이터에서만 다르다 — 기존 spec 픽스처가 그런 데이터라 Task 3 이 고친다.
- **P6 (F10). 관리자 카드 «출고완료»·«부분출고»를 수량으로 다시 정의한다.** 모집단은 둘 다 «최근 14일 · SO `confirmed`»(지금 «출고완료»의 창). 출고완료 = 물리 요구 수량 > 0 이고 남은 미출고 0. 부분출고 = 출고 수량 > 0 이고 남은 미출고 > 0. **부분출고는 더 이상 «출고불가»의 부분집합이 아니다** — 나눠 보낸 주문(#1093)이 남은 몫의 단계와 무관하게 부분출고에 잡힌다. «출고불가»는 그대로(정체 보드 «예약»). 라이브 영향: SO `confirmed` 인 주문만 세므로 셀메이트(`shipped`) 주문은 지금처럼 두 카드에 안 잡힌다.
- **P7. V1 취소 엔진의 출고 수량은 FOI `shipped_qty` 하나다.** `getEffectiveShippedFulfillmentQty` 의 «FO 가 `shipped` 거나 `shipped_at` 이 있으면 FOI 전량 출고» 대체를 지운다. FO `shipped_at`·`shipped` 를 쓰는 생산자 셋(V2 발송 전량 출고 `shipment-dispatch.service.ts:867`, 직배 완료 `fulfillments.service.ts:542-547`, 셀메이트 스크립트)이 모두 FOI `shipped_qty` 도 같이 채우므로 차이는 옛 데이터에만 있다 — 배포 전 게이트 G-a 로 0 을 확인한다. 효과 metadata 의 `shippedEvidenceSource` 는 `fulfillment_order_item_shipped_qty` / `none` 둘만 남는다.
- **P8 (F12). 셀메이트 스크립트가 취소된 FO·FOI 를 출고로 덮어쓰지 않는다.**

V2 전체취소 재계획(2a 이월)은 동작 변경이 없다 — 거절 문구도 그대로다. 예외 하나: «구성 밖 SKU 에 미출고가 남음» 409 의 문구가 FOI id 대신 SKU id 를 적는다(내부 문구, 상태 코드 같음).

## Global Constraints

- 새 파일 위치: `apps/core/src/modules/sales-order/line-quantities/` (스펙 §6.3). 문·조각은 `wmsTables` 만 읽는다 — `print_orders` 도 `wmsTables.printOrders` 다. `DbService<MergedSchema>` 목록에 더하지 않고, 함수가 호출자의 `trx` 를 받는다(ADR-0025). 새 `inTx` 헬퍼 금지.
- 정의는 SQL 한 벌. 수량 뺄셈(`qty − shipped − canceled`, `ordered − canceled`)은 조각 안에만 있다. TS 는 select 한 칼럼을 그대로 쓴다. 예외: `cancellableSalesUnits`(판매 단위 환산, SQL 소비자 없음)와 V2 쓰기 배분 `physicalCancellationByItem`(FOI 단위 쓰기 배분 — 쓰는 함수는 그 모듈에 남는다, G1).
- 관계 조각은 raw SQL 이고 **모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다**(2a 교훈: drizzle 이 단일 테이블 select 의 칼럼을 한정 없이 그려 서브쿼리 안쪽 테이블이 바깥 `"id"` 를 가로챘다).
- 합계는 `::int` 로 캐스트한다(`sum(integer)` 는 bigint → postgres.js 문자열).
- FOI 의 `sales_order_line_id` 는 `varchar` 라 판매 라인과 잇는 곳은 `foi.sales_order_line_id = sol.id::text` 로 쓴다. 주문 범위는 `fulfillment_orders.sales_order_id`(uuid, FO 는 SO 당 0..1 — `inventory.schema.ts` 의 «SO:FO 0..1:0..1 강제»)로 좁힌다.
- 마이그레이션 없음. 배포 단위는 Core 뿐(admin-web 은 바꾸지 않는다 — Task 5 의 «하지 않는 것» 참고). 셀메이트 스크립트는 배포물이 아니다.
- 통합 테스트는 스크래치 DB `k6_it`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/k6_it npx jest --runInBand --runTestsByPath <파일…>`. 브랜치 시작 때 한 번 `DATABASE_URL=…/k6_it npx drizzle-kit migrate --config apps/core/drizzle.config.ts`(develop 에 `add-sku-field-capture` 마이그가 새로 있다).
- 기준선: 브랜치 시작 때 `k6_it` 에서 `apps/core/src/modules/{sales-order,fulfillment,print-order,product-matching}` 의 `*.integration.spec.ts` 를 한 번 돌려 실패 목록을 scratchpad 에 둔다. «새 실패 0» 은 그 목록 대비다(2a 기준선 실패 2건: planning tombstone entrance password, waybill durable failed row).
- 워크트리는 `node_modules` 심링크(이미 걸려 있음). jest 가 OOM 이면 `--maxWorkers=2`.
- 금지: `any`, 근거 없는 `as`, 스펙 안 `dotenv.config()`, 가드 없는 DB 통합 스펙.
- 커밋 메시지는 한국어 `refactor(sales-order): … (K6 PR2b)` 꼴. 시스템이 주는 attribution 줄이 있으면 끝에 붙인다.

## Review Focus

1. **나눠 보낸 주문(#1093) — 소포 A 배송완료, 남은 상자 B 는 아직 draft.** 단계는 `delivered` 가 아니라 `shipping`, 카드는 «부분출고». Task 3 `split order with one delivered parcel is shipping`, Task 5 `split order counts as partial outbound` 가 고정한다.
2. **회수(recall)된 소포에 `delivered` 추적 행이 남은 경우.** 회수는 FOI `shipped_qty` 를 내리고 시도 상태를 `recalled` 로 바꾼다 — 그 소포는 출고도 배송완료도 아니다. Task 1 `recalled attempt is neither shipped nor delivered` 가 고정한다.
3. **세트 라인에서 구성품 하나만 나간 뒤 V2 전체취소.** `cancellableSalesUnits` 는 지금 `outstandingSalesUnits` 처럼 409 `V2 component progress is inconsistent …` 로 거절해야 한다(조용히 min 을 고르면 일부 구성품만 취소된다). Task 1 유닛 `bundle with one shipped component is inconsistent`, Task 2 `v2 full on a half-shipped bundle is refused` 가 고정한다.
4. **직배 `forwarded` 주문.** 고객 셀프취소는 지금처럼 막히고(`any_shipped`), 관리자 V1 취소는 지금처럼 된다(`forwarded` 는 출고가 아니다 — FOI `shipped_qty` 0). Task 3 `forwarded drop-ship moves but is not shipped`, Task 2 `admin v1 cancel of a forwarded drop-ship still reduces items` 가 고정한다.
5. **셀메이트 출고 주문인데 FO 가 없는 경우(`missingFO`).** `any_shipped` 가 SO 상태로 참이어야 셀프취소가 막힌다(P4). Task 3 `cellmate shipped order without FO is shipped`, Task 4 `cellmate order without FO cannot self-cancel` 이 고정한다.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `line-quantities/line-quantities.sql.ts` (수정) | 2a 조각 별칭 이름 정리 + SKU 층 관계 `lineSkuQuantitiesSql` |
| `line-quantities/line-quantities.reader.ts` (수정) | `LineQuantities.skus` 추가 |
| `line-quantities/line-sales-units.ts` (생성) + `.spec.ts` | `cancellableSalesUnits` — 판매 단위 환산 한 벌 |
| `line-quantities/order-fulfillment-phase.sql.ts` (생성) | 진행 단계 사다리 한 벌 `orderFulfillmentPhaseSql`, 타입 `OrderShipmentPhase` 이전 |
| `line-quantities/order-fulfillment-phase.reader.ts` (생성) | `readOrderFulfillmentPhases` |
| `line-quantities/order-fulfillment-phase.integration.spec.ts` (생성) | 단계 시나리오(옛 관리자·고객 spec 이식 + 새 시나리오) |
| `line-quantities/__support__/shipment-facts.fixtures.ts` (생성) | 실제 쓰기 경로 모양의 출고·배송 픽스처 |
| `sales-order/services/order-shipment-phase.sql.ts`·`.integration.spec.ts` (삭제) | |
| `sales-order/services/sales-orders.service.ts` (수정) | 엔진 전환, 뱃지·통계·카드 전환 |
| `sales-order/services/v2-cancellation-units.ts` (수정) | `outstandingSalesUnits` 삭제 |
| `sales-order/services/store-sales-orders.service.ts` (수정) | 고객 단계·셀프취소·F11 |
| `sales-order/services/fulfillment-phase.ts` (수정) | `deriveFulfillmentPhase`·`hasShippedEvidence`·`MOVED_SHIPMENT_STATUSES` 삭제, `shipmentProgressOf` |
| `sales-order/dto/sales-order-response.dto.ts` (수정) | 타입 import 경로 |
| `scripts/ops/cellmate-local/mark-core-shipped.js` (수정) + `mark-core-shipped.sql.js` (생성) + 통합 spec | F12 |
| `line-quantities/line-quantity-read.guard.spec.ts` (수정) | 옛 이름 부활 금지 확장 |
| `print-order/services/print-order-admin.manager.ts`·`print-orders.service.ts` (수정) | 죽은 `lineQuantity` 삭제 |
| `docs/adr/0047-…md` (수정) | 2b 결과, 71행 문구 |

(경로의 `line-quantities/`·`sales-order/` 는 `apps/core/src/modules/sales-order/` 기준.)

---

### Task 1: SKU 층 관계 조각 + 문 확장 + 판매 단위 환산

**Files:**
- Modify: `line-quantities/line-quantities.sql.ts`, `line-quantities/line-quantities.reader.ts`, `line-quantities/line-quantities.integration.spec.ts`
- Modify: `apps/core/src/modules/print-order/services/print-order.reader.spec.ts:35-36` (별칭 문자열 단언)
- Create: `line-quantities/line-sales-units.ts`, `line-quantities/line-sales-units.spec.ts`, `line-quantities/__support__/shipment-facts.fixtures.ts`

**Interfaces:**
- Consumes: 2a `readLineQuantities`, `lineCanceledQuantitySql`; fixtures `fulfillment/order-progress/__support__/order-progress.fixtures.ts`(`seedWorld`·`seedOrder`·`seedFo`·`seedBox`), `cancellation-record/__support__/cancellation-scenarios.ts`.
- Produces:
  ```ts
  // line-quantities.sql.ts
  /** 행 = (sales_order_id uuid, sales_order_line_id uuid, sku_id uuid, qty_per_unit int|null,
   *        required, shipped, forwarded, delivered, partner_completed, outstanding — 전부 int).
   *  키 = 범위 주문의 (판매 라인, SKU) 중 FOI 가 있거나 굳은 구성(sales_order_line_compositions)에 있는 것.
   *  FOI 단위 정의(그 뒤 (라인, SKU) 합):
   *    required          = qty − canceled_qty
   *    shipped           = shipped_qty
   *    outstanding       = qty − shipped_qty − canceled_qty
   *    forwarded         = FO 가 drop_ship 이고 direct_ship_status='forwarded' 면 outstanding, 아니면 0 — 출고가 아니다
   *    partner_completed = FO 가 drop_ship 이고 direct_ship_status='completed' 면 shipped_qty, 아니면 0 — 배송완료가 아니다(표시용)
   *    delivered         = Σ dispatch_attempt_sources.qty (그 FOI 의 상자 라인, 시도 status='dispatched',
   *                        그 시도에 shipment_tracking status='delivered' 행이 있음)
   *  FO 상태로 거르지 않는다(FO 취소는 단계 사다리가 따로 본다).
   *  scope: 판매주문 id 한 열을 내는 SELECT. */
  export function lineSkuQuantitiesSql(salesOrderScope: SQL): SQL;

  // line-quantities.reader.ts
  export type LineSkuQuantities = {
    skuId: string; qtyPerUnit: number | null;
    required: number; shipped: number; forwarded: number; delivered: number; partnerCompleted: number; outstanding: number;
  };
  export type LineQuantities = { /* 2a 칼럼 그대로 */ skus: LineSkuQuantities[] }; // skuId 순. FO 전이면 []

  // line-sales-units.ts
  /** 아직 아무 구성품도 나가지 않은 판매 단위(V2 «상자 후» 취소 의미, 옛 outstandingSalesUnits).
   *  구성 SKU 마다 outstanding ÷ qtyPerUnit 이 같아야 한다. skus 가 비면 호출자가 갈래를 정한다(여기 오지 않는다). */
  export function cancellableSalesUnits(line: LineQuantities): number;
  // ConflictException 문구(옛 v2-cancellation-units.ts 와 같다):
  //   qtyPerUnit 이 전부 null         → `Line composition is not frozen for SalesOrder line ${id}`
  //   qtyPerUnit null 인 행의 outstanding > 0 → `V2 fulfillment SKU ${skuId} is outside the composition of SalesOrder line ${id}`
  //   나누어떨어지지 않음              → `V2 progress is not aligned for SalesOrder line ${id}`
  //   SKU 마다 몫이 다름               → `V2 component progress is inconsistent for SalesOrder line ${id}`

  // __support__/shipment-facts.fixtures.ts — 실제 발송·추적 경로가 남기는 모양 그대로
  export async function seedDispatchedParcel(
    tx: DbTx, w: World,
    parcel: { shipmentId: string; lines: Array<{ shipmentLineId: string; foItemId: string; qty: number }>; delivered?: boolean },
  ): Promise<{ dispatchAttemptId: string }>;
  // stock_journals 1행 → dispatch_attempts(status 'dispatched', dispatched_at, stock_journal_id) → 줄마다 dispatch_attempt_sources
  // (이 픽스처가 그 창고에 만든 location 하나) → FOI shipped_qty += qty → 상자 status 'shipped' (delivered 면 'delivered' +
  // shipment_tracking status 'delivered' 행). location insert 는 fulfillment/services/__support__/logistics-fixtures.ts:25 를 본뜬다.
  export async function recallParcel(tx: DbTx, p: { dispatchAttemptId: string; lines: Array<{ foItemId: string; qty: number }> }): Promise<void>;
  // stock_journals 1행(reversal) → 시도 status 'recalled'·recalled_at·reversal_journal_id → FOI shipped_qty −= qty (shipment-recall.service.ts:436 의 모양)
  ```
- 2a 조각 별칭 이름 정리(2a 이월): 파생 테이블 `k6_cl` → `cancellation_line`, 칼럼 `k6_line_id`·`k6_quantity`·`k6_shipment_phase` → `canceled_line_id`·`canceled_quantity`·`canceled_phase`. 바깥 칼럼과 겹치지 않는다는 조건은 그대로다. `print-order.reader.spec.ts` 의 단언 두 줄을 새 이름으로.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `line-sales-units.spec.ts`(유닛, `LineQuantities` 리터럴로):
    - `single sku outstanding 2 per unit 1 is 2`
    - `set A×1·B×2 with outstanding 3·6 is 3`
    - `bundle with one shipped component is inconsistent` — A×1 outstanding 0, B×1 outstanding 1 → 위 inconsistent 문구
    - `not divisible is not aligned` — A×2 outstanding 3
    - `no frozen composition` — 모든 행 `qtyPerUnit: null`
    - `stray sku with outstanding is outside the composition` — A×1 outstanding 1, `{skuId:'x', qtyPerUnit:null, outstanding:1}`
    - `stray sku without outstanding is ignored` — 같은데 x 의 outstanding 0 → 1
  - `line-quantities.integration.spec.ts` 에 SKU 층 시나리오(2a 의 `readAndCrossCheck` 처럼 (가) 문의 결과 (나) 문을 거치지 않고 `lineSkuQuantitiesSql` 을 주문 범위로 직접 select 한 결과가 같다). 기대값 표기 `{required, shipped, forwarded, delivered, partnerCompleted, outstanding}`:
    - `before fulfillment the sku layer is empty` — 라인 qty 2, FO 없음 → `skus: []`
    - `fo created nothing shipped` — `seedFo` qty 2 → `{2,0,0,0,0,2}`, `qtyPerUnit 1`
    - `dispatched parcel not yet delivered` — 상자 라인 2, `seedDispatchedParcel(…, delivered:false)` → `{2,2,0,0,0,0}`
    - `delivered parcel` — 같은데 `delivered:true` → `{2,2,0,2,0,0}`
    - `recalled attempt is neither shipped nor delivered` — 배송완료 소포를 `recallParcel` → `{2,0,0,0,0,2}`(추적 행은 남아 있다)
    - `split shipment one parcel delivered` — FOI qty 3, 상자 둘(2·1), 첫 상자만 발송·배송완료 → `{3,2,0,2,0,1}`
    - `forwarded drop-ship moves but is not shipped` — `seedFo(dropShip:'forwarded')` qty 1 → `{1,0,1,0,0,1}`
    - `completed drop-ship is shipped by partner` — `dropShip:'completed'` + FOI `shipped_qty=1` → `{1,1,0,0,1,0}`
    - `cellmate marking is shipped without parcels` — FOI `shipped_qty=qty` 만 직접 update → `{1,1,0,0,0,0}`
    - `v2 canceled quantity leaves required` — FOI qty 2, `canceled_qty=1` → `{1,0,0,0,0,1}`
    - `composition sku without an item appears with zeros` — 구성 A×1·B×1, FOI 는 A 만 → B 행 `{0,0,0,0,0,0}`, `qtyPerUnit 1`
- [ ] **Step 2:** Run: `npx jest apps/core/src/modules/sales-order/line-quantities/line-sales-units.spec.ts` 와 `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/line-quantities/line-quantities.integration.spec.ts` → 새 테스트 FAIL(모듈·필드 없음), 2a 시나리오는 별칭 정리 뒤에도 PASS 여야 한다.
- [ ] **Step 3:** 구현 — 별칭 정리, `lineSkuQuantitiesSql`, 문의 `skus`(두 번째 select 를 주문 범위로 돌려 `salesOrderLineId` 로 묶는다 — 묶기는 산술이 아니다), `cancellableSalesUnits`, 픽스처.
- [ ] **Step 4:** 위 두 명령 → PASS. `npx jest apps/core/src/modules/print-order/services/print-order.reader.spec.ts` → PASS. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `feat(sales-order): 라인 수량 문에 SKU 층 출고·배송 사실 (K6 PR2b)`

### Task 2: 취소 엔진 — V2 전체 재계획·남은 수량·V1 출고 판정

**Files:**
- Modify: `sales-order/services/sales-orders.service.ts` — `PriorCancellationContext`(:120) `cancelledByLine` → `remainingByLine`, 그 뺄셈 여섯 곳(:1443, :1483, :1703, :1727, :2080, :2156), V2 전체 재계획(:1696-1715), `getEffectiveShippedFulfillmentQty`(:2381), V1 전체취소의 FOI 출고 조회(:578-591)
- Modify: `sales-order/services/v2-cancellation-units.ts` — `outstandingSalesUnits` 삭제(`physicalCancellationByItem`·`itemsByCompositionSku` 는 남긴다), `v2-cancellation-units.spec.ts` 의 그 describe 삭제(같은 의미가 Task 1 유닛으로 옮겨졌다)
- Test: `sales-order/services/sales-orders.cancellation-reads.integration.spec.ts`(2a 가 만든 파일)에 시나리오 추가

**Interfaces:**
- Consumes: Task 1 `readLineQuantities(...).skus`·`remaining`, `cancellableSalesUnits`.
- Produces(서비스 내부):
  ```ts
  type PriorCancellationContext = {
    remainingByLine: Map<string, number>;                  // = readLineQuantities(...).remaining — 호출자는 뺄셈을 다시 하지 않는다
    preservedShippedByFulfillmentItem: Map<string, number>; // 그대로
  };
  ```
  `leavesNothing`(:2156)은 `remainingByLine.get(id) − now.get(id) <= 0` — 이번 요청 수량을 빼는 건 정의가 아니라 판정이라 남는다.
- V2 전체 재계획: 물리 라인은 `cancellableSalesUnits(lineQuantities.get(line.id))`, 인쇄 라인은 `remainingByLine`, 디지털은 지금처럼 `[]`, 물리인데 `skus` 가 비면 지금처럼 409 `V2 fulfillment item is missing …`.
- V1: `getEffectiveShippedFulfillmentQty` 는 `{ quantity: item.shippedQty, source: item.shippedQty > 0 ? 'fulfillment_order_item_shipped_qty' : 'none' }` 만 낸다(P7). 두 번째 인자 `fulfillmentOrder` 는 지운다. V1 전체취소의 «FOI `shipped_qty > 0` 조회»는 `readLineQuantities` 의 `skus` 중 `shipped > 0` 이 있는지로 바꾸고 문구 `CANCEL_MSG_SHIPPED_ITEMS` 는 그대로다. FO 상태 가드(`hasShippedFulfillment`, `CANCEL_MSG_SHIPPED_FULFILLMENT`)는 FO 상태 규칙이라 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트를 쓴다(`sales-orders.cancellation-reads.integration.spec.ts`):**
  - `v2 full replan cancels the cancellable units of a set line` — 라인 qty 2, 구성 A×1·B×2, V2 상자(draft) → `planCancellation(id)` 의 그 라인 요청 수량 2(2a 이월)
  - `v2 full includes the remaining of an outsourced line` — 위 주문에 인쇄 라인 qty 1(앞서 부분취소 0) → 인쇄 라인 요청 1, 출고 정리 없음(2a 이월)
  - `v2 full on a half-shipped bundle is refused` — 구성 A×1·B×1, A 만 `seedDispatchedParcel` → 409 `V2 component progress is inconsistent …`
  - `v1 partial ignores a shipped fo flag without item shipped qty` — FO `status='shipped'`·`shipped_at` 만 찍고 FOI `shipped_qty=0` → 부분취소 1 이 FOI `qty` 를 줄인다(전에는 «출고 뒤 취소»로 보존 효과만 남겼다 — P7 을 문서화하는 단언)
  - `admin v1 cancel of a forwarded drop-ship still reduces items` — `dropShip:'forwarded'`, FOI `shipped_qty 0` → 관리자 부분취소 1 이 FOI `qty` 를 줄인다(회귀 고정)
- [ ] **Step 2:** Run: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/sales-orders.cancellation-reads.integration.spec.ts` → 넷째 FAIL, 나머지는 전환 전에도 PASS 일 수 있다(기록).
- [ ] **Step 3:** 구현(위 Interfaces 대로). 유닛 `sales-orders.service.spec.ts` 의 select 체인 목이 `cancelledByLine` 을 전제하면 `remaining` 으로 맞춘다.
- [ ] **Step 4:** 위 spec PASS. 회귀: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath $(git ls-files 'apps/core/src/modules/sales-order/**/*.integration.spec.ts')` → 기준선 대비 새 실패 0. `npx jest apps/core/src/modules/sales-order` → 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(sales-order): 취소 엔진의 남은·취소 가능·출고 수량은 라인 수량 문에서 (K6 PR2b)`

### Task 3: 진행 단계 한 벌 — 관리자 뱃지·일별 통계 전환

**Files:**
- Create: `line-quantities/order-fulfillment-phase.sql.ts`, `line-quantities/order-fulfillment-phase.reader.ts`, `line-quantities/order-fulfillment-phase.integration.spec.ts`
- Delete: `sales-order/services/order-shipment-phase.sql.ts`, `sales-order/services/order-shipment-phase.integration.spec.ts`(시나리오는 새 spec 으로 옮긴다)
- Modify: `sales-order/services/sales-orders.service.ts` — `loadShipmentPhases`(:770) → `readOrderFulfillmentPhases(...).adminPhase`, `getDailyStatusStats`(:1167-1186) 의 `ph` CTE → `orderFulfillmentPhaseSql` 의 `admin_phase`
- Modify: `sales-order/dto/sales-order-response.dto.ts:3` — 타입 import 경로

**Interfaces:**
- Consumes: Task 1 `lineSkuQuantitiesSql`, `wmsTables.printOrders`.
- Produces:
  ```ts
  // order-fulfillment-phase.sql.ts
  export type OrderShipmentPhase = 'pending' | 'preparing' | 'shipping' | 'delivered' | 'external_shipped' | 'cancelled'; // 옮김, 값 그대로
  /** 행 = (sales_order_id, admin_phase OrderShipmentPhase, store_phase StoreFulfillmentStatus, any_shipped boolean). 범위 주문마다 정확히 한 행. */
  export function orderFulfillmentPhaseSql(salesOrderScope: SQL): SQL;

  // order-fulfillment-phase.reader.ts
  export type OrderFulfillmentPhase = { adminPhase: OrderShipmentPhase; storePhase: StoreFulfillmentStatus; anyShipped: boolean };
  export function readOrderFulfillmentPhases(db: DbTx | WmsDb, salesOrderIds: string[]): Promise<Map<string, OrderFulfillmentPhase>>;
  // 빈 배열이면 빈 맵. 범위는 unnest(ARRAY[…]::uuid[]) — 지금 loadShipmentPhases 와 같은 모양.
  ```
- **사다리(위에서 먼저 맞는 것이 이긴다).** 주문별 접기: `lineSkuQuantitiesSql` 의 합(required·shipped·forwarded·delivered·partner_completed·outstanding), 활성 인쇄 행(`status <> 'cancelled'`)의 수·`shipped`/`delivered` 수·`delivered` 수, FO 상태.
  | # | 조건 | 단계 |
  |---|---|---|
  | 1 | SO `cancelled`·`timeout` | cancelled |
  | 2 | SO `pending` | pending |
  | 3 | SO `shipped`·`delivered` | external_shipped |
  | 4 | FO 가 있고 `canceled`, 활성 인쇄 0 | cancelled |
  | 5 | (FO 없음 또는 required 합 0) 이고 활성 인쇄 0 | not_created |
  | 6 | 있는 몫이 전부 끝남: 창고 몫(required>0)은 outstanding 0 이고 delivered+partner_completed ≥ required, 인쇄 몫은 전부 `delivered` | delivered |
  | 7 | 창고 shipped+forwarded > 0, 또는 인쇄 `shipped`/`delivered` 하나 이상 | shipping |
  | 8 | 그 밖 | preparing |
  `admin_phase`: not_created → `preparing`, 나머지는 이름 그대로. `store_phase`: pending → `not_created`, external_shipped → `shipping`, cancelled → `canceled`, 나머지 그대로. `any_shipped` = SO `shipped`·`delivered` 이거나 창고 shipped+forwarded > 0 이거나 인쇄 `shipped`/`delivered` 하나 이상(사다리와 독립 — SO 상태와 무관하게 사실을 낸다). 사다리는 이 파일에 한 번만 쓰고 두 매핑은 그 결과 위의 CASE 다.

- [ ] **Step 1: 실패하는 spec 을 쓴다.** 모든 출고·배송은 Task 1 픽스처(`seedDispatchedParcel`·`recallParcel`)로 만든다 — 상자 status 만 바꾸는 옛 `seedBox(status:'shipped')` 는 움직임으로 쓰지 않는다(P5). 기대값 `(admin, store, anyShipped)`:
  - 옛 관리자 spec 이식: `cellmate shipped order without boxes`(SO shipped, FOI shipped_qty=qty) `(external_shipped, shipping, true)` · `cellmate shipped order with a core box`(+ draft 상자) 같음 · `cancelled order with a remaining box` `(cancelled, canceled, false)` · `pending order` `(pending, not_created, false)` · `one of two parcels dispatched` `(shipping, shipping, true)` · `both parcels delivered` `(delivered, delivered, true)` · `confirmed order with fo and no parcel` `(preparing, preparing, false)` · `canceled box is ignored`(취소 상자 + draft 상자) `(preparing, preparing, false)` · `forwarded drop-ship moves but is not shipped` `(shipping, shipping, true)` · `completed drop-ship shows delivered` `(delivered, delivered, true)` · `one row per order in scope` · 일별 통계 `externalShipped` 칸(옛 spec :159 의 단언 그대로)
  - 옛 고객 유닛 이식(`store-sales-orders.service.spec.ts:860-1003`): `print only all delivered` `(delivered, delivered, true)` — P1(옛 관리자 preparing) · `print only one shipped one submitted` `(shipping, shipping, true)` — P1 · `fo ready and print shipped` `(shipping, shipping, true)` — P1 · `warehouse delivered and print submitted` `(shipping, shipping, true)` — P1(옛 관리자 delivered) · `confirmed order without fo` `(preparing, not_created, false)` · `partially shipped with a draft box` `(shipping, shipping, true)` · `delivered parcel and a recovery box` `(shipping, shipping, true)` · `recovery box without dispatch` `(preparing, preparing, false)`
  - 새 시나리오: `fo canceled on a confirmed order` `(cancelled, canceled, false)` — P2 · `cancelled order before fo` `(cancelled, canceled, false)` — P3 · `recalled parcel is not moved` `(preparing, preparing, false)` · `split order with one delivered parcel is shipping` `(shipping, shipping, true)` · `cellmate shipped order without FO is shipped` `(external_shipped, shipping, true)`
- [ ] **Step 2:** Run: `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/line-quantities/order-fulfillment-phase.integration.spec.ts` → FAIL(모듈 없음).
- [ ] **Step 3:** 구현 + `sales-orders.service.ts` 두 곳 전환 + 옛 파일 둘 삭제. `getOne`·`list` 의 `FALLBACK_SHIPMENT_PHASE` 는 그대로.
- [ ] **Step 4:** 위 spec PASS. `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/sales-orders-stats.integration.spec.ts` 와 sales-order 통합 묶음 → 기준선 대비 새 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(sales-order): 진행 단계는 라인 수량 위의 사다리 한 벌 — 관리자 뱃지·일별 통계 (K6 PR2b)`

### Task 4: 고객 actions·셀프취소·배송조회(F11)

**Files:**
- Modify: `sales-order/services/store-sales-orders.service.ts` — `buildActionsView`(:690-) 의 `fulfillmentStatus` 와 `selfCancelBlockOf`(:900-) 의 `hasShippedEvidence`, `loadFulfillmentPhaseInput`(:1247) 의 `anyFoiShipped` 제거, `buildV2TrackingShipments`(:1371) 의 상자 필터
- Modify: `sales-order/services/fulfillment-phase.ts` — `deriveFulfillmentPhase`·`hasShippedEvidence`·`MOVED_SHIPMENT_STATUSES` 삭제, `FulfillmentPhaseInput.anyFoiShipped` 삭제, 새 `shipmentProgressOf`. `isReturnEligible`·`isPickingStarted` 는 남긴다(청구 자격은 PR 3 의 `claimable`)
- Modify: `sales-order/services/fulfillment-phase.spec.ts`, `sales-order/services/store-sales-orders.service.spec.ts`, `sales-order/services/self-cancel-block.ts`·`.spec.ts`
- Test: `line-quantities/order-fulfillment-phase.integration.spec.ts` 에 셀프취소 시나리오 하나

**Interfaces:**
- Consumes: Task 3 `readOrderFulfillmentPhases` → `storePhase`, `anyShipped`.
- Produces:
  ```ts
  // fulfillment-phase.ts — 진행 요약은 단계가 아니라 «소포(상자·직배·인쇄 행) 수»다. 지금 deriveFulfillmentPhase 의 progress 계산을 그대로 옮긴다.
  export function shipmentProgressOf(input: FulfillmentPhaseInput): ShipmentProgressDto;
  ```
- `buildActionsView`: `fulfillmentStatus = phase.storePhase`, `shipmentProgress` 는 `shipmentProgressOf` 의 `total > 0` 일 때만(지금과 같음). `self-cancel-block.ts` 의 `SelfCancelFacts.hasShippedEvidence` 를 `anyShipped` 로 이름을 바꾸고(옛 함수와 같은 이름이라 Task 7 가드에 걸린다) `anyShipped: phase.anyShipped` 를 넘긴다(`self-cancel-block.spec.ts` 도 같이). 맵에 주문이 없으면 프로그램 결함이라 `throw new Error(...)`(방금 읽은 주문이다 — 기본값으로 덮지 않는다).
- F11: `buildV2TrackingShipments` 의 상자 select 를 `notInArray(status, ['canceled', 'superseded'])` 로. `deriveOverallTrackingStatus` 는 소포 목록의 표시라 남긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `order-fulfillment-phase.integration.spec.ts`: `cellmate order without FO cannot self-cancel` — `StoreSalesOrdersService` 를 그 spec 의 배선으로 만들 수 없으면 `selfCancelBlock({ …, anyShipped: phases.get(id)!.anyShipped }, …)` 가 `already_shipped` 인지로 단언한다.
  - `store-sales-orders.service.spec.ts`: `jest.mock('../line-quantities/order-fulfillment-phase.reader')` 로 문을 목하고 `makeContext` 에 `phase?: Partial<OrderFulfillmentPhase>`(기본 `{ adminPhase:'preparing', storePhase:'preparing', anyShipped:false }`)를 더한다. `describe('buildActionsView fulfillmentStatus (V2)')` 의 각 케이스는 Task 3 의 같은 이름 시나리오가 증명한 `(storePhase, anyShipped)` 를 `phase` 로 넣고, **actions·`cancelUnavailableReason`·`shipmentProgress` 단언만** 남긴다(단계 판정은 Task 3 이 소유한다). 새 케이스 `exclude-print cancel of a shipped order is refused` — `phase: { anyShipped: true }`, SO `shipped`, 인쇄 `cancel_refused` + 일반 라인 하나, `excludePrint: true` 로 취소 요청 → `BadRequestException` «이미 출고된 주문은 취소할 수 없습니다…», `cancelRequests.precheck` 를 부르지 않는다(P4 가 막는 돈 구멍). 새 케이스 `tracking hides superseded boxes` 는 `describe('tracking query V2 graph')` 에 — superseded 상자의 라인이 있는 주문의 `shipments` 에 그 상자가 없다.
  - `fulfillment-phase.spec.ts`: `deriveFulfillmentPhase`·`hasShippedEvidence` describe 삭제, `shipmentProgressOf` 에 옛 progress 단언(:40-:50, :64) 이식.
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/services/store-sales-orders.service.spec.ts apps/core/src/modules/sales-order/services/fulfillment-phase.spec.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npx jest apps/core/src/modules/sales-order` → 실패 0. 통합 묶음 → 새 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `refactor(sales-order): 고객 단계·셀프취소는 같은 사다리에서, 배송조회에서 합쳐진 상자를 뺀다 (K6 PR2b)`

### Task 5: 관리자 카드(F10)

**Files:**
- Modify: `sales-order/services/sales-orders.service.ts` — `getStats`(:1209-1305) 의 `outboundComplete` 쿼리, `shipBlockCounts`(:1314) 의 `partialOutbound`(→ `getStats` 쪽 새 쿼리로 옮기고 `shipBlockCounts` 는 `cannotShip` 만), 틀린 주석 «`hasShippedEvidence` 와 동일한 정의» 삭제
- Modify: `sales-order/services/sales-orders-stats.integration.spec.ts`(:178, :220, :235 의 세 테스트), `sales-order/services/sales-orders.service.spec.ts:2340-` (쿼리 체인 목 — 새 쿼리 모양에 맞춘다. 판정 자체는 통합 spec 이 소유)

**Interfaces:**
- Consumes: Task 1 `lineSkuQuantitiesSql`.
- 한 쿼리로 두 숫자: 모집단 = `sales_orders` 중 `order_date >= 14일 전`(지금 `kstTodayRange(13)` 의 `backStart`) 이고 `status = 'confirmed'`. 주문별로 `lineSkuQuantitiesSql(모집단)` 을 접어
  `outboundComplete = count(*) FILTER (WHERE required > 0 AND outstanding = 0)`, `partialOutbound = count(*) FILTER (WHERE shipped > 0 AND outstanding > 0)`(P6).
- **취소 모달은 바꾸지 않는다.** 모달의 `isShipped`(SO `orderStatus` 가 shipped·delivered, `cancel-order-modal.tsx:128`)를 `shipmentPhase` 로 바꾸면 «전체 취소» 버튼이 꺼지는(`:223`) 주문이 늘어난다. 사다리는 직배 `forwarded` 와 인쇄만 나간 주문(P1)도 `shipping` 으로 내므로, **넘긴 직배 주문**(넘긴 뒤에도 취소 가능해야 한다 — 서버는 허용, Review Focus 4)과 창고 몫은 손도 안 댄 인쇄 혼합 주문이 화면에서 전체취소를 못 한다. 지금 판정이 놓치는 건 core 출고(V2)뿐이고 V2 는 라이브 0회라 얻는 것이 없다. 필요해지면 단계가 아니라 «창고·인쇄에서 실제로 나간 수량» 사실로 판정한다(이 PR 밖).

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `sales-orders-stats.integration.spec.ts`(소포는 Task 1 픽스처로):
    - `split order counts as partial outbound` — 14일 안 confirmed, FOI qty 3, 상자 둘 중 하나 발송, 남은 상자는 피킹 단계(보드 «예약» 아님) → `partialOutbound 1`, `outboundComplete 0`
    - `fully shipped order is outbound complete` — 전량 발송 → `outboundComplete 1`, `partialOutbound 0`
    - `forwarded drop-ship is neither` — `dropShip:'forwarded'` → 둘 다 0
    - `cellmate shipped order is outside the population` — SO `shipped` + FOI 전량 shipped → 둘 다 0
    - 옛 :178(부분출고는 출고불가의 부분집합) 은 P6 로 의미가 바뀌므로 지우고, 옛 :220(상자 둘 움직여도 주문 하나)·:235(출고완료는 FO 증거)는 새 정의로 다시 쓴다(:235 의 «FO `shipped_at` 만으로 출고완료»는 P7 과 같은 이유로 더는 성립하지 않는다 — 그 단언을 반대로).
- [ ] **Step 2:** `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath apps/core/src/modules/sales-order/services/sales-orders-stats.integration.spec.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 위 spec PASS. `npx jest apps/core/src/modules/sales-order` → 실패 0. `npm run type-check` → 0.
- [ ] **Step 5:** 커밋 — `fix(sales-order): 관리자 «출고완료»·«부분출고»는 라인 수량으로 — 나눠 보낸 주문이 잡힌다 (K6 PR2b)`

### Task 6: 셀메이트 스크립트 F12

**Files:**
- Create: `scripts/ops/cellmate-local/mark-core-shipped.sql.js` — 스크립트의 UPDATE 셋을 문자열 상수로(`MARK_SALES_ORDERS_SHIPPED`, `MARK_FULFILLMENT_ORDERS_SHIPPED`, `MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED`, 매개변수 `$1::text[]` = channel_order_id 목록)
- Modify: `scripts/ops/cellmate-local/mark-core-shipped.js` — 위 상수를 `require` 해 쓴다(동작은 아래 조건 말고 그대로)
- Create: `scripts/ops/cellmate-local/mark-core-shipped.integration.spec.ts` — `describeIfDb`, `k6_it` 트랜잭션 롤백

**Interfaces:**
- FO 갱신 조건: `status NOT IN ('shipped', 'canceled')`. FOI 갱신 조건: 그 FO 가 `canceled` 가 아니고 FOI `status <> 'canceled'` 이고 `shipped_qty < qty - canceled_qty`, 값은 `shipped_qty = qty - canceled_qty`(제약 `shipped + canceled ≤ qty` 를 지킨다 — 옛 `shipped_qty = qty` 는 V2 취소분이 있으면 제약 위반으로 스크립트가 죽는다).

- [ ] **Step 1: 실패하는 테스트를 쓴다(상수를 `pg` 대신 `tx.execute(sql.raw(...))` 가 아니라 postgres.js `unsafe(query, [ids])` 로 실행):**
  - `canceled fo and its items are not marked shipped` — FO `canceled` + FOI qty 1 → 실행 뒤 FO `canceled`, FOI `shipped_qty 0`
  - `v2 canceled quantity is not marked shipped` — FOI qty 2, `canceled_qty 1` → `shipped_qty 1`
  - `ordinary order is marked shipped` — SO `pending`·FO `ready`·FOI qty 2 → SO `shipped`, FO `shipped`+`shipped_at`, FOI `shipped_qty 2`·`status 'shipped'`
- [ ] **Step 2:** `DATABASE_URL=…/k6_it npx jest --runInBand --runTestsByPath scripts/ops/cellmate-local/mark-core-shipped.integration.spec.ts` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** 같은 명령 PASS. `node -e "require('./scripts/ops/cellmate-local/mark-core-shipped.sql.js')"` 가 에러 없이 끝난다.
- [ ] **Step 5:** 커밋 — `fix(ops): 셀메이트 출고 표시가 취소된 FO·FOI 를 덮어쓰지 않는다 (K6 PR2b, F12)`

### Task 7: 가드 · 이월 정리 · ADR · 게이트 · PR

**Files:**
- Modify: `line-quantities/line-quantity-read.guard.spec.ts`
- Modify: `apps/core/src/modules/print-order/services/print-order-admin.manager.ts:13,143`, 그 spec 두 곳(`print-orders.service.spec.ts:44,254`, `print-order-admin.manager.spec.ts:270`) — 죽은 `PrintSalesCancelTarget.lineQuantity` 삭제(2a 이월)
- Modify: `docs/adr/0047-line-quantity-facts-one-record-one-reader.md`

- [ ] **Step 1: 가드 테스트를 더한다:**
  - `retired shipment-phase definitions stay gone` — `/\borderShipmentPhaseSql\b|\bderiveFulfillmentPhase\b|\bhasShippedEvidence\b|\bMOVED_SHIPMENT_STATUSES\b|\boutstandingSalesUnits\b|\bgetEffectiveShippedFulfillmentQty\b/` 에 걸리는 파일 `[]`(Task 4 가 `SelfCancelFacts.hasShippedEvidence` 를 `anyShipped` 로 바꿔 둔 전제).
  - `only the kernel reads delivery tracking for quantities` — `apps/core/src/modules/sales-order` 아래에서 `/shipment_tracking|shipmentTracking/` 를 쓰는 파일이 `[line-quantities.sql.ts, store-return-exchange.service.ts, store-sales-orders.service.ts]`. 셋째는 배송조회 화면의 추적 이벤트 목록(수량이 아니다), 둘째는 반품·교환 자격(PR 3 이 문으로 옮기고 이 목록에서 뺀다 — 주석으로 그렇게 적는다).
- [ ] **Step 2:** `npx jest apps/core/src/modules/sales-order/line-quantities/line-quantity-read.guard.spec.ts` → PASS. 실제로 잡는지: `sales-orders.service.ts` 에 임시로 `MOVED_SHIPMENT_STATUSES` 한 줄을 넣어 FAIL 을 보고 되돌린다.
- [ ] **Step 3:** `lineQuantity` 삭제 → `npx jest apps/core/src/modules/print-order` 실패 0.
- [ ] **Step 4: ADR-0047 갱신.** «PR 2b 가 정한 것» 절: SKU 층 관계·FOI 단위 정의(위 Task 1 Interfaces 의 표), 진행 단계 사다리가 SQL 한 벌인 이유, `cancellableSalesUnits` 가 TS 인 이유, P1~P8. «대체되는 것»에 이 PR 이 지운 이름(가드 Step 1 의 목록). 71행 «배포 전 게이트 SQL(라인 행 없는 취소 0)이 선행 조건» → «라인 행 없는 취소 수가 백필 `--verify` 의 (a) ambiguous + (b) 0행 도출 합과 같아야 한다 — 0 이 아닐 수 있다(V1 전체취소에 남은 게 없으면 0행)»(2a 이월).
- [ ] **Step 5: 게이트.** `npm run type-check` → 0(환경 에러 web-push·tauri 3건은 2a 기준선 — 그 외 0). `npx jest` → 실패 0(OOM 이면 `--maxWorkers=2`). 기준선 통합 묶음 + `scripts/ops/cellmate-local` 통합 → 새 실패 0.
- [ ] **Step 6:** 커밋 — `test(sales-order): 옛 출고 판정 이름 부활 금지 + 이월 정리 + ADR-0047 2b (K6 PR2b)`
- [ ] **Step 7:** `cancellation-plan.integration.spec` 의 ORDER BY 없는 flake(2a 이월)를 이슈로 연다 — 본문에 파일 경로와 «결과 순서를 단언하는 줄»을 도출하는 grep 명령을 적고 수치는 적지 않는다(CLAUDE.md). 레이블 `ready-for-agent`.
- [ ] **Step 8:** PR 을 연다(`mattpocock-skills:pr`). 본문에 «스펙에서 벗어나는 판단 두 개», P1~P8, 아래 배포 절차.

**배포 절차(PR 본문에 그대로):**
1. 배포 단위: Core, 마이그 없음. `npm run deploy:preflight -- --stage live`(배치 배포 방침). 2a(#1108)가 아직 미배포면 같이 실리므로 2a PR 본문의 게이트 둘도 함께 돈다.
2. **배포 전 게이트(터널은 사용자):**
   - G-a (P7) — FO 만 출고로 표시되고 FOI 는 덜 나간 항목. 기대 0. 0 이 아니면 그 FOI 들의 출고 판정이 바뀌므로 목록을 사람이 본다.
     ```sql
     SELECT count(*) FROM fulfillment_order_items foi JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
     WHERE (fo.status = 'shipped' OR fo.shipped_at IS NOT NULL) AND foi.shipped_qty < foi.qty - foi.canceled_qty;
     ```
   - G-b (F12 의 과거 피해) — 취소된 뒤 셀메이트 스크립트가 출고로 덮은 FO. 기대 0. 0 이 아니면 그 주문의 FOI 가 출고로 보인다 — 데이터 수정은 이 PR 밖, 사용자 판단. **FO 취소 버튼(`fulfillments.service.ts` 의 cancel)은 `canceled_at` 을 안 찍어서 그 경로의 피해는 이 SQL 로 못 찾는다** — 결과와 함께 그 한계를 적는다.
     ```sql
     SELECT count(*) FROM fulfillment_orders fo JOIN sales_orders so ON so.id = fo.sales_order_id
     WHERE fo.status = 'shipped' AND (fo.canceled_at IS NOT NULL OR so.status = 'cancelled');
     ```
   - G-d (P1) — 와우프레스가 배송완료를 안 준 채 오래 남은 인쇄 행. 기대값 없음(정보). 0 이 아니면 그 주문들의 관리자 단계가 `shipping` 에 머문다 — 목록을 사람이 본다.
     ```sql
     SELECT count(*) FROM print_orders WHERE status = 'shipped' AND shipped_at < now() - interval '14 days';
     ```
   - G-c 성능 — `EXPLAIN (ANALYZE, BUFFERS)` 로 일별 통계 SQL(31일)과 주문 목록 단계 SQL(최근 주문 100건)을 돌려 각각 5초 미만. 렌더된 SQL 은 `orderFulfillmentPhaseSql` 을 `PgDialect().sqlToQuery` 로 찍어 얻는다(빌더가 PR 본문에 붙인다).
3. **배포 직전·직후 숫자 대조:** `GET /sales-orders/stats/daily?from=<14일 전>&to=<오늘>` 와 `GET /sales-orders/stats` 를 배포 전후로 저장해 diff. 기대: 일별 통계는 인쇄 외주가 든 주문(P1)과 FO 만 취소된 주문(P2)의 칸만 움직이고, 카드는 «부분출고»만 움직일 수 있다(P6).

---

## 이 PR 에서 하지 않는 것

- 청구(반품·교환) 자격·`claimable`·`isReturnEligible` 교체, 교환 가드의 «FO completed = 배송완료»(D2·F4) — PR 3.
- 라인 단위 `anyShipped`·`shippedComplete` — 소비자가 생기는 K7·PR 3 에서.
- 배송조회의 전체 상태(`deriveOverallTrackingStatus`) — 소포 목록의 표시라 그대로. F11 은 고친다.
- 스토어프론트 단계 라벨(F1, D8) — PR 5. P3·P4 의 고객 화면 변화는 그 매핑을 거친다.
- admin-web 취소 모달의 출고 판정 — 단계로 바꾸면 넘긴 직배·인쇄 혼합 주문의 전체취소가 화면에서 막힌다(Task 5). 필요해지면 «실제로 나간 수량» 사실로.
- 운영자 «미처리 취소»·FO 취소·수동 배송완료 제거(D1·D10·D11) — PR 4.
- V2 쓰기 배분의 FOI 단위 `outstandingOf`(`v2-cancellation-units.ts`) — 쓰는 함수는 그 모듈에 남는다(G1).
- `record-cancellation.ts` 의 백필 전 대비와 `sumCancelledByLine` 삭제 — PR 6.
