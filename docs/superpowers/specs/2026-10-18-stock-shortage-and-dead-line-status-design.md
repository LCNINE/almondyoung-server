# 재고 부족 주문은 정체 보드에서 나눠 보낸다 · 생산자 없는 라인 상태를 걷어 낸다 (#1016 15번)

2026-10-18 develop `a999872ee` 코드 기준. 라이브 실측 없음.

## 1. 왜

#1016 15번은 «통계·필터가 생산자 없는 상태값을 읽는다»였다. 들여다보니 칸 둘의 사정이 다르고, 첫 칸이 맡은 척하던 일
(재고 부족 주문 알아채기)은 컷오버 뒤 관리자가 실제로 해야 하는 일이다.

### 1.1 라인 상태 `sales_order_lines.status` — 쓰는 곳이 없다

enum `order_item_status` 는 `pending`·`matched`·`stock_deducted`·`stock_unavailable`·`cancelled` 다섯 값인데, 쓰는 곳은
주문 생성의 `status: 'pending'` 하나뿐이다(`sales-orders.service.ts:321`). `update(salesOrderLines)` 는 `line-composition.manager.ts`
셋뿐이고 status 를 건드리지 않는다. 같은 줄의 `suggested_quantity`·`unavailable_sku_ids`·`deducted_at` 도 생성 때 한 번 쓰이고
아무도 갱신하지 않는다.

읽는 곳은 그래서 모두 «늘 0»이거나 «늘 같은 답»이다.

| 읽는 곳 | 결과 |
|---|---|
| `SalesOrdersService.getStats` → `shipBlockCounts` (`sales-orders.service.ts:1336`) — 어드민 메인 «출고불가»(`MainTemplate.tsx:120`), 통계 개요 «출고 불가(재고)»(`statistics/template/overview.tsx:174`), 주문내역 상단 «출고불가·부분출고»(`order/history/components/status-section/index.tsx:60-61`) | 늘 0 |
| 주문 목록 `typeGroup` `ready`·`partial`·`hold` (`sales-orders.service.ts:937-947`, admin-web `contexts/filter.context.tsx`) | 늘 0건 |
| 주문내역 줄 배지 «출고가능·출고불가» (`table/index.tsx:86-97`), `isReadyToShip`·`isUnavailable` (`hooks/use-order-rows.ts:272-275`) | 안 뜬다 |
| 주문내역 줄 선택 `isOrderSelectable` = 전 라인 `stock_deducted` (`table/index.tsx:711-712`) | 아무 줄도 선택 안 됨. 선택을 쓰는 일괄 동작도 없다 |
| 발주 수요 `demand-series.writer.ts:99` `sol.status <> 'cancelled'` | **결함.** 늘 참이라 부분취소된 수량이 수요에 남는다 |
| 인쇄주문 취소 대상 `print-order-admin.manager.ts:142` `lineStatus === 'cancelled'` | **결함.** 늘 거짓이라 부분취소된 라인을 못 거른다 |
| `product-matching.service.ts:793` `lineStatus` | 응답에 실어 보낼 뿐 |
| CS 주문조회 `cs/order-lookup/index.tsx:20-21,240` — `line.status` 를 «재고차감(출고가능)»·«재고부족» 라벨로 | 늘 «대기» |

판매주문 라인 수량은 부분취소로 줄지 않는다. **라인 단위 부분취소 수량의 정본은 `sales_order_cancellations.metadata.cancelledLines` 의 합**이고,
같은 계산이 이미 세 벌 있다 — `SalesOrdersService.getCancelledQuantityByLine`(`sales-orders.service.ts:2160`), SQL 판 `cancelledQuantitySql`
(`print-order/services/print-order.reader.ts:70-84`), 순수 함수 `sumCancelledByLine`(`product-matching/line-composition/partial-cancellation.ts`,
`line-composition.reader.ts:61` 이 `fulfillableQuantity = quantity − cancelled` 를 낸다). FO 아이템 `canceled_qty` 는 SKU 단위(라인 수량 × `qtyPerUnit`)라
라인 수량에서 빼면 단위가 섞인다.

### 1.2 주문 상태 `shipped`·`delivered` — 코드는 안 쓰지만 셀메이트 스크립트가 쓴다

