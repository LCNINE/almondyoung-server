# K6 라인 수량 사실 — 사실마다 기록하는 곳은 하나, 읽는 문도 하나

2026-10-20 develop `6a62ec9d7` 코드 기준. 라이브 실측 없음. 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §5.2·§8.2 의 K6 이고, K1(ADR-0045)·K2(ADR-0046)의 방식을 따른다.
조사 원본(서브에이전트 셋의 보고와 직접 재확인)은 이 문서 §4·§5 에 옮겼다.

## 1. 왜

**사용자가 말한 이유는 막힌 버그가 아니라 구조 다지기다.** 판매주문 라인의 «몇 개 주문됐고, 몇 개가 취소·출고·배송완료·
청구됐고, 몇 개를 더 취소·반품할 수 있나»를 아는 곳이 여러 벌이고, 벌마다 기준이 다르다. K7(취소)·K8(환불·반품)이
이 숫자 위에 서므로 판매주문 줄기의 바닥이다.

재측정해 보니 감사보다 벌이 많다(출고 판정 7+, 배송완료 6, 진행 단계 6, 청구 수량 6). 그리고 같은 이음새에서
돈·고객 화면에 걸린 결함이 나왔다(§5). **사용자 결정(2026-10-20): 이 결함들은 따로 고치지 않고 K6 범위 안에서
소비자를 커널로 옮기며 고친다. 급하지 않다.**

## 2. 목표

- **G1. 사실마다 기록하는 곳이 하나다.** 기록하는 «함수»는 그 사실을 만드는 모듈에 남는다(출고=dispatch, 배송=추적,
  취소=판매주문 취소, 청구=반품·교환). K6 이 정하는 건 «어디에 기록하나»이고 «누가 기록하나»는 바꾸지 않는다.
- **G2. 읽는 문이 하나다.** 라인 ID(또는 주문 ID)를 주면 라인별 수량 묶음이 나온다. TS 판정·SQL 통계·자격 검사가
  모두 이 문만 읽는다. SQL 쪽은 같은 정의의 SQL 조각을 쓴다(§6.3).
- **G3. 불변식을 커널이 소유한다.** 예: 판매 단위 `취소 ≤ 주문`, SKU 단위 `출고 + 취소 ≤ 요구`.
- **G4. 정해진 곳 밖에서 그 사실을 쓰거나, 문을 거치지 않고 같은 사실을 다시 계산하면 가드 spec 이 빨갛다.**
- **G5. 동작 변경은 §8 의 이름 붙은 결정으로만 한다.**

## 3. 하지 않는 것 · 실패로 보는 것

**범위 밖(사용자 합의 2026-10-20):**
- **정체 보드의 운영 단계 판정**(`order-progress.judge-sql.ts`) — 작업 항목·송장·예약·복구코드를 보는 판정이라 수량으로
  환원되지 않는다. 손대지 않는다.
- **환불 금액 규칙** — K8. 예외는 §8 D6(수량 집계 결함)과 D7(세트 일부 반품은 관리자 입력)뿐이다.
  부분취소 환불 계산기(`partial-cancellation-refund-calculator.ts`)와 «반품 환불이 앞선 취소를 모른다»는 K8 로 넘긴다.
- **교체품 발송** — 지금 시스템 밖이다. 시스템 안으로 들이는 건 K8.
- **직배 파트너에게 취소 통지** — K7. K6 은 «파트너에게 넘긴 수량»을 따로 세어 K7 이 알 수 있게만 한다(§6.1).
- **스토어프론트 교환 화면에서 구성품 고르기 UI** — API 만 준비한다.
- **셀메이트 주문의 배송완료·청구** — 셀메이트가 시스템 밖에서 처리한다(사용자 증언 2026-10-20). 커널은 «모름»으로 둔다.

**실패로 보는 것:**
- K6 이 취소 엔진·출고·추적·반품의 «쓰는 코드»를 끌어와 새 god object 가 되는 것. 커널 파일에 업무 판단
  («이 취소를 허용하나», «얼마를 환불하나»)이 들어오면 실패다.
