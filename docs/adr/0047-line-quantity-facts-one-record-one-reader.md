# 라인 수량 사실은 기록 위치 하나, 읽는 문 하나

## Status
Accepted (2026-10-20). 설계 스펙 `docs/superpowers/specs/2026-10-20-k6-line-quantity-facts-design.md`, 출발점은 구조 감사
`docs/order-logistics-architecture-audit-2026-10.md` §5.2·§8.2 의 K6. K1([[0045-picking-custody-commands-share-one-kernel]])·K2([[0046-shipment-state-and-manifest-share-one-kernel]])의 방식을 따른다.

## Context
판매주문 라인의 «몇 개 주문됐고, 몇 개가 취소·출고·배송완료·청구됐고, 몇 개를 더 취소·반품할 수 있나»를 아는 곳이 여러 벌이고 벌마다 기준이 다르다
(출고 판정 7곳 이상, 배송완료 6, 진행 단계 6, 청구 수량 6, 취소 수량 파서 셋). 취소 수량만 봐도 `metadata.cancelledLines` 를 읽는 파서 세 벌의 scope 필터가
서로 다르고(리더만 `full` 포함), V1 전체취소는 `cancelledLines` 를 아예 적지 않는다. K7(취소)·K8(환불·반품)이 이 숫자 위에 서므로 판매주문 줄기의 바닥이다.

사용자가 말한 이유는 막힌 버그가 아니라 구조 다지기다. 같은 이음새에서 나온 결함(반품 환불이 같은 라인의 마지막 줄만 셈, 교환 가드가 «FO completed = 배송완료»로 봄,
묶음 라인의 단위 혼용 등)은 따로 고치지 않고 소비자를 커널로 옮기며 고친다.

## Decision
**사실마다 기록하는 곳은 하나, 읽는 문도 하나다. 기록하는 «함수»는 그 사실을 만드는 모듈에 남는다**(출고=dispatch, 배송=추적, 취소=판매주문 취소, 청구=반품·교환).
K6 이 정하는 건 «어디에 기록하나»이고 «누가 기록하나»는 바꾸지 않는다. 커널에는 업무 판단(«이 취소를 허용하나», «얼마를 환불하나»)을 넣지 않는다.

이 PR(K6 PR 1)이 만든 것은 취소 쪽 기록이다.

1. **테이블 `sales_order_cancellation_lines`.** 취소 행(`sales_order_cancellations`) × 판매 라인 × 수량 × `shipment_phase`(`before_shipment` / `after_shipment`).
   `metadata.cancelledLines` JSON 을 대체하는 하나뿐인 기록이다. V1 전체취소도 라인 행을 적는다. 갈래는 수요를 줄인 취소(출고 전)와 이미 나간 수량의 취소
   (출고 후 — 돈은 돌려줬고 물건은 고객에게 있다)를 가른다. 마이그레이션은 additive 이며 `migrate → deploy` 다.
2. **쓰는 문 `recordSalesOrderCancellation`**(`apps/core/src/modules/sales-order/cancellation-record/record-cancellation.ts`). 취소 행과 라인 행을 같은 트랜잭션의
   한 문으로 쓴다. 판매주문 취소의 세 쓰기 지점(V1 전체·부분, V2)이 모두 이 함수를 지난다.
3. **순수 규칙 `deriveCancellationLines`**(`cancellation-lines.ts`). 갈래 규칙은 **구성품 하나라도 이미 나간 판매 단위는 `after_shipment`** 다. 세트의 일부만 출고돼도
   그 단위는 되돌릴 수 없는 쪽으로 센다. 백필과 쓰기 문이 같은 함수를 쓰므로 규칙이 두 벌이 되지 않는다.
4. **가드 `cancellation-write.guard.spec.ts`.** `sales_order_cancellation_lines` 의 쓰기가 `recordSalesOrderCancellation` 밖에 있거나, 취소 행 기록이 한 문 밖에서
   이뤄지면 빨갛다(K1·K2 가드와 같은 «주인 말고는 아무도 직접 쓰지 않는다» 꼴).
