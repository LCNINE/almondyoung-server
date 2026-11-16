# 선적 ④ — 선적을 입고예정일·보충 제안·입고 예정 목록의 원천으로 (#1240)

> 상위: #1233 축 2 · 입고. 중국 선적 입고 설계(`2026-11-16-inbound-shipment-boxes-design.md`)의 작업 순서 ④이자 마지막 단계.
> 그 설계 §8.6 이 정한 «오는 중» 모양을 읽기만 한다. 선적 모델·API(①, #1337)·admin-web 화면(②, #1340)은 라이브,
> 스테이션 상자 입고(③, #1343)는 develop 에 머지·배포 전.

## 1. 왜

core 에서 «들어올 물량»을 아는 곳은 지금 **발주 라인 하나뿐**이다. 스토어프론트 «○월 ○일 입고 예정»
(`product-restock.ts`), 재고 보충 제안(`replenishment/`), 물류 앱 «입고 예정» 목록(`GET /inventory/expected-arrivals`)이
모두 발주 라인만 읽는다. 그런데 열린 발주 라인은 실제 발주가 아니라 셀메이트 재고 CSV 의 «입고예정일»을 옮겨 적은
가짜 라인이다(`scripts/sellmate/load-inbound-from-csv.ts`, 수량 1, `audit_notes` 표지 `sellmate-csv-inbound`).

중국 물량은 발주 없이 선적(입고리스트)으로 기록한다. 선적을 이 세 곳의 원천으로 더하지 않으면:

- 셀메이트를 끊는 순간 중국 물량의 입고예정일이 스토어프론트에서 사라진다.
- 보충 제안이 이미 배에 실린 물량을 모르고 또 발주하라고 한다.
- 컷오버 뒤 국내 발주가 비어 있는 동안 앱 «입고 예정» 목록이 늘 비어 «간편입고로 진행해 주세요»가 뜬다 — 선적
  상자가 들어오는 날에도.

## 2. 정한 것 (사용자 결정, 2026-11-16)

- **셀메이트의 입고예정일은 원천이 아니다.** 재고가 안정재고 밑으로 떨어진 것 같을 때 사람이 비고처럼 손으로 적는
  값이라 사실상 의미가 없다. 그래서 그 값을 옮긴 CSV 발주 라인은 컷오버(#1243)까지 기다리지 않고 **#1240 배포 때
  닫는다**(§9). 이슈 #1240 «확인 필요»는 이것으로 닫힌다. 국내 물량의 입고예정 원천은 #1335 몫이다.
- **«입고 예정»은 들어올 것 전부를 보여 주는 곳이고, 간편입고는 예외다.** 국내 거래처 물량은 발주로(#1335), 중국
  물량은 선적으로(#1240) 기록된다. 예고 없이 거래처 직원이 박스를 들고 온 경우만 간편입고다.
- **선적 도착 예정일은 «대충» 맞는다**(국제 배송). 그래서 선적 날짜에는 해외 발주처럼 «경»(`inboundApproximate`)을 붙인다.
  앞으로 데이터가 쌓이면 더 나은 예측을 할 수 있게 «처음 약속한 날»을 남긴다(§8). 예측 자체는 이번에 안 한다.
- **예정일이 지났는데 상자가 아직 안 오면 스토어프론트는 날짜를 지우고 그냥 품절로 보인다**(지금 발주와 같다).
  대신 admin-web 선적 목록·상세에 «예정일 지남»을 띄워 올린 사람이 날짜를 고치게 한다(§8.1). 자동으로 미루거나
  «입고 지연» 문구를 새로 만들지 않는다.
- **물류 앱 «입고 예정» 목록에 선적을 보인다**(§10). 빈 목록 문구는 간편입고로 보내지 않는다.
- **컷오버(T) 전에 도착하는 중국 선적은 core 에 올리지 않는다.** T 전에는 셀메이트가 재고 정본이라(`sync-stock` 이 core
  재고를 덮어쓴다) 그 상자는 셀메이트에서 받는다. core 에 올려 두면 받은 뒤에도 «오는 중»으로 남아 보충 제안이 두 번
  세고, 앱 목록·스토어프론트에 끝난 선적이 남는다. T 뒤에 도착할 선적만 올린다. 실수로 올렸으면 셀메이트에서 받은 뒤
  사람이 기존 종결(`close`, 사유 «셀메이트로 받음»)로 닫는다. 판정 스크립트가 놓친 것을 보여 준다(§13). 그래서 #1240 은
  T 와 무관하게 배포할 수 있다(스위치를 두지 않는다).
- **만드는 방식은 접근 1**(§4).
- **중국 창고를 시스템에 넣는 일은 컷오버 1.5단계로 떼어 따로 설계한다**(§12). #1240 은 경계만 긋는다.

## 3. 목표 · 비목표 · 반목표

**목표**

- 선적을 확정하면, 그 선적의 «오는 중» SKU 에 묶인 품목이 **품절이고 수동 재입고일이 없고 더 이른 발주 라인이
  없으면** 스토어프론트 입고예정일이 그 선적의 도착 예정일(«경»)로 바뀐다. (이슈 완료 조건을 정확히 쓴 것이다 —
  재고가 있는 품목에는 지금도 입고예정일을 안 보인다, `resolveRestockSchedule`)
- 보충 제안이 «오는 중»인 선적 물량을 들어올 물량으로 세서 그만큼 발주·이동 제안을 줄인다.
- 앱 «입고 예정» 목록에 열린 선적이 보이고, 스테이션에서 누르면 선적 상자 입고로 간다.
- 선적마다 «처음 약속한 도착 예정일»이 남는다.

**비목표**

- 국내 발주 입력·발주 화면(#1335).
- 도착일 예측, 리드타임 학습. 선적에는 공급처·발주일이 없어 공급처별 리드타임(`lead-time-profile.refresher.ts`)에 끼울
  자리가 없다.
- 발주와 선적을 하나로 묶는 «들어올 것» 공통 창구(§4 접근 2). #1335 가 발주 쪽을 손볼 때나 1.5단계 때 만든다.
- 재고 현황의 «입고예정 수량»(`stock_summary_view.inbound_pending_qty`, `GET` 현재 재고). 발주 라인만 세는 VIEW 다 —
  바꾸려면 VIEW 마이그가 필요하고 완료 조건에 없다 **(Claude 판단 — 공통 창구 때 함께)**.
- 중국 창고·이동 지시서(§12).

**반목표**

- 같은 물건을 두 번 «들어올 것»으로 센다(선적 잔량 + 이미 입고된 재고, 또는 나중에 선적 잔량 + 이동 중 원장).
- 늦은 선적을 «들어올 것»에서 빼서 이미 오는 물량을 또 발주하라고 제안한다.
- 선적을 올렸는데 스토어프론트가 다음 날짜 만료 크론이 돌 때까지(또는 영영) 안 바뀐다.
- 옛 물류 앱이 새 응답 때문에 깨진다(선적 줄을 발주 상세로 열어 404).
- 누가 옛 스크립트를 다시 돌려 선적 기반 입고예정일을 지운다(§9).

## 4. 접근

| | 방법 | 대가 |
|---|---|---|
| **1 (채택)** | «오는 중» 공식을 선적 쪽 **한 곳**에 두고, 세 소비자(스토어프론트 투영·보충 제안 파이프라인·입고 예정 목록)가 지금 발주를 읽는 자리 옆에서 선적도 읽어 합친다 | «발주 + 선적 합치기»가 세 군데에 조금씩 생긴다 |
| 2 | 발주와 선적을 같은 모양(SKU·수량·창고·날짜·«경»·문서)으로 내는 «들어올 것» 공통 창구를 만들고 세 곳이 그것만 읽는다 | 개념에는 가장 맞지만 라이브 발주 경로 세 곳을 함께 고친다. #1335 가 곧 발주를 다시 손보므로 두 번 고칠 수 있다 |
| 3 | «입고 예정» 테이블을 두고 발주·선적이 거기 쓴다 | 원본과 사본이 갈라질 위험. 이 규모에 과하다 |

1 을 고른 이유: 공식은 한 곳에만 있고, 라이브 발주 경로를 건드리지 않는다. 원천이 실제로 늘어나는 때(#1335·1.5단계)에
2 로 묶는다.

## 5. «오는 중» — 정의와 둘 곳

### 5.1 정의

모델 설계 §8.6 그대로, 범위 하나를 더한다.

> SKU 의 «오는 중» = `kind = 'sku'` 이고 선적이 `expected`·`receiving` 인 줄의 `max(expected_qty − 유효 집계 합, 0)` 을,
> 줄이 덮는 **입고용** 상자(`disposition = 'stock'`) 중 `open` 이 하나라도 있는 줄에 대해 더한 것. 유효 집계 =
> `inbound_shipment_box_counts` 중 `canceled_at IS NULL` 이고 그 줄에 묶인 행.
> **그리고 선적이 «외부에서 오는 선적»일 것.** 지금은 모든 선적이 외부다(출발 창고 칸이 없다). 1.5단계가 내부 선적을
> 만들면 그 물량은 이동 중 원장(`IN_TRANSFER`)이 세므로 여기서 빼야 한다(§12). 지금은 조건이 항상 참이지만 주석과
> 스펙 이름에 «외부 선적»을 박아 둔다.

결과로 나오는 것: 줄 단위 `{ skuId, shipmentId, warehouseId, expectedArrival(null 가능), outstandingQty > 0 }`.
세 소비자가 이것을 SKU·창고·문서로 접는다.

- 사람이 닫은 선적(`closed`, 사유 있음)·취소한 선적은 빠진다(상태 조건). 저절로 끝난 선적도 빠지지만, 리스트에 없는
  상자를 더해 `receiving` 으로 다시 열려도 그 상자는 줄이 없으므로 «오는 중»은 변하지 않는다.
- **늦은 선적(예정일 지남)도 수량에는 그대로 든다.** 날짜는 스토어프론트 표시에만 쓴다(§6). (반목표 2)
- 예정일이 빈 선적도 수량에는 든다. 날짜 후보에서만 빠진다.

### 5.2 둘 곳 **(Claude 판단)**

모듈 순환이 있다: 선적 상자 확정(`inbound-shipment-receiving.manager.ts`)이 이미 `ProductSellableQuantityService` 를
부르므로, 판매가능수량 쪽이 선적 모듈의 Nest 프로바이더를 주입하면 순환이 된다. 발주가 같은 문제를
`procurement/services/purchase-order-outstanding.sql.ts`(Nest 밖 순수 모듈, 판매가능수량이 import)로 풀었다. 같은 꼴로
`inventory/inbound-shipment/services/inbound-shipment-outstanding.sql.ts` 에 **트랜잭션을 받는 순수 함수 하나**를 둔다
(예: `selectOutstandingShipmentLines(trx, { skuIds?, warehouseId? })`). 세 소비자가 모두 이것을 부른다. 공식의 사본은
만들지 않는다.

- `inbound-kernel-boundary.arch.spec.ts`(문서 → 커널 한 방향)에 걸리지 않는지 빌더가 확인한다. 이 함수는 문서 테이블만
  읽고 커널을 부르지 않는다.
- 부분 인덱스 `(sku_id) WHERE kind = 'sku'` 가 이미 있다(①). 줄 수는 선적당 수백, 열린 선적은 보통 한두 개다.
- 파리티: 상자 열기·차이 계산(③)이 이미 «줄의 유효 집계 합»을 계산한다. 같은 식이 두 곳이므로 통합 스펙 하나로 «선적
  상세의 줄 잔량 합 = 이 함수의 합»을 고정한다(발주의 `expected-arrivals-parity.integration.spec.ts` 선례).

## 6. 스토어프론트 입고예정일

`product-sellable-quantity.service.ts` 의 `getByVariantIds` 가 발주 라인으로 `arrivalsByVariant` 를 만드는 자리에, §5 함수로
읽은 선적 줄을 SKU → variant(이미 읽은 `linkRows`)로 펼쳐 **같은 후보 목록에 더한다**.

- 후보: `{ expectedArrival, approximate: true }`. 규칙은 바꾸지 않는다 — 수동 재입고일이 먼저, 그다음 «오늘 이후 가장
  이른 날짜», 그 날짜의 후보 중 하나라도 «경»이면 «경»(`resolveRestockSchedule`).
- 조건: 선적 `expected_arrival IS NOT NULL AND >= today(KST)`, 그리고 선적 도착 창고가 판매 창고
  (`inSellableWarehouse`) **(Claude 판단 — 비판매 창고로 오는 물량은 팔 수 있게 되지 않는다. 발주 쪽 조회는 지금 창고를
  안 보지만 이번에 고치지 않는다)**.
- 후보에 출처를 싣는다 — 지금 후보는 `{ expectedArrival, approximate }` 뿐이고 `resolveRestockSchedule` 이 `inboundSource`
  를 늘 `'purchase_order'` 로 고정한다(`product-restock.ts:46`). 후보를 `{ expectedArrival, approximate, source }` 로 넓히고, 이긴
  날짜의 후보 출처를 돌려준다(같은 날 둘이면 빌더가 정하는 고정 순서). `inboundSource` 유니언에 `'inbound_shipment'` 를 더한다
  (`product-restock.ts`·`calculator.ts`·`variant-matching-batch.dto.ts`, admin-web `src/lib/types/dto/matching.ts` 와 그걸 그리는
  `use-product-variants-table-columns.tsx`). 이벤트 계약(`inventory.stream.ts`)은 `inboundDate`·
  `inboundApproximate` 만 실으므로 **계약 변경 없음**.
- 날짜가 지나면 기존 5분 크론(`product-restock-projection-refresh`)이 다시 계산해 지운다 — 새 크론 불필요.

## 7. 재발행 — 무엇이 «오는 중»을 바꾸나

«오는 중» 수량이나 날짜를 바꾸는 선적 동작은 **같은 트랜잭션 끝에서** 영향받은 SKU 로
`productSellableQuantity.recalculateAndPublishForSkus(skuIds, trx)` 를 부른다. 바뀌지 않은 투영은 발행을 건너뛴다(서비스
내장). 지금은 상자 확정·확정 취소만 부르고, 그것도 원장에 들어간 SKU 만 부른다.

| 동작 | 영향받은 SKU |
|---|---|
| 선적 확정(`draft → expected`) | 그 선적의 `sku` 줄 전부 |
| 선적 취소 | 그 선적의 `sku` 줄 전부 (확정 전 초안 취소는 원래 원천이 아니었으므로 생략 가능) |
| 도착 예정일 수정(`PATCH /:id`) | 그 선적의 `sku` 줄 전부 (`expected`·`receiving` 일 때) |
| 확정 뒤 줄 수정(`PATCH /lines/:lineId`) | 고치기 전·후 SKU 둘 다 |
| 상자 처분 변경(`PATCH /boxes/:boxId`) | 그 상자를 덮는 `sku` 줄의 SKU |
| 사람이 닫기(`close`) · 다시 열기(`reopen`) | 그 선적의 `sku` 줄 전부 |
| 상자 확정 | **그 상자를 덮는 `sku` 줄의 SKU 전부 + 리스트에 없던 물건 SKU** |
| 상자 확정 취소 | 위와 같음. **단 취소로 선적 상태가 바뀌면(닫혀 있던 선적이 `receiving` 으로 다시 열림) 그 선적의 `sku` 줄 전부** — 사람이 닫은 선적의 열린 상자 줄이 다시 «오는 중»이 된다(`inbound-shipment-receiving.manager.ts` 취소 뒤 상태 재파생) |

**상자 확정이 넓어지는 이유:** 줄의 마지막 상자를 0개로 확정하면 그 SKU 는 원장에 안 들어가지만 «오는 중»에서 빠진다.
지금처럼 원장에 들어간 SKU 만 재계산하면 그 품목의 입고예정일이 남는다.

영향받은 SKU 를 모으는 함수 하나(선적 id 또는 상자 id → SKU 집합)를 선적 모듈에 두고 각 Manager 가 부른다 **(Claude
판단)**. 선적당 SKU 가 수백 개여도 `recalculateAndPublishForSkus` 는 한 번에 받는다(발주 라인 실행이 같은 경로).

## 8. 처음 약속한 도착 예정일

- `inbound_shipments.promised_arrival date null`(mode `'string'`) 를 더한다(마이그 하나, 추가형).
- 마이그가 이미 확정된 선적(`confirmed_at IS NOT NULL`)은 지금 `expected_arrival` 로 채운다 **(Claude 판단 — 안 채우면
  «확정 뒤 첫 PATCH 값»이 약속일로 남아 데이터가 오염된다. 지금 값이 처음 값과 다를 수 있지만 더 나은 근사가 없다)**.
- 선적 확정 때 `expected_arrival` 을 복사한다. 확정 때 비어 있었으면, 확정 뒤 처음으로 값이 들어오는 `PATCH` 가 채운다.
  그 뒤로는 바꾸지 않는다.
- 실제 도착일은 따로 저장하지 않는다 — 그 선적의 `inbound_shipment_boxes.received_at` 최솟값으로 파생된다.
- 화면: 선적 상세에 예정일과 다를 때만 «처음 예정 ○/○»를 작게 보인다 **(Claude 판단 — 저장만 하면 아무도 모르고 쌓이고,
  다를 때만 보이면 정상 상태는 조용하다)**.

### 8.1 admin-web «예정일 지남»

- 선적이 `expected`·`receiving` 이고 `expected_arrival < 오늘(KST)` 이면 선적 목록 줄과 상세 머리에 «예정일 지남»을 보인다.
  화면이 날짜로 판정한다(core 응답의 `expectedArrival` 와 오늘) — core 변경 없음.
- 상세의 도착 예정일 고치기(기존 `PATCH`)로 바로 간다. 고치면 §7 트리거가 스토어프론트 날짜를 다시 띄운다.

## 9. 셀메이트 시기 입고예정 원천을 닫는다

**배포 뒤 한 번 도는 멱등 스크립트** `scripts/ops/…/close-sellmate-csv-inbound.ts` **(이름·위치는 빌더)**:

1. `audit_notes LIKE 'sellmate-csv-inbound%'` 발주의 열린 라인(`closed_at IS NULL`)을 **잔량 포기**로 닫는다. 상태를 직접
   UPDATE 하지 말고 core 의 잔량 포기 경로(`purchase-order.controller.ts` «잔량 포기» 라우트가 부르는 Manager)를 쓴다 — 발주
   헤더 파생·재발행이 따라온다. dry-run 이 기본이고 `--apply` 로 실행.
   잔량 포기 경로(`purchase-order-receiving.manager.ts`)가 이미 SKU 마다 재발행한다. `closedBy` 행위자는 기존 스크립트 선례의
   시스템 행위자(`00000000-0000-0000-0000-000000000000`)를 쓴다 **(Claude 판단)**.
2. 재계산: 열린 선적(`expected`·`receiving`)의 `sku` 줄 SKU 로 재발행한다. #1240 배포 전에 확정된 선적은 그때 재발행이 안
   돌았다(§7 트리거가 없었다).

옛 경로를 막는다 **(Claude 판단)**:

- `scripts/sellmate/load-inbound-from-csv.ts` 를 지운다. ADR-0039 D6 이 이미 «셀메이트 입고예정 CSV import 를 삭제한다»고
  정했는데 남아 있던 것이다.
- 지우는 스크립트 이름을 적은 주석·스펙(`purchase-order-outstanding.sql.ts` 주석, `expected-arrivals-parity.integration.spec.ts`)도
  함께 고친다.
- `apps/channel-adapter/scripts/sync-restock-to-medusa.ts` 와 `scripts/sellmate/inbound-run.sh` 의 `sync-restock` 단계를
  지운다. 이 스크립트는 발주 라인만 보는 SQL 로 Medusa `variant.metadata.inboundDate` 를 **직접** 쓰고, 발주에 없는
  variant 의 날짜는 «stale» 로 지운다 — 누가 돌리면 선적 기반 날짜가 지워진다(반목표 5). 지금은 투영 → 이벤트
  (`ProductSellableQuantityChanged`) → channel-adapter 소비자(`product-sellable-quantity.consumer.ts` → `medusa.client.ts`)가 같은
  메타데이터를 채운다(설계 중 확인). 런북 `docs/runbooks/selmate-stock-pipeline.md` ③ 절과 ADR-0028 의 해당 줄도 고친다.
- 컷오버 판정 스크립트 `scripts/ops/cutover-preflight/checks/inbound.ts`: «입고 2»의 안내를 «#1240 배포 때 닫는다»로,
  «입고 3»에 «선적 원천 — 열린 선적 수·오는 중 SKU 수»를 더한다. #1243 본문의 «셀메이트 CSV 가 만든 열린 발주 라인»
  항목은 «#1240 이 닫는다»로 고친다(산출물 교정은 원본 이슈 본문에).

## 10. 물류 앱 «입고 예정» 목록

**core** `GET /inventory/expected-arrivals?warehouseId=&include=inbound_shipment`:

- `include` 가 없으면 지금과 **똑같이** 발주만 낸다. 옛 앱은 모든 줄을 `/inbound/purchase-orders/$poId` 로 연결하므로, 선적
  줄을 받으면 404 가 난다 — 그래서 새 앱만 요청한다. admin-web 도 `include` 없이 부르므로 그대로다.
- `include=inbound_shipment` 면 그 창고의 열린 선적(`expected`·`receiving`, §5 에서 오는 중 수량이 0보다 큰 것)을
  `source: 'inbound_shipment'` 문서로 더한다: `documentId`(선적 id), `name`, `expectedDate`(`expected_arrival`),
  `totalOutstandingQuantity`(§5 합), 상자 `receivedBoxes`/`stockBoxes`. DTO 는 `source` 로 갈리는 유니언이다(발주 전용
  필드 `type`·`supplier`·`lines` 는 발주 쪽에만).
- 정렬은 지금처럼 예정일 오름차순, 날짜 없는 것은 뒤.

**warehouse-app** `ExpectedArrivalListScreen`:

- 쿼리에 `include=inbound_shipment` 를 붙인다.
- 선적 줄: 선적 이름 · 도착 예정일(지났으면 «예정일 지남») · «상자 ○/○» · «남은 ○». 스테이션이면 `/inbound/boxes` 로
  간다(상자 이름으로 찾는 기존 화면 — 선적을 미리 고르지 않는다, ③ 설계 §5.2). 핸드헬드는 누를 수 없게 두고 «스테이션
  작업» 표시 **(Claude 판단 — ③ 이 상자 입고를 스테이션 전용으로 정했다)**.
- 빈 목록 문구: «입고 예정이 없어요.» (간편입고 안내를 뺀다. 간편입고 버튼은 위에 그대로 있다)

## 11. 보충 제안

`InboundPipelineReader.read` 가 SKU 마다 내는 행에 둘을 더한다:

- `inboundShipmentQty` — §5 의 외부 선적 «오는 중» 합(창고 불문).
- `inboundShipmentToSellableQty` — 그중 도착 창고가 판매 창고인 것. 예정일 `inboundShipmentEta`(가장 이른 것, null 가능).

`suggestion.assembler.ts`:

- 전사 기준 `position` 에 `inboundShipmentQty` 를 더한다 → 발주 제안이 그만큼 준다.
- 판매 창고 기준 `position` 에 `inboundShipmentToSellableQty` 를 더한다 → 이동 제안이 그만큼 준다.
- 축 DTO 에 `inboundShipment`(전사)·`inboundShipmentToSellable`(판매 창고)을 내고, admin-web SKU 서랍에 «선적 오는 중» 한 줄씩
  (`sku-drawer/index.tsx` 의 «발주잔량»·«직행 발주잔량» 옆).
- 리드타임·수요 계산은 바꾸지 않는다.

🔴 **겹침 확인(배포 전 실측):** 보충 제안의 전사 기준은 전 창고 ON_HAND(`replenishment-stock.reader.ts` 의 `onHandTotal`)를
세고, 비판매 창고 ON_HAND(`nonSellableOnHand`)는 이동 제안의 재료가 된다. 중국 창고는 우리 밖이라 그 원장이 0이어야 한다.
0이 아니면(옛 동기화 잔재) 선적 잔량과 같은 물건을 두 번 센다. 같은 이유로 **CSV 표지가 아닌 열린 발주 라인**이 열린 선적과
같은 SKU 를 덮으면(해외 발주 잔량 + 선적 잔량) 두 번 센다. 판정 스크립트 `inbound.ts` 에 «비판매 창고 ON_HAND 합»과 «열린
선적과 SKU 가 겹치는 CSV 밖 열린 발주 라인 수»를 더하고, 0이 아니면 배포 전에 사용자에게 돌아온다 **(Claude 판단 — #1335 의
라이브 실측 항목과 같은 질의라 함께 둔다)**.

## 12. 1.5단계와의 경계 (중국 창고 편입)

컷오버는 1단계(재고 정본과 물류 작업을 core 로, #1233)와 2단계(마켓 연동, #1306)로 나뉘어 있고, 사용자는 **중국 창고를
시스템에 넣는 일을 1.5단계로** 두려 한다. 그 설계는 따로 한다. #1240 이 지키는 것은 하나다:

- 이 문서의 «오는 중»은 **외부에서 오는 선적**만 센다. 1.5단계에서 내부 선적(출발 창고 있음)이 생기면 그 물량은 이동
  지시서가 `IN_TRANSFER` 로 옮긴 원장에 이미 있고, 보충 제안 전사 기준은 그것을 이미 센다. 그때 §5 함수에 «출발 창고 없음»
  조건이 실제로 걸리게 된다.
- 지금 구조를 바꾸지 않는다. 1.5단계가 더할 것(선적의 출발 창고 칸·이동 지시서 연결, 상자 확정 효과의 분기)은 전부
  추가형이다.

## 13. 배포

- 마이그 하나(`promised_arrival` 추가) — **expand: migrate → deploy**.
- 순서: core → admin-web · warehouse-app. ③(#1343)이 아직 배포 전이므로 같은 배포 묶음이어도 된다 — core 쪽은 전부
  추가형이다.
- 배포 전: 판정 스크립트로 «CSV 열린 라인 수»·«비판매 창고 ON_HAND 합»·«겹치는 CSV 밖 발주 라인» 확인(§11 🔴).
- 판정 스크립트 `inbound.ts` 에 «예정일이 지났는데 열린 선적(`expected`·`receiving`)» 항목을 더한다 — 선적 이름·예정일·
  받은 상자 수. 컷오버 전에는 «T 전 도착분이면 셀메이트로 받은 뒤 닫는다», 컷오버 뒤에는 «예정일을 고치거나 닫는다»로
  안내한다(§8.1 배지와 같은 판정).
- 배포 뒤: §9 스크립트 dry-run → `--apply`. 그 뒤 스토어프론트에서 열린 선적 품목 하나(품절·수동 재입고일 없음)의
  입고예정일이 선적 날짜 «경»으로 보이는지 눈으로 확인.

## 14. 테스트

- `resolveRestockSchedule` 유닛: 선적 후보만 / 발주가 더 이름 / 선적이 더 이름 / 같은 날 «경» 섞임 / 지난 날짜 / 수동 우선.
- §5 함수 통합 스펙(`describeIfDb`): 부분 집계·0개 확정·전부 확정·전달용 상자만 덮는 줄·사람이 닫음·취소·예정일 null·
  판매/비판매 창고. 선적 상세 잔량과의 파리티.
- §7 트리거: 각 동작 뒤 `recalculateAndPublishForSkus` 가 표의 SKU 로 불리는지(Manager 통합 스펙의 기존 모킹 자리). 특히
  «마지막 상자를 0개로 확정».
- 파이프라인·어셈블러 유닛: 두 position 에 더해짐, 늦은 선적도 셈.
- expected-arrivals: `include` 없음 = 지금 응답과 같음(회귀), `include` 있음 = 선적 문서.
- warehouse-app: 선적 줄 렌더·스테이션 링크·핸드헬드 비활성·빈 문구(vitest).
- §9 스크립트: dry-run 이 아무것도 안 바꿈, 두 번 돌려도 같음.

## 15. 빌더에게 맡기는 것

- 파일·함수 이름, DTO 모양 세부, 문구.
- §5 함수의 질의 모양(한 번의 집계 질의 vs 줄 단위 후 접기).
- §9 스크립트의 위치와 Manager 호출 방식(스크립트에서 Nest 서비스를 직접 만드는 기존 선례 `scripts/sellmate/recalc-sellable.ts`).
- admin-web «예정일 지남» 배지의 모양(목록·상세).