`orderStatusEnum` 주석은 이 둘을 «[DEAD] 미사용»이라 적었지만(`inventory.schema.ts:163-169`), `scripts/sellmate/mark-shipped-from-csv.ts`
가 쓴다(2026-10-05 라이브 `shipped` 4,438). 컷오버 뒤 새로 생기지 않지만 옛 행은 남는다.

이 값을 «core 밖에서 나갔다»는 뜻으로 일부러 읽는 곳은 옳다: 정체 보드 종료 `external_shipped`(`order-progress.judge-sql.ts:189`,
정체 보드 스펙 D3), 채널 변경 판정(`channel-order-change.manager.ts:32`), 환불 뒤 취소 생략(`store-sales-orders.service.ts:390`),
반품 배달 판정(`store-return-exchange.service.ts:1516`).

틀린 곳은 일별 통계다. `getDailyStatusStats`(`sales-orders.service.ts:1165`)는 상자·직배로 단계를 정하는데 셀메이트 출고분엔 core 상자가 없어
**«준비중»으로 센다.** 주문내역 «출고완료» 배지(`table/index.tsx:80-84`)도 이 값을 읽는다.

### 1.3 컷오버 뒤 관리자가 해야 하는 일

10종을 주문했는데 1종이 재고가 없고 입고도 늦을 것 같다. 관리자는 그런 주문을 알아채고, 무엇이 몇 개 모자란지 보고, 고객에게 물어본 뒤
**있는 9종부터 먼저 보내고 싶다.** 판단은 건마다 관리자가 한다(규칙으로 자동 분할하지 않는다).

부품은 대부분 있다.

- 주문이 오면 FO 와 draft 상자가 생기고 상자 라인마다 예약한다. 모자란 라인은 덜 예약된 채 남고, 재고가 생기면
  `FulfillmentOrderReservationRetryWorker`(10초)가 오래된 순으로 다시 예약한다.
- `plan` 은 상자의 전 라인이 다 예약돼야 통과한다(`assertFullyReserved`, `shipment-planning.service.ts:1587`, `SHIPMENT_NOT_FULLY_RESERVED`).
- draft 상자 분할 `ShipmentPlanningService.split`(`POST /shipments/:id/splits`)이 있다. 서버는 원래 상자에 수량이 남기만 하면 라인을 통째로 옮기는 것도 허용하고,
  옮길 몫의 예약 수량(`targetReservedQty`)도 정할 수 있다.
- FO 상세 «재고» 탭이 아이템별 «예약됨 / 미예약(부족)»을 보인다(`fulfillments/detail/inventory-tab.tsx:59`).
- 정체 보드 «3 예약» 단계가 `created`·`partially_reserved` 로 센다(갇힘 기준 3일, `order-progress.thresholds.ts:139`).

끊긴 곳은 이렇다.

- 입구(메인 숫자·배지)가 라인 상태를 읽어 죽어 있다.
- FO 상세 분할 화면은 수량을 «원본 라인 수량보다 작게»만 받는다(`fulfillments/detail/shipment-actions.tsx:209`) — 모자란 라인을 통째로 빼는 바로 그 동작이 안 된다. 한 번에 라인 하나만 옮긴다.
- 보드 줄을 누르면 주문내역으로 가는데 거기엔 부족 정보가 없다.
- 주문내역 «주문 나누기» 모달은 «WMS API 추가 필요» 껍데기다(`order/history/components/modals/split-order-modal.tsx`).
- **보드의 «예약» 판정이 상자가 아니라 FO 단위다.** `box.under_reserved` 는 `fo.status IN ('created','partially_reserved')`
  (`order-progress.judge-sql.ts:39`)이고 FO 상태는 FO 아이템 전체 예약 합으로 정해진다(`fulfillment-progress.service.ts:107-122`).
  그래서 나눠 보낸 뒤 다 예약된 9종 상자도 FO 가 여전히 `partially_reserved` 라 «예약»으로 판정된다.

## 2. 목표 · 비목표 · 반목표

**목표**

1. 관리자가 재고 부족 주문을 **정체 보드 «3 예약» 칸**에서 보고, 그 줄에서 **«있는 것 먼저»** 로 나눠 보낼 수 있다.
2. 메인·통계·주문내역의 «출고불가» 숫자가 보드와 **같은 판정**으로 센다.
3. 라인 상태를 읽는 곳을 모두 실제 출처(상자·예약·FO)로 옮기고, 죽은 칼럼 넷과 enum 을 contract 순서로 지운다.
4. 일별 통계와 주문내역이 셀메이트 출고분을 **«외부 출고»** 로 따로 보인다.