5. **백필 `scripts/ops/k6-backfill-cancellation-lines.ts`.** 옛 취소 행을 주문별로 재생해 라인 행을 만든다(옛 `cancelledLines` 와 V1 전체취소 역산).
   재생 순서는 partial 먼저(`created_at`·id 순), 전체 취소는 언제나 마지막이다 — `occurred_at` 은 호출자가 준 값이라 기록 순서를 대표하지 못한다.
   백필이 확인하는 것은 둘뿐이다: `metadata.cancelledLines`·`effects` 가 기대한 모양으로 읽히는지(partial 인데 `cancelledLines` 가 없거나 항목 형식이 틀리면 실패),
   그리고 도출 규칙 자체의 검사(모르는 라인, 출고 후 보존 효과의 수량 필드가 숫자가 아님, 나누어떨어지지 않는 구성 수량, 출고 후 수량 > 취소 수량, 라인 취소 합 > 주문 수량). 옛 행의 갈래는 그 행의 `effects`
   (`preserved_shipped_fulfillment_order_item`)에서 가져오며 따로 교차 확인할 독립 근거는 없다. 하나라도 실패하면 그 주문은 통째로 `ambiguous` 로 보고하고 쓰지 않는다
   (보고는 주문당 한 건이지만 그 주문의 취소는 전부 행이 없는 채 남는다). 그 밖의 예외는 프로그램 결함이라 그대로 올린다. 조회 모드가 기본이고 `--apply` 로만 쓴다.
   `--verify`(읽기 전용)는 주문마다 저장된 행을 무시하고 `metadata`/`effects` 로 다시 도출해 저장된 행과 (취소, 라인, 갈래, 수량) 집합을 비교하고 어긋난 주문을 찍는다(기대 0).
   행 없는 취소가 0행으로 도출되는 것뿐인 주문도 대조하고, 모호하거나 아직 백필되지 않은 주문만 사유별로 세어 건너뛴다. 대조용 SQL 은 따로 두지 않는다.

**대체되는 것:** `metadata.cancelledLines` 를 읽는 파서 세 벌(`loadPriorPartialCancellationContext`, `cancelledQuantitySql`, `LineCompositionReader` 의 취소 합).
PR 1 은 기록만 더했다(이중 기록). PR 2a 가 `cancelledQuantitySql`(파일째)·`getCancelledQuantityByLine`·`loadPriorPartialCancellationContext`(→ 문을 읽는 `loadPriorCancellationContext`)를 지우고
구성 리더의 취소 합도 문으로 옮겼다. 남은 `sumCancelledByLine` 은 쓰기 문의 백필 전 대비와 백필 스크립트 둘이 쓰므로 PR 6 에서 지운다.

**PR 2a 가 정한 것:** 읽는 문 `readLineQuantities`(`sales-order/line-quantities/line-quantities.reader.ts`)와 같은 정의의 SQL 조각(`line-quantities.sql.ts`: `lineCanceledQuantitySql`·`lineDemandSql`·`lineRemainingSql`).
정의는 SQL 한 벌이고 TS 에서 뺄셈을 다시 하지 않는다. 가드 `line-quantity-read.guard.spec.ts` 가 취소 라인 테이블 이름을 쓰는 파일을 쓰기 문과 조각 파일 둘로 묶고 옛 파서 이름의 부활을 막는다.
- **E1(사용자 확인).** 모든 소비자가 V1·V2 전체취소의 라인 행까지 센다(옛 파서는 `scope='partial'` 만 셌다).
- **E2(사용자 확인).** 수요·FO 생성 수량은 출고 전 취소만 뺀다(`demand = ordered − canceledBeforeShipment`). 취소 엔진·채널 diff·인쇄의 «남은 수량»은 갈래 무관 `canceled` 를 뺀다.
- `planCancellation`(전체)은 이미 전체 취소된 주문을 수량 계산 전에 400 `이미 전체 취소 처리된 주문입니다.` 로 거절한다(전에는 계획을 돌려줬다). 호출자가 `cancelled` 를 먼저 거르고, 되돌릴 수 없는 인쇄 업체 취소 앞에서 걸린다.
- 취소 엔진의 FOI 별 `preservedShippedByFulfillmentItem` 은 계속 `effects` 에서 파싱한다 — 라인 행으로는 복원되지 않는 FOI 단위 엔진 상태다.
- SQL 조각은 취소 라인 테이블을 열 이름을 바꾼 파생 테이블로 감싼다. drizzle 이 단일 테이블 select 의 열을 한정 없이 렌더해 안쪽 테이블이 바깥 `"id"` 를 가로채기 때문이다(일치 spec 이 잡았다). postgres 가 파생 테이블을 평탄화해 필터가 테이블에 바로 붙는다 — 인덱스(`idx_sales_order_cancellation_lines_line`)를 쓸 수 있는 모양이다(실측은 행이 적어 seq scan).