- 읽기만 모으고 두 출처의 어긋남을 커널 안의 «어느 쪽이 맞나» 규칙으로 영구히 들고 가는 것(사용자가 거절한 안).
- 셀메이트로 출고한 라이브 주문이 커널에서 «출고 0»으로 보이는 것.

## 4. 지금 지도

### 4.1 기록되는 곳

| 저장 위치 (`inventory.schema.ts`) | 칸 | 단위 | 비고 |
|---|---|---|---|
| `sales_order_lines` | `quantity` | 판매 | 원래 수량. 취소로 줄지 않는다 |
| `sales_order_line_compositions` | `skuId`, `qtyPerUnit` | 판매→SKU | FO 생성 순간 굳는다(#1063) |
| `sales_order_cancellations` | `cancellation_scope`, `metadata.cancelledLines` | 판매 | 취소의 SO 쪽 기록. **V1 전체취소는 `cancelledLines` 를 안 적는다**(`sales-orders.service.ts:667-676`) |
| `fulfillment_order_items` | `qty`, `shippedQty`, `canceledQty`, `status` | SKU | 셀메이트 스크립트도 `shipped_qty` 를 채운다 |
| `dispatch_attempt_sources` + `shipment_tracking` | `qty`, `status` | SKU | 실제 출고 소포와 배송 상태 |
| `fulfillment_orders.directShipStatus` | `pending/forwarded/completed/canceled` | FO | 직배 |
| `print_orders` | status | 라인 1행 | 인쇄 외주. FO 없음 |
| `return_request_items` | `salesOrderLineId`, `shipmentLineId?`, `dispatchAttemptId?`, `quantity` | 혼용(§5 C7) | |
| `exchange_request_items` | `salesOrderLineId`, `quantity`, `desiredVariantId` | 판매 | 소포·SKU 를 모른다 |

`sales_order_cancellations` 쓰기는 세 곳이다: `sales-orders.service.ts:675`(V1 전체), `:1575`(부분), `:1896`(V2).
`fulfillment_order_items.canceledQty` 쓰기는 `ShipmentPlanningService.applyDraftCancellation`(`shipment-planning.service.ts:1408-1461`)
하나이고, 진입점이 둘이다: 판매주문 V2 취소, 그리고 운영자 HTTP `POST /shipments/:id/cancellations`
(admin-web «미처리 취소» 버튼, `shipment-actions.tsx:69`).

**취소가 FOI 에 반영되는 물리 형태는 둘이다.** V1(상자 전) 부분취소와 구성 편집은 FOI `qty` 자체를 줄이고
(`sales-orders.service.ts:2310-2320`, `draft-box-amender.ts:198-201`), V2(상자 후)는 `canceledQty` 를 올린다. FO 생성 전
취소는 FO 를 처음부터 작게 만든다. **그리고 V1 은 이미 출고된 수량의 취소도 받는다** — FOI 는 건드리지 않고
`preserved_shipped_fulfillment_order_item`·`linked_post_shipment_*_handoff` 효과만 남긴다(`:2441-2488`). 라이브 주문엔 V2
상자가 없으므로 라이브 취소는 전부 V1 이고, 셀메이트로 나간 주문의 채널 사후취소가 이 «출고 뒤 취소»로 들어온다.

**판매주문 기록 없이 상태를 바꾸는 관리자 경로가 둘 더 있다.**
- FO 취소 `POST /fulfillments/:id/cancel`(`fulfillments.service.ts:659-705`) — admin-web FO 상세의 취소 버튼
  (`features/order/fulfillments/components/detail/index.tsx:100`)이 유일한 호출자. 모드와 무관하게 열려 있어 라이브에서
  누를 수 있다. FO 만 `canceled`, 예약 해제, `FulfillmentCancelled` 발행(channel-adapter·ugc 가 소비).
- 수동 배송완료 `POST /fulfillments/:id/deliver`(`fulfillments.service.ts:590-650`) — FO `shipped→completed` +
  `FulfillmentDelivered`. admin-web 훅 `useDeliverFulfillment` 는 정의·재수출만 있고 화면에서 부르는 곳이 0.

### 4.2 같은 사실을 계산하는 곳 (대표만, 근거는 §5)

- **취소 수량:** `loadPriorPartialCancellationContext`(`sales-orders.service.ts:2142`, partial 만), `cancelledQuantitySql`
  (`cancelled-quantity.sql.ts`, partial 만), `LineCompositionReader`(`line-composition.reader.ts:48-52`, **scope 무필터**),
  `outstandingSalesUnits`(`v2-cancellation-units.ts`), `getCancellableUnprocessedFulfillmentQty`(`sales-orders.service.ts:2367`).
- **출고:** `hasShippedEvidence`(`fulfillment-phase.ts:100`), `getStats.outboundComplete`(`sales-orders.service.ts:1272`, 주석
  «동일한 정의»는 틀림), `shipBlockCounts.partialOutbound`(`:1314`), `order-shipment-phase.sql.ts`, 취소 엔진 V1(`:574`, `:2062`),
  `getEffectiveShippedFulfillmentQty`(`:2378`), admin-web `cancel-order-modal.tsx:128`.
- **배송완료:** `isReturnEligible`(`fulfillment-phase.ts:83`), `assertOrderDelivered`(`store-return-exchange.service.ts:1515`,
  실제 뜻은 «FO 전량 출고 정산»), `assertAttemptBasedReturnEligibility`(`:1588`), `deriveOverallTrackingStatus`
  (`store-sales-orders.service.ts:1714`), `FulfillmentDelivered` 판정(`shipment-delivery-tracking.service.ts:520-540`).
- **진행 단계(고객·관리자):** `order-shipment-phase.sql.ts`(관리자 뱃지·일별 통계), `fulfillment-phase.ts`(고객 actions).
- **청구 수량:** `store-return-exchange.service.ts` 안 A `buildReturnEligibility`(:341), B `assertAttemptBasedReturnEligibility`
  (:1589), C `assertPurchasedQuantityReturnCap`(:1762), D `assertReturnQuantitiesAvailable`(:1815), E
  `assertExchangeQuantitiesAvailable`(:1894), F `enqueueReturnCompletedEvent`(:779). `ACTIVE_*` 상수는 두 파일에 복붙.

## 5. 이 작업이 함께 고치는 결함

라이브 피해 판단의 전제: **반품·교환 코드는 라이브에서 돈 적이 없다**(사용자 증언 2026-10-20 — 반품·교환은
셀메이트에서 처리). 출고도 셀메이트다. 그래서 C·S 계열은 warehouse-app 컷오버 뒤 처음 실전에 들어갈 결함이다.

| # | 결함 | 근거 | 라이브 |
|---|---|---|---|
| F1 | 스토어프론트가 core 의 `preparing`·`shipping` 을 모른다 → 배송 중 주문이 «결제 완료» | core `store-order-actions.dto.ts:6-11` vs `web/almondyoung-storefront/src/components/orders/order-status-display.ts:21-26`. 직접 확인 | 셀메이트 주문은 SO `shipped` 라 «배송 중»으로 보일 수 있음. 화면 실측 안 함 |
| F2 | 반품 환불이 같은 판매 라인의 여러 줄 중 마지막 줄만 센다 → 과소 환불 | `store-return-exchange.service.ts:2088` `new Map(...)`. 직접 확인 | 없음 |
| F3 | 환불 끝난 수량을 교환 접수(E 가 완료 반품을 안 셈), 교환 진행 중 수량을 다시 반품(C·D 가 따로 검사) | E `:1894-1966`, C `:1762-1808`. 직접 확인 | 없음 |
| F4 | 교환 가드가 «FO completed = 배송완료»로 본다 → 배송 전 교환 | `:1515-1527`. 직접 확인 | 없음 |
| F5 | 운영자 «미처리 취소»가 SO 기록·환불·이벤트 없이 상자에서만 뺀다 → 뒤 고객 취소 400, `FulfillmentShipped` 미발행 | §4.1 | V2 상자가 라이브에서 안 쓰여 없을 것 |
| F6 | 취소 수량 파서 셋의 scope 필터가 다르다(리더만 `full` 포함) | §4.2 | 소비자 가드에 가려짐 |
| F7 | 교환 줄 중복으로 상한 초과, 교환이 출고·취소 무시, D·E 는 트랜잭션·잠금 밖 | E | 없음 |
| F8 | 묶음 라인: 반품 자격은 SKU 단위, 상한·환불은 판매 단위 → 구성품 하나 반품에 라인 전액 | A·B vs C·D·환불 | 없음 |
| F9 | ugc 적립 회수가 원 라인 수량과 비교 → 부분취소 뒤 반품하면 미회수 | F `:752,804`, `apps/ugc-service/src/reviews/rewards/order-return.policy.ts` | 없음 |
| F10 | 나눠 보낸 주문(#1093)이 관리자 카드 셋 어디에도 안 잡힘 | `getStats`·`shipBlockCounts` | 셀메이트 주문엔 해당 없음 |
| F11 | 합쳐진(`superseded`) 상자가 배송조회에 섞여 «배송 중» 고정 | `store-sales-orders.service.ts:1714` | 없음 |
| F12 | 셀메이트 스크립트의 FO 갱신 조건이 `status<>'shipped'` 뿐이라 `canceled` FO 와 그 FOI 까지 출고로 덮어쓴다 | `scripts/ops/cellmate-local/mark-core-shipped.js` | 가능(빈도 미확인) |
| F14 | 스토어프론트 반품 요청은 `{salesOrderLineId, quantity}` 만 보내는데 core DTO 는 `shipmentLineId`·`dispatchAttemptId` 필수 → 모든 주문에서 400 | `web/almondyoung-storefront/src/domains/order/exchange/exchange-client.tsx:158-180`, `store-return-request.dto.ts:24-30` | 없음(반품은 셀메이트) |
| F13 | qty 0(구성 대체) FOI 를 투영이 `canceled` 로 저장 → admin-web 의 «대체됨» 판정과 상충 가능 | `fulfillment-progress.service.ts:62-76`, `line-composition-view.ts:20-24` | 실측 안 함 |

## 6. 설계

### 6.1 커널이 내는 사실

라인 하나에 대해 두 층을 낸다. **바닥은 SKU(구성품) 단위, 위는 판매 단위 환산**이다(사용자 결정: 청구는 구성품
단위가 기본). 구성이 굳기 전(FO 전)에는 SKU 층이 비고 판매 단위만 있다.

**판매 단위(라인):**
- `ordered` — `sales_order_lines.quantity`
- `canceled` — 취소 기록(§6.2)의 합. scope 와 무관하게 «취소된 판매 단위». 두 갈래로 낸다:
  `canceledBeforeShipment`(출고 전 취소, 수요를 줄임)와 `canceledAfterShipment`(이미 나간 수량의 취소 — V1 사후취소.
  돈은 돌려줬고 물건은 고객에게 있다). 갈래는 취소 라인 행의 칸으로 기록한다(§6.2, 내 판단)
- `demand = ordered − canceledBeforeShipment`
- `shippedComplete` — 구성품 모두가 나간 세트 수 = min over SKU of floor(shipped ÷ qtyPerUnit)
- `anyShipped` — 구성품 중 하나라도 출고됨(또는 파트너에게 넘김). 고객 셀프취소 차단 등에 쓴다
- `cancellable` — 아직 아무 구성품도 나가지 않은 판매 단위. 정확한 공식은 현행 `outstandingSalesUnits` 와
  `physicalCancellationByItem` 의 의미를 보존한다(빌더 몫, §10)

**SKU 단위(라인 × 구성품):**
- `required = demand × qtyPerUnit`(FOI 가 있으면 FOI 기준)
- `forwarded` — 직배로 파트너에게 넘겼고 아직 출고 확정 전. **출고가 아니다**(사용자 증언: 넘긴 뒤에도 취소 가능해야 함)
- `shipped` — FOI `shippedQty`(셀메이트 포함). 인쇄 외주 라인은 `print_orders` 가 shipped/delivered 면 전량
- `delivered` — 소포(출고 시도) 단위로 배송 추적이 `delivered` 인 수량의 합. 셀메이트·직배는 소포 기록이 없어 0(=«모름»)
- `claimedActive{return,exchange}`, `returnConsumed`(완료 반품) — 청구
- `claimable = delivered − returnConsumed − claimedActive(return + exchange) − canceledAfterShipment×qtyPerUnit`
  (사후취소로 이미 돈을 돌려준 수량은 다시 반품할 수 없다 — 내 판단). **완료된 교환은 차감하지 않는다**
  (사용자 결정: 교환품도 재교환·반품 가능, 관리자는 이력만 보면 됨)

청구 자격은 소포 단위로도 낸다: (출고 시도 × 상자 줄)별 `delivered − 청구`. 반품·교환 생성이 «어느 소포의 무엇»을
고르기 때문이다(결정 기록 `docs/outbound-consolidation-split-backorder-decision-record.md` §7).

디지털 라인(`requiresShipping=false`)은 SKU 층이 없고 출고 사실은 해당 없음으로 낸다.

### 6.2 기록하는 곳을 하나로

| 사실 | 하나뿐인 기록 | 바뀌는 것 |
|---|---|---|
| 취소 | **새 테이블 `sales_order_cancellation_lines`**(취소 행 × 판매 라인 × 수량 × 출고 전/후 갈래) | `metadata.cancelledLines` JSON 을 대체. V1 전체취소도 라인 행을 적는다. 출고 뒤 취소는 `preserved_shipped_*` 효과에서 갈래를 정한다. FOI 의 `qty` 감소·`canceledQty` 는 «취소가 출고 항목에 반영된 결과»로만 남고(형태 둘, §4.1) 커널은 취소 수량을 FOI 에서 읽지 않는다. 판매주문 취소 말고는 FOI 를 줄이거나 `canceledQty` 를 올리지 못한다(구성 편집의 `qty` 감소는 취소가 아니므로 예외 — 가드가 구분) |
| 출고 | FOI `shippedQty`(+소포는 `dispatch_attempt_sources`) | 없음. 셀메이트 스크립트만 F12 수정 |
| 파트너 넘김 | `fulfillment_orders.directShipStatus` | 없음. 커널이 수량으로 읽는다 |
| 배송 | `shipment_tracking`(소포 단위) | 없음. FO `completed` 를 배송으로 읽는 곳을 없앤다 |
| 청구 | `return_request_items`, `exchange_request_items` | 교환 항목에 `shipment_line_id`·`dispatch_attempt_id` 추가(nullable, expand). 두 항목의 `quantity` 를 SKU 단위로 정의(§8 D5) |

**운영자 «미처리 취소»는 없앤다**(사용자 결정 2026-10-20). admin-web 버튼과 `POST /shipments/:id/cancellations` 를 지우고
`cancelOutstanding` 은 판매주문 취소만 부르는 내부 단계로 남긴다. 결품처럼 «못 보내는 수량»은 나눠 보내기(#1093~#1095)가
맡고, 고객에게 안 보내기로 하면 주문 취소다.

### 6.3 읽는 문

- 위치(내 판단): `apps/core/src/modules/sales-order/line-quantities/`. FOI·소포·추적까지 읽으므로 cross-BC seam 이다 —
  `DbService<MergedSchema>` 목록에 하나 더한다(ADR-0025).
- **정의는 SQL 조각 하나**(Drizzle `sql` 빌더, `cancelledQuantitySql` 의 본). TS 문(`LineQuantityReader`)은 그 조각을
  select 해서 판정에 쓰고, SQL 통계는 같은 조각을 조인한다. TS 에서 따로 다시 계산하지 않는다.
- 일치 spec: TS 문의 결과와 SQL 조각을 직접 조인한 결과가 픽스처 전 시나리오(§5 의 결함 시나리오 포함)에서 같다.
- 커널은 업무 판단을 하지 않는다. «취소 가능한가»는 `cancellable > 0` 같은 사실을 읽은 K7(지금은 취소 엔진)이 정한다.

### 6.4 진행 단계는 수량의 투영

`not_created / preparing / shipping / delivered / canceled` 를 정하는 **순수 함수 하나**를 둔다. 입력은 K6 수량 +
FO 전량 취소 여부 + SO `status`(셀메이트가 쓰는 `shipped` → 관리자용 `external_shipped`). 관리자 뱃지·일별 통계
(`order-shipment-phase.sql.ts`)와 고객 actions(`fulfillment-phase.ts`)가 같이 쓴다.

**단계는 표시용 투영이라 수량 사실과 일부러 다르게 읽는 입력이 있다(내 판단: 현행 화면 유지).** 직배 `forwarded` 는
출고 수량이 아니지만 화면에서는 «배송 중», 직배 `completed` 는 배송완료 수량이 0(모름)이지만 화면에서는 «배송 완료»로
지금처럼 보인다(`order-shipment-phase.sql.ts:39`, `fulfillment-phase.ts:38-42`). 셀메이트 주문은 관리자 `external_shipped`,
고객 «배송 중». 청구 자격은 화면 단계가 아니라 §6.1 의 `claimable` 로만 연다. SQL 쪽이 필요하면 같은 규칙의 SQL 판과
일치 spec 을 둔다. 인쇄 외주·직배·셀메이트를 두 화면이 같은 규칙으로 본다.

### 6.5 소비자 옮기기

§4.2 의 모든 계산 지점을 문으로 옮긴다. 옮기면서 F2·F3·F4·F6·F7·F8·F10·F11 이 사라진다. 그 밖에:
- 반품·교환 생성: 라인 `FOR UPDATE` 뒤 한 트랜잭션에서 문을 읽고 검사한다(F7). 요청 줄은 (라인, SKU, 소포)로 합산한다.
- `calculateReturnRefund`: 판매 라인별 수량을 합산하고 SKU→판매 단위로 환산한다(F2). 세트 일부면 자동 금액을 내지
  않는다(§8 D7).
- `SalesOrderReturned` 이벤트(내 판단): 기존 `returnedQuantity`·`orderedQuantity` 는 **판매 단위로 유지**한다.
  `returnedQuantity` = 완전히 돌아온 세트 수(구성품별 내림의 최솟값) — 세트 일부 반품은 0 이라 적립을 과하게 회수하지
  않는다. ugc 가 «라인에 남은 수량»(`remainingQuantity` = `LineQuantities.remaining`)과 비교하도록 optional additive 필드를 더한다(F9). `demand` 가 아닌 이유: 출고 뒤 취소가 있으면 `claimable` 이 줄어 `demand` 와 영영 같아지지 않아 전량 반품 회수가 안 된다(PR 3b 에서 정정).
- 반품·교환 API 의 (SKU, 소포) 입력(내 판단): 라인이 단일 SKU 구성이고 청구 가능한 소포 후보가 하나뿐이면 라인 단위
  요청을 서버가 펼친다. 모호하면(세트, 소포 여럿) 400 과 후보 목록을 돌려준다. 스토어프론트 교환은 단품에서 계속 동작하고,
  세트 교환은 구성품 선택 UI(범위 밖)가 생길 때까지 막힌다 — 지금 시스템 내 교환이 라이브에서 안 쓰이므로 잃는 것 없음.
- 스토어프론트 라벨을 core 값으로 맞춘다(F1). 배송조회에서 `superseded` 상자를 뺀다(F11).
- 관리자 카드(«출고완료»·«부분출고»)를 문에서 다시 정의한다(F10). 정의는 빌더가 문서화하고 사용자 확인.

### 6.6 가드

- `sales_order_cancellation_lines` INSERT 는 판매주문 취소 모듈 밖에서 금지.
- FOI `canceledQty` 쓰기는 `applyDraftCancellation` 하나, 그 호출자는 판매주문 취소 하나.
- `metadata.cancelledLines`·`cancelledQuantitySql`·`sumCancelledByLine` 같은 옛 파서 이름이 되살아나면 빨강.
- `return_request_items`·`exchange_request_items` 를 읽는 수량 계산은 커널 밖에서 금지.
  (본: `libs/cron-once` 가드, K1·K2 가드 spec)

## 7. 셀메이트·직배·인쇄

- **셀메이트(라이브 출고 경로, 곧 warehouse-app 빅뱅 컷오버로 사라짐):** `mark-core-shipped.js` 가 FOI `shipped_qty` 를
  채우므로 커널은 출고를 안다. 배송·청구는 모름. 스크립트 수정은 F12 하나(`canceled` FO·FOI 는 건너뛴다).
  기준 세계는 warehouse-app(소포 + 추적이 진실)이다.
- **직배(라이브 사용 중):** `forwarded` 는 출고가 아니다. 파트너 «완료»(`markOrdersAsCompleted`)가 출고를 기록한다.
  파트너 완료가 고객 수령인지 알 수 없어 `delivered` 는 0(모름) — 직배 라인의 시스템 내 반품·교환은 K8 까지 열리지
  않는다. 지금 반품은 DTO 에서 이미 막히고(F14), 교환은 FO `completed` 일 때만 열리는데 그걸 만드는 수동 배송완료는
  화면 호출이 0 이다(D10). 반품·교환이 라이브에서 시스템 밖(셀메이트)이므로 잃는 것이 없다.
  **⚠️ 지금 넘긴 뒤 관리자·채널 취소는 파트너 통지 없이 core 에서만 취소된다.** K6 은 이를 고치지 않고(K7),
  고객 셀프취소는 «넘긴 뒤 막힘»을 유지한다.
- **인쇄 외주:** 라인당 `print_orders` 1행. 인쇄 상태 shipped/delivered 를 그 라인의 출고(전량)로 읽는다. 소포가 없어
  `delivered` 는 고객 단계 표시용으로만 인쇄 상태를 쓰고 청구 자격은 열지 않는다(지금과 같음).

## 8. 이름 붙은 동작 변경

- **D1. 운영자 «미처리 취소» 제거.** 버튼·엔드포인트 삭제(사용자 결정).
- **D2. 교환 자격은 «소포가 배송완료»** — FO `completed` 를 보지 않는다(F4). 반품과 같은 기준.
- **D3. 완료 반품은 교환에서도 소진, 완료 교환은 어디서도 소진 아님**(사용자 결정). 반품·교환이 한 공식 `claimable` 을 쓴다.
- **D4. 청구는 구성품(SKU) 단위**(사용자 결정: 교환은 반드시 구성품별, 반품도 허용하되 승인은 관리자 판단).
- **D5. `return_request_items.quantity`·`exchange_request_items.quantity` 를 SKU 단위로 정의.** 라이브 행이 0 이라는
  실측이 배포 전 게이트다(§11). 0 이 아니면 이 결정을 다시 연다.
- **D6. 반품 환불 수량은 판매 라인별 합산**(F2).
- **D7. 세트 일부 반품은 자동 금액 없음 — 관리자가 금액을 입력하고 시스템은 상한만 지킨다**(사용자 결정). 상한 =
  이 요청이 건드린 라인들의 배분액(라인 금액 비례)을 취소 안 된 비율(`remaining` ÷ 주문 수량)로 줄여 합하고 앞선 완료 반품의 아는 환불액(`return_refund_attempts` `succeeded` 합, 없으면 금액 모름 → 그 라인 배분액 0)을 뺀 값, 내림 — `returnRefundCap`(PR 3b 에서 정정). 입력한 금액은 반품 요청에 저장하고, 완료
  (`:856`)와 재시도(`:946`)가 다시 계산하지 않고 그 값을 쓴다. 세트 통째·단품은 지금처럼 자동.
- **D8. 스토어프론트 단계 라벨이 core 값을 따른다**(F1). 고객 화면 문구가 «결제 완료»에서 «상품 준비 중»·«배송 중»으로
  바뀌는 주문이 생긴다.
- **D10. 수동 배송완료 엔드포인트 제거**(내 판단 — 화면 호출 0, 배송 사실은 추적에만 기록한다는 G1 과 충돌).
- **D11. 관리자 FO 취소 버튼·`POST /fulfillments/:id/cancel` 제거**(사용자 결정 2026-10-20 — 쓰임새를 아는 사람이 없다). 취소는 주문 취소로만 한다.
- **D9. 관리자·고객 진행 단계가 같은 규칙.** 인쇄만 있는 주문의 관리자 뱃지가 `preparing` 고정에서 벗어나는 등, 뱃지와
  일별 통계 수치가 바뀐다.

## 9. 진행 (제안, 빌더가 계획에서 확정)

1. **expand** — `sales_order_cancellation_lines` 생성 + 세 쓰기 지점 이중 기록 + 백필 스크립트(옛 `cancelledLines` 와
   V1 전체취소 역산); 교환 항목 소포 칸; 반품 요청의 관리자 입력 금액 칸. **`migrate → deploy`.**
2. **커널** — 읽는 문 + SQL 조각 + 일치 spec + 진행 단계 순수 함수. 취소·출고 소비자 전환(취소 엔진 내부 읽기,
   수요 통계, 인쇄 보드, 구성 리더, 채널 diff, 관리자 카드, 뱃지·고객 actions). 셀메이트 스크립트 F12.
3. **청구** — 반품·교환 게이트·환불 수량·세트 일부 금액·ugc 필드(D2~D7). admin-web 금액 입력.
4. **D1·D10·D11** — 미처리 취소, 수동 배송완료, FO 취소 버튼·엔드포인트 제거. `FulfillmentCancelled` 의 다른 생산자가 없으면 소비자(channel-adapter·ugc) 쪽 정리 여부를 빌더가 확인.
5. **스토어프론트** — D8·F11(배송조회는 core 쪽이면 2 에 포함).
6. **contract** — `metadata.cancelledLines` 쓰기 중단, 옛 파서 삭제, 가드 spec. 1 의 백필이 라이브에서 끝나고
   한 번 이상 배포된 뒤(ADR-0005 §5).

ADR 하나(0047 예상)를 쓴다: «라인 수량 사실은 기록 위치 하나·읽는 문 하나».

## 10. 빌더에게 맡기는 것

- `cancellable` 의 정확한 공식(현행 V1/V2 의 «상자 전/후» 의미 보존, 묶음 부분 출고 처리).
- SQL 조각의 모양(뷰 vs 함수 vs Drizzle 조각). 단 정의는 한 벌.
- 관리자 카드 정의 문구.
- 백필의 모호 행 처리(#1063 백필 방식: 옛 규칙과 교차 확인, 어긋나면 ambiguous 로 보고).
- 커널 파일 배치와 이름.

## 11. 배포

- 1(expand)은 `migrate → deploy`. 6(contract)은 `deploy → migrate`.
- **D5 게이트:** 배포 전 라이브 `return_request_items`·`exchange_request_items` 행 수 실측(터널은 사용자).
- 이벤트 additive 필드(ugc)는 core·ugc 어느 쪽이 먼저여도 된다 — 확인은 빌더가 `libs` 계약 스키마로.
- 스토어프론트는 별도 배포 단위.
- 배치 배포 방침(2026-10-18)에 따라 `npm run deploy:preflight -- --stage live` 를 돌린다.

## 12. 곁에서 찾은 것 (이 작업 밖)

- **스토어프론트 반품은 지금 모든 주문에서 400 이다(F14).** warehouse-app 컷오버로 반품이 시스템 안으로 들어오기 전에
  스토어프론트 반품 화면이 소포·SKU 를 고르게 바뀌어야 한다 — K8 또는 컷오버 준비 목록.

- **직배 넘김 뒤 취소가 파트너에게 안 알려진다** — 라이브 위험. K7 에서 다룬다. 그 전에 운영 절차로 막을지 사용자 판단.
- 감사 §5.2 정정: «환불 공식 두 벌이 다른 금액»은 지금 도달하지 않는다(부분취소 계산기 비례 분기는 medusa 가
  아니면 첫 줄에서 0, 유일 호출자는 3pl 경로). 감사의 «배송완료» 정의 중 교환 가드는 «출고 정산»이다.
- admin-web 고객 상세 `order-view.ts:25-52` 가 Medusa 네이티브 `shipped_quantity` 를 읽는데 core 는 그 값을 밀지 않는다
  (확인 못 함).
- `scope='full'` 의 V1/V2 의미 차이(V2 full = «남은 미출고 전부», 출고분 있어도 성공) — K7.