**비목표**

- «나머지 취소»(있는 것만 받고 모자란 몫은 부분취소·환불). 필요해지면 같은 줄 동작에 더한다 — 채널 주문은 판단 10(채널 먼저) 경로다.
- 자동 계획(#1016 18번). 이 설계는 «분할 뒤 다 예약된 상자는 18번이 계획한다»를 전제로 한다. 18번은 컷오버 전에 따로 한다.
- 규칙 기반 자동 분할(«입고가 N일 넘게 늦으면 나눠 보낸다»).
- 관리자 «확인함·입고 대기» 표시. 새 부족 건과 이미 고객과 얘기한 건을 구분하지 않는다 — 기다린 시간 순이면 충분하다(사용자 결정).
- 배송비 처리. 상자가 둘이 되면 배송비가 두 번 드는 건 고객과 얘기하는 단계의 몫이다.
- 주문 상태 enum 의 `processing`·`shipped`·`delivered` 물리 제거.

**반목표 — 이렇게 되면 동작해도 실패다**

- «출고불가»를 두 곳 이상에서 따로 판정한다. 지금 문제가 정확히 그것이다.
- 셀메이트 출고분을 «배송완료»로 합친다. 배달을 확인한 적 없는 것을 확인한 것처럼 보이게 한다.
- 셀메이트 의미로 `shipped`·`delivered` 를 읽는 곳(§1.2 의 넷)을 «죽은 값»이라며 지운다.
- 칼럼 DROP 을 읽기 중단과 같은 PR·같은 배포에 싣는다.

## 3. 결정

| # | 결정 | 출처 |
|---|---|---|
| D1 | 재고 부족 처리의 출발점은 **정체 보드 «3 예약» 칸**이다. 전용 페이지·주문내역 출발은 두지 않는다 | 사용자 |
| D2 | 판단은 건마다 관리자가 한다. 줄 동작은 **«있는 것 먼저» 하나** | 사용자 |
| D3 | «확인함» 표시 없음. 기다린 시간 순 | 사용자 |
| D4 | 분할 뒤 계획은 18번(자동 계획) 몫. «있는 것 먼저»는 분할만 한다 | 사용자(18번을 컷오버 전에 함) |
| D5 | 주문내역의 `typeGroup` `ready`·`partial`·`hold` 필터와 줄 선택 체크박스는 **지운다**. 줄 배지는 **«출고 단계» 배지 하나**로 바꾼다 | 사용자(권장안 수락) |
| D6 | 일별 통계에 **«외부 출고»** 칸을 따로 둔다. 주문내역 «출고 단계» 배지도 같은 이름 | 사용자 |
| D7 | 보드 «예약» 판정을 **상자 단위**로 바꾼다 — 상자 라인의 확정 예약 합 < 상자 라인 수량이면 «예약». FO 상태로 판정하지 않는다 | 내 판단(§1.3 마지막 항목 없이는 D4 가 성립하지 않는다) |
| D8 | «있는 것 먼저» = 그 상자의 **미예약 수량 전부**를 새 draft 상자로 옮긴다. 일부 예약된 라인(3 중 2)은 미예약 몫(1)만, 예약 0 인 라인은 통째로. 옮기는 몫의 `targetReservedQty` 는 0. 관리자가 라인을 고르는 단계는 없다 | 내 판단 |
| D9 | 메인·통계·주문내역의 «출고불가» = 보드 판정에서 «예약» 단계에 있는 주문 수. 누르면 보드의 그 칸으로 간다. «부분출고» = 그중 다른 상자가 이미 움직인(`shipped`·`in_transit`·`failed`·`delivered`) 주문 수 | 내 판단 |
| D10 | 발주 수요·인쇄주문 취소 판정은 부분취소를 기존 라인 단위 계산(`cancelledQuantitySql` 등, §1.1)에서 읽는다. 새 계산을 만들지 않는다 | 내 판단(§1.1 결함, 리뷰에서 출처 교정) |
| D13 | 합포장 draft 상자(다른 주문 라인을 담은 상자)는 «있는 것 먼저»를 거절한다. 판정은 상자 전체로 잰다 — plan 이 상자 전체의 예약을 요구하기 때문이다 | 내 판단 |
| D15 | 나눠 옮긴 미예약 몫은 **원래 라인의 재고 대기 순번을 이어받는다.** 먼저 주문한 고객이 분할 때문에 뒤에 온 주문보다 늦게 재고를 받으면 안 된다(§4.3.1) | 사용자 |
| D14 | ⓐ 는 18번보다 먼저 배포해도 된다. 컷오버 전엔 core 출고가 돌지 않아 쓸 일이 없고, 그 사이 쓰게 되면 분할된 상자는 FO 상세에서 손으로 계획한다(`POST /shipments/:id/plan`) | 내 판단 |
| D11 | 죽은 칼럼 `sales_order_lines.status`·`suggested_quantity`·`unavailable_sku_ids`·`deducted_at` 과 enum `order_item_status` 를 **contract 2단계**로 지운다(읽기 중단 PR → 배포 → DROP PR) | 내 판단(CLAUDE.md expand-contract) |
| D12 | `orderStatusEnum` 의 `shipped`·`delivered` 주석을 «코드 producer 0, 셀메이트 스크립트가 쓴다 — 읽는 곳은 외부 출고 뜻»으로 고친다 | 내 판단 |

## 4. 재고 부족 흐름 (갈래 ⓐ)

### 4.1 판정 — 상자 단위 «예약» (D7)

`judgeCtes` 의 `box` CTE 가 `under_reserved`·`partially_reserved` 를 FO 상태에서 가져오는 것을, 그 상자 라인들의 확정 예약
(`stock_reservations`, `targetType='SHIPMENT_LINE'`, `status='confirmed'`) 합과 라인 수량 합의 비교로 바꾼다.

- 확정 예약 합 = 0 → `created`(라벨 «예약 전»), 0 < 합 < 수량 → `partially_reserved`(«부분 예약»), 합 = 수량 → «예약» 아님.
- 이 판정 정의는 주문 접기(`judgedRowsSql`)와 상자별 결과(`judgedShipmentsSql`)가 같이 읽는 **한 벌**이다(리컨실러 스펙 §11.5).
  상자 리컨실러 규칙도 같은 판정을 읽으므로, 바꾼 뒤 **기존 상자 규칙(25·30번)의 대상이 달라지지 않는지** 통합 스펙으로 확인한다.
- 대표 단위 규칙(가장 뒤처진 단계)은 그대로다. 그래서 나눠 보낸 뒤에도 남은 1종 상자가 «예약»이라 주문은 보드 «예약» 칸에 남는다 — D3 와 맞는다.
  9종 상자는 «계획 대기»로 판정돼 18번 규칙의 대상이 된다.
- 판정은 1분 주기 `order_progress` 갱신에 실린다. 바꾼 뒤 판정 SQL 의 `EXPLAIN ANALYZE` 를 배포 전에 잰다(지금 선례: 25번 행 5초 게이트).

### 4.2 보드 «예약» 줄

보드 줄 = 주문 하나(지금과 같다). «예약» 칸 목록 응답(`GET /order-progress/orders?stage=reserve`)에 줄마다 다음을 싣는다. 집계는 서버가 끝내서 보낸다.

- 대표 상자 id(«있는 것 먼저» 대상)와 그 상자의 `manifestVersion`·라인 버전(분할 명령의 낙관적 잠금에 필요)
- 모자란 품목 목록: 품목명(SKU 이름), 모자란 수량, 그 주문의 품목 종 수 대비 모자란 종 수(«10종 중 1종»)
- 입고 예정: 그 SKU 로 열린 발주 라인(`purchase_order_lines.status='ordered'`, 잔량 있음, `closedAt IS NULL`)의 가장 이른 `expected_arrival`. 없으면 비운다
- 기다린 시간: 지금의 `est`(`fo_created_at`)

**⚠️ 라이브에서 발주가 이 경로로 들어오고 있는지는 모른다.** 입고 예정 칸이 대부분 비어도 흐름은 동작해야 한다.

한 주문에 «예약» 상자가 둘 이상이면(드묾) 대표 상자 하나만 줄에 싣는다 — 하나를 나누면 다음 갱신에 다음 상자가 대표가 된다.

### 4.3 «있는 것 먼저» (D8)

줄의 버튼 하나. 확인 대화상자에 «무엇을 새 상자로 옮기는지»(품목·수량)를 보이고, 관리자가 사유를 적는다(분할 명령은 사유 필수). 누르면:

1. 대표 상자의 라인마다 미예약 수량 = 라인 수량 − 확정 예약 합을 구한다. 0 인 라인은 건너뛴다.
2. 그 수량들을 한 번의 `split` 명령으로 새 draft 상자로 옮긴다(`moves` 여러 개, 각 `targetReservedQty: 0`).
3. 원래 상자에 남는 수량이 0 이면(전부 미예약) 거절한다 — 나눌 «있는 것»이 없다. 서버의 기존 검증이 이미 거절한다(`A split must leave positive quantity`).
4. 상자에 다른 판매주문의 라인이 있으면(합포장, `consolidation.service.ts:628-650`) 거절한다(D13). 사유는 «합포장 상자 — FO 상세에서 처리».

미예약 수량은 클라이언트가 계산하지 않는다. 버튼이 부르는 core 엔드포인트가 상자를 잠근 뒤 계산해서 `split` 을 부르거나,
`split` 에 «미예약 몫 전부» 모드를 더한다 — 어느 쪽인지는 빌더 몫. 화면이 보던 사이 재시도 워커가 예약을 더 잡았을 수 있으므로
판단 시점의 숫자로 옮겨야 한다.

분할 뒤:

- 원래 상자 = 전부 예약됨 → «계획 대기» → 18번이 계획한다(D4).
- 새 상자 = 전부 미예약 → «예약» → 재고가 생기면 재시도 워커가 예약 → 다 예약되면 «계획 대기» → 18번.
- 채널 출고 통지는 상자마다 나간다(기존 동작). 분할은 채널에 아무것도 보내지 않는다.

권한·명령 경로는 FO 상세 분할과 같다(`FULFILLMENT_SCOPES.operate`, 멱등 키).

#### 4.3.1 재고 대기 순번 이어받기 (D15)

재시도 워커는 «오래 기다린 라인부터» 재고를 준다(`FulfillmentOrderReservationRetryWorker.findCandidates`,
`fulfillment-order-reservation-retry.worker.ts:84-113`). 순번은 그 라인 예약 행의 `MIN(COALESCE(requested_at, created_at))`
(confirmed 또는 short-pick 해제 이력)이고, 예약 행이 없으면 `sl.created_at` 이다.

- 라인을 **통째로** 옮기면 라인 id 와 `created_at` 이 그대로라 순번이 유지된다.
- 일부 예약 라인(3 중 2)의 미예약 1 은 `split` 이 새 shipment_line 을 지금 시각으로 만들고 예약 행도 없다 → **맨 뒤로 간다.** 이걸 막는다.

처방:

1. `shipment_lines` 에 nullable `demand_requested_at timestamptz` 를 더한다(expand, `migrate → deploy`).
2. `split` 이 새 라인을 만들 때 원래 라인의 순번 값(위의 식으로 구한 값)을 `demand_requested_at` 에 적는다. 보드 «있는 것 먼저»뿐 아니라
   FO 상세 분할 등 `split` 을 타는 모든 경로에 적용된다 — 같은 문제이므로.
3. 워커 정렬의 마지막 폴백을 `sl.created_at` → `COALESCE(sl.demand_requested_at, sl.created_at)` 로 바꾼다.
4. 옛 라인은 NULL 이라 지금 동작 그대로다(백필 없음).

빌더는 `split` 말고도 새 shipment_line 을 만드는 경로(합포장·draft 상자 수정 `draft-box-amender.ts` 등)가 같은 순번 손실을 갖는지 보고,
있으면 이 칸을 같이 채울지 이 설계의 범위 밖으로 둘지 계획에 적는다.

### 4.4 FO 상세 분할 화면

`shipment-actions.tsx:209` 의 «수량 < 원본 라인 수량» 검사를 서버 규칙(«원래 상자에 뭐라도 남는다»)에 맞춘다. 라인 통째로 옮기기가 FO 상세에서도 되게 한다.
여러 라인 동시 이동은 이 설계의 범위 밖이다(보드 버튼이 그 경우를 덮는다).

### 4.5 입구 숫자 (D9)

`getStats` 의 `cannotShip`·`partialOutbound` 를 `order_progress` 에서 센다(라인 상태 조인 제거). 지금의 «최근 14일·`confirmed`» 창은 보드와 맞지 않으므로
보드 «예약» 칸 숫자와 **같은 값**이 되게 한다. 메인·통계 개요·주문내역 상단 카드는 보드 `/order/stall-board` 의 «예약» 칸으로 링크한다.
`order_progress` 를 읽지 못하면(테이블 없음 등) 0 이 아니라 «모름»을 보인다.

## 5. 죽은 상태 정리 (갈래 ⓑ)

### 5.1 읽기 중단 (ⓑ-1)

- **core 주문 목록:** `typeGroup` 의 `ready`·`partial`·`hold` 를 지운다. DTO·admin-web `filter.context.tsx` 에서도 지운다.
  `unmatched`·`pending` 등 다른 값은 그대로.
- **core 판매주문 응답:** 라인의 `status`·`suggestedQuantity`·`unavailableSkuIds`·`deductedAt` 을 응답에서 뺀다(`sales-order-response.dto.ts:35-46`).
  `product-matching.service.ts:793` 의 `lineStatus` 도.
- **주문내역:** 줄 배지를 «출고 단계» 배지로 바꾼다(§5.2). `isReadyToShip`·`isUnavailable`·`isOrderFullyAllocated`·`lineStatus` 와 줄 선택을 지운다.
  «주문 나누기» 껍데기 모달(`split-order-modal.tsx`, `split-quantity-modal.tsx`)과 그 버튼도 지운다 — 나누기는 보드·FO 상세에 있다.
- **발주 수요:** `sol.status <> 'cancelled'` 를 지우고, `line_qty` 를 `sol.quantity − cancelledQuantitySql(o.id, sol.id)` 로 바꾼다(0 이하 라인은 뺀다).
  SKU 로 펼치는 것은 지금처럼 그 뒤에 한다.
- **인쇄주문 취소 판정:** `lineStatus === 'cancelled'` 대신 «라인 수량 − 부분취소 합 ≤ 0». 인쇄 쪽은 이미 `print-cancel-remaining.reader.ts` 가
  같은 계산으로 남은 수량을 구한다 — 그것을 쓴다.
- **CS 주문조회:** 라인 상태 라벨을 지우고 주문 단위 «출고 단계» 배지(§5.2)를 보인다.
- **필터 값 호환:** `sales-order-filter.dto.ts:53` 이 `@IsIn(ORDER_TYPE_GROUPS)` 로 검증하므로 core 에서 값을 바로 지우면 옛 admin-web 이 400 을 받는다.
  ⓑ-1 에서는 `ready`·`partial`·`hold` 를 계속 받고 **빈 결과**를 돌려준다(조건을 빼서 전체를 돌려주면 안 된다). 지금도 늘 0건이라 옛 화면의 동작이 같다.
  값 자체는 ⓑ-2 에서 지운다.
- **스키마 주석:** D12.

### 5.2 «외부 출고» (D6)

- **일별 통계** `getDailyStatusStats`: 결과에 `externalShipped` 칸을 더한다. 기준은 정체 보드 D3 와 같다 — 판매주문 `status IN ('shipped','delivered')`.
  이 주문은 «준비중»·«배송중»·«배송완료»에서 뺀다. admin-web 통계 화면에 칸을 더한다.
- **주문내역 «출고 단계» 배지:** `fulfillment-phase.ts` 의 도출(준비중·배송중·배송완료)을 쓰고, 판매주문 `status IN ('shipped','delivered')` 면 «외부 출고».
  배지 판정은 서버가 응답에 실어 보낸다 — admin-web 이 상자 상태로 다시 도출하지 않는다. 보드에서 갇힘인 주문은 배지에서 보드로 가는 링크를 단다.

### 5.3 칼럼 DROP (ⓑ-2, contract)

ⓑ-1 이 라이브에 배포되고 **한 번 이상의 배포가 끝난 뒤** 머지한다. `deploy → migrate` 순서(contract).

- `sales_order_lines` 의 `status`·`suggested_quantity`·`unavailable_sku_ids`·`deducted_at` DROP, enum `order_item_status` DROP.
- 주문 생성(`sales-orders.service.ts:300-326`)의 네 칸 쓰기와 `getVariantPolicy` 호출(그 결과는 `suggestedQuantity` 에만 쓰인다)을 지운다 —
  이건 ⓑ-1 에서 해도 된다(쓰기를 멈춰도 옛 코드는 기본값으로 산다. `suggested_quantity` 등은 nullable, `status` 는 기본값 `pending`).
- 스펙 픽스처(`order-progress.fixtures.ts:95`, `consolidation-fixtures.ts:105`, `waybill-fixtures.ts:109` 등)가 이 칼럼을 쓰면 함께 고친다.
- `drizzle-kit generate` 결과의 DROP 순서를 스크래치 DB 에서 먼저 돌린다.

## 6. PR 과 배포 순서

| PR | 내용 | 마이그 | 배포 |
|---|---|---|---|
| ⓐ | §4 전부(판정 상자 단위·보드 줄·«있는 것 먼저»·순번 이어받기·FO 상세 분할 검사·입구 숫자) | expand 1건(`shipment_lines.demand_requested_at`, nullable) | 다음 배치 배포, **`migrate → deploy`** — 뒤집히면 새 `split`·워커가 없는 칸을 읽어 실패한다. core 가 먼저 떠도 옛 화면은 깨지지 않는다(응답 칸 추가) |
| ⓑ-1 | §5.1·§5.2 | 없음 | ⓐ 와 같은 배치여도 된다. **admin-web 이 core 보다 늦게 뜨면** 옛 화면이 지운 응답 칸을 읽어 배지가 비는 정도다. 옛 필터 값은 core 가 계속 받는다(§5.1 필터 값 호환) |
| ⓑ-2 | §5.3 + 필터 옛 값 제거 | contract(DROP) | ⓑ-1 배포 뒤 **다른 배포가 하나 더 끝난 뒤.** `deploy → migrate` |

ⓐ 와 ⓑ-1 은 순서 의존이 없다. ⓑ-2 는 #1016 «남은 운영 작업»에 체크박스로 단다.

## 7. 검증

- **판정 SQL 통합 스펙**(`describeIfDb`, `--runInBand`): ① 한 FO 에 상자 둘 — 하나는 다 예약, 하나는 미예약 → 앞은 «계획 대기», 뒤는 «예약», 주문 대표는 «예약»
  ② 일부 예약 라인 ③ 기존 25·30번 상자 규칙 대상이 판정 변경 전후로 같다.
- **«있는 것 먼저» 통합 스펙:** 10라인 중 1라인 미예약·1라인 일부 예약 → 분할 뒤 원래 상자 전부 예약·새 상자 전부 미예약, 예약 행이 옮겨지지 않음.
  화면이 본 뒤 워커가 예약을 더 잡은 경우 → 판단 시점 숫자로 옮김. 전부 미예약 상자 → 거절. 합포장 상자 → 거절.
- **순번 스펙:** 주문 A(먼저)의 일부 예약 라인을 나눈 뒤 주문 B(나중)의 같은 SKU 라인이 대기 중일 때 재고 1 이 생기면 A 의 새 라인이 받는다.
- **발주 수요 스펙:** 부분취소된 라인의 수요가 `cancelledLines` 합만큼 준다(묶음 상품 라인 포함 — SKU 로 펼치기 전에 뺀다).
- **일별 통계 스펙:** 셀메이트 `shipped` 주문(상자 없음)이 «외부 출고»로, «준비중»에서 빠진다.
- **admin-web:** 컴포넌트 테스트를 못 하므로 판정·변환은 순수 함수로 두고 스펙을 붙인다(배지 라벨, 보드 줄 표시).
- **배포 전:** 판정 SQL `EXPLAIN ANALYZE`(라이브 읽기 전용).
- **컷오버 전 스모크:** 로컬 E2E 에서 재고 없는 SKU 하나를 낀 주문 → 보드 «예약» 줄 → «있는 것 먼저» → 원래 상자가 «계획 대기»로 넘어감.

## 8. 빌더에게 맡기는 것

- «있는 것 먼저»를 새 엔드포인트로 둘지, `split` 에 «미예약 몫 전부» 모드를 더할지(§4.3).
- 보드 줄의 품목 표시 형식, 확인 대화상자 문구.
- 입고 예정의 정확한 발주 라인 조건(잔량 계산은 `orderedQty − receivedQty`).
- `getStats` 의 다른 숫자(`todayCount` 등)는 그대로 둔다.