**PR 2b 가 정한 것:** 문에 SKU 층을 더하고(`lineSkuQuantitiesSql`, 리더의 `skus`), 진행 단계를 라인 수량 위의 SQL 한 벌(`order-fulfillment-phase.sql.ts`)로 세웠다.
- **SKU 층 관계.** 행 = 범위 주문의 (판매 라인, SKU) 중 FOI 가 있거나 굳은 구성(`sales_order_line_compositions`)에 있는 것. FO 가 없는 주문은 운영자가 구성을 미리 정해 뒀어도
  SKU 층이 비어 있다(R6 — 스펙 §6.1 «구성이 굳기 전(FO 전)에는 SKU 층이 비고»; 구성 갈래는 FO 가 있는 주문에만 건다). FOI 의 `sales_order_line_id` 는 `varchar` 라
  `sol.id::text` 로 잇고 주문 범위는 `fulfillment_orders.sales_order_id` 로 좁힌다.
- **FOI 단위 정의(그 뒤 (라인, SKU) 합).** `required = qty − canceled_qty`, `shipped = shipped_qty`, `outstanding = qty − shipped_qty − canceled_qty`,
  `forwarded` = drop_ship FO 의 `direct_ship_status='forwarded'` 일 때 outstanding(출고가 아니다), `partner_completed` = `'completed'` 일 때 shipped_qty(배송완료가 아니라 표시용),
  `delivered` = 그 FOI 상자 라인(`dispatch_attempt_sources.qty`) 중 시도가 `dispatched` 이고 `shipment_tracking.status='delivered'` 인 것의 합. FO 상태로 거르지 않는다.
  `delivered` 는 범위 FOI 전부에 대해 한 번 묶어 센 파생 테이블을 FOI id 로 되붙인다 — FOI 마다 상관 서브쿼리로 세면 `shipment_lines(fulfillment_order_item_id)`
  인덱스가 없어 제곱으로 자란다(R15). 그 인덱스는 이후 expand PR 이 더한다.
- **R5 — 인쇄 라인은 SKU 층 밖이다.** 스펙 §6.1 은 «인쇄 … 전량» 을 SKU 층 `shipped` 로 적었지만, 인쇄 외주 라인은 FOI 가 없어 SKU 층에 넣지 않았다. 진행 단계 사다리가
  `print_orders` 를 주문 단위로 직접 접는다(활성 수·`shipped`/`delivered` 수·`delivered` 수). 2b 소비자는 모두 주문 단위라 충분하다 — 라인 단위 인쇄 사실이 필요해지면 K7·PR 3 이 더한다.
- **진행 단계 사다리가 SQL 한 벌인 이유.** 일별 통계는 기간 상한이 없는 집계라 SQL 이어야 하고, TS 판을 하나 더 두면 일치 spec 을 영구히 들고 간다. 고객 화면은 같은 SQL 을 주문 하나로 부른다
  (스펙 §6.4 의 «순수 함수 하나»에서 사용자 확인으로 벗어난 판단). `anyShipped`·`shippedComplete` 를 라인 단위로 내지 않는 것도 같은 확인이다 — 소비자가 생기는 K7·PR 3 이 더한다.
- **`cancellableSalesUnits` 가 TS 인 이유.** 구성 SKU 마다 `outstanding ÷ qtyPerUnit` 이 같아야 하는 판매 단위 환산이라 SQL 소비자가 없다. 수량 뺄셈은 SQL 조각 안에만 있고 이 함수는 select 한 칼럼을 나눌 뿐이다.
- **R13 — 고객 단계는 SO `pending`·`shipped` 칸을 타지 않는다.** 사다리는 SO 칸(1 cancelled·timeout, 2 pending, 3 shipped·delivered)과 사실 칸(4 FO 취소, 5 미생성,
  6 배송완료, 7 배송중, 8 준비중)으로 나뉘고 각 칸은 한 번만 쓴다. `admin_phase` 는 SO 칸이 먼저, 없으면 사실 칸(미생성 → `preparing`). `store_phase` 는 SO cancelled·timeout 이면 `canceled`,
  SO shipped·delivered 면 사실 칸이 `delivered` 일 때만 `delivered` 아니면 `shipping`, 그 밖(SO `pending` 포함)은 사실 칸 그대로다. 라이브 진행 중 주문은 `pending` 이다 —
  생성이 `pending` 으로 넣고 `confirm()` 은 관리자 엔드포인트뿐이다. 옛 고객 단계는 SO 상태를 보지 않았으므로, pending 칸을 고객 단계에 태우면 pending 주문의 «배송 완료»·«출고 취소»가
  사라진다(스펙 §6.4 «현행 화면 유지»).
- **R14(사용자 확인 대기) — 카드 모집단은 진행 중 주문이다.** 출고완료·부분출고 카드는 최근 14일 SO `status IN ('pending','confirmed','processing')` 을 센다. 같은 이유로 `confirmed` 만 세면
  warehouse-app 전환 뒤에도 카드가 0 에 머문다. 셀메이트로 나간 주문(`shipped`)은 모집단 밖이다. 출고 요청 카드(`confirmed` 수)와 모집단이 달라 «출고완료 ⊆ 출고 요청» 은 성립하지 않는다.
- **R9.** V2 전체취소 재계획은 «항목 없음» 409 갈래를 `skus` 가 비었는지가 아니라 **FOI 존재**로 고른다(구성만 굳고 FOI 가 없는 SKU 가 0 단위로 읽히는 것을 막는다).
- **R10 / G-e.** `sales_order_line_id` 가 비었거나 그 주문의 라인이 아닌 FOI 에 `shipped_qty > 0` 이 있으면 SKU 층이 그 출고를 못 본다. V1 전체취소의 «출고된 항목» 판정도 그걸 못 보지만
  FO 상태 가드가 전량 출고 FO 는 여전히 막는다. 코드에 대체 읽기를 두지 않는다 — 대체를 두면 «읽는 문 하나»가 깨지고, 같은 집합을 SKU 층이 다른 모든 곳에서 무시한다.
  대신 배포 전 게이트 G-e(기대 0)로 그런 FOI 가 없음을 확인한다.
- **P1~P8(동작 변경, 스펙 G5).** P1 관리자 뱃지·일별 통계가 인쇄 외주를 센다(지난 날짜 칸도 바뀐다) · P2 FO 만 취소된 주문은 관리자 `cancelled` · P3 SO `cancelled`·`timeout` 은 고객 `canceled` ·
  P4 셀메이트 출고(SO `shipped`·`delivered`)는 고객 `shipping`(사실이 배송완료면 `delivered`, R13), 셀프취소 차단 · P5 «움직임»·«배송완료» 를 상자 상태가 아니라 수량으로 판정 ·
  P6 카드 «출고완료»·«부분출고» 를 수량으로 재정의(F10; 모집단 R14. 인쇄만 있는 주문은 창고 요구 수량이 0 이라 두 카드 어디에도 들지 않는다) · P7 V1 취소 엔진의 출고 수량은 FOI `shipped_qty` 하나(FO `shipped`/`shipped_at` 대체 삭제; 셀프취소 `any_shipped` 도 FO 상태를 증거로 안 본다) ·
  P8 셀메이트 스크립트가 취소된 FO·FOI 를 출고로 덮지 않는다(F12).
- 가드 `line-quantity-read.guard.spec.ts` 가 옛 이름의 부활을 막고, 비테스트 운영 파일 중 `shipment_tracking` 을 읽는 곳을 `line-quantities.sql.ts`·`store-sales-orders.service.ts`(배송조회 이벤트 목록, 수량 아님)·
  `store-return-exchange.service.ts`(반품·교환 자격 — PR 3 이 문으로 옮기고 이 목록에서 뺀다)로 묶는다.

**PR 2b 가 대체한 것:** `orderShipmentPhaseSql`(→ `orderFulfillmentPhaseSql`), `deriveFulfillmentPhase`, `hasShippedEvidence`(→ `SelfCancelFacts.anyShipped`), `MOVED_SHIPMENT_STATUSES`,
`outstandingSalesUnits`(→ `cancellableSalesUnits`), `getEffectiveShippedFulfillmentQty`(→ `shippedEvidenceOf`).

**이후 PR(제안, 정본은 스펙 §9):**
- PR 2a — (#1108) 읽는 문·SQL 조각·일치 spec, 취소 소비자 여섯(취소 엔진·채널 diff·인쇄 둘·수요 통계·구성 리더) 전환, E1·E2.
- PR 2b — (이 PR) 진행 단계 SQL, 관리자 뱃지·일별 통계·카드 숫자(F10), 고객 actions, 셀메이트 F12·배송조회 F11, SKU 층 사실(`shipped`·`forwarded`·`delivered`·`cancellable`).
- PR 3 — 청구(반품·교환) 게이트·환불 수량을 한 공식 `claimable` 로.
- PR 4 — 운영자 «미처리 취소»(admin-web 버튼과 `POST /shipments/:id/cancellations`), FO 취소(`POST /fulfillments/:id/cancel`), 수동 배송완료
  (`POST /fulfillments/:id/deliver`) 제거. 셋 다 판매주문 기록 없이 상태만 바꾸거나 배송 사실을 추적 밖에서 만들어 «기록 위치 하나»와 충돌한다.
- PR 6 — contract: `metadata.cancelledLines` 쓰기 중단, 옛 파서 삭제, 옛 파서 이름이 되살아나면 빨간 가드. PR 1 의 백필이 라이브에서 끝나고 한 번 이상 배포된 뒤
  (ADR-0005 §5, `deploy → migrate`).

## Why
- 사실의 정의가 한 곳이면 소비자를 하나씩 옮겨도 서로 갈라지지 않는다. 기록이 먼저 하나가 되어야 읽는 문이 «어느 쪽이 맞나» 규칙을 영구히 들고 가지 않는다(사용자가 거절한 안).
- 갈래를 기록 시점의 행으로 남기면 «취소가 출고 전이었나»를 나중에 FO/FOI 수량에서 역산하지 않아도 된다. FO/FOI(`shippedQty`·`qty`)로 역산하면 출고가 진행된 뒤에는 답이 바뀐다.
- 쓰는 함수를 커널로 끌어오지 않아 커널이 god object 가 되지 않는다.

## Consequences
- 취소 한 건이 라인 행 N개를 같은 트랜잭션에 쓴다. 쓰기 지점이 늘어도 가드 수는 늘지 않는다.
- PR 1 만으로는 읽는 쪽이 바뀌지 않았다(동작 변경 없음; 읽는 쪽 전환과 동작 변경은 PR 2a, 위 E1·E2). 옛 `cancelledLines` 와 새 라인 행이 공존하는 동안 둘이 어긋나면 새 행이 틀린 것이다 —
  `--verify` 로 배포 후 확인한다.
- **PR 2 착수의 차단 조건:** 라인 행이 없는 취소 수(게이트 SQL)가 백필 러너가 찍는 (a) ambiguous 주문에 속한 취소 수 + (b) 라인 0개로 도출된 취소 수의 합과 다르면 읽는 문을 만들지 않는다. 그 합만큼은 사람이 판단한 예외로 남는다.
- 백필이 모호하다고 본 주문은 라인 행이 없다. 사람이 목록을 보고 결정한다.
- PR 2a 로 라이브 취소 수량을 읽는 경로는 라인 행이 유일하다: 라인 행 없는 취소는 문에 보이지 않으므로 라인 행 없는 취소 수가 백필 `--verify` 의 (a) ambiguous + (b) 0행 도출 합과 같아야 한다 — 0 이 아닐 수 있다(V1 전체취소에 남은 게 없으면 0행).
- 가드는 소스 텍스트를 정규식으로 훑으므로 우회가 가능하다. 실수를 잡는 그물이지 방어선이 아니다.
