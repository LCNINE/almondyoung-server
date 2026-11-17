# 컷오버: 셀메이트 시기 자사몰 잔재(어긋난 출고주문·대기열 행)를 닫는다 — 설계

- 이슈: #1243 (상위 지도 #1233 · 축 3 출고)
- 날짜: 2026-11-17
- 짝: #1236 (재고를 선반 로케이션으로) — 별도 PR, 별도 설계 문서

## 1. 왜

셀메이트가 출고하는 동안 core 에는 실제와 어긋난 행이 쌓였다 — 판매주문은 셀메이트로 나갔는데 출고주문(FO)은 열린 채, 출고주문 생성 대기열(backlog)은 `awaiting_matching` 등으로 남은 채. 컷오버 뒤 이것들이 앱·admin-web 목록(출고 준비 화면, 매칭 대기)에 섞이면 작업자가 이미 나간 주문을 다시 본다.

## 2. 범위

- **1단계 = 자사몰(`sales_channel = 'medusa'`)만.** 마켓 주문은 1단계 내내 셀메이트가 처리하므로 그 잔재는 2단계(#1306)에서 본다.
- **가짜 발주 라인(셀메이트 CSV 거울)은 범위 밖** — #1240 의 `scripts/ops/close-sellmate-csv-inbound.ts` 가 닫는다. 이 스크립트는 발주·입고 표를 건드리지 않는다.
- **드레인 중 T 이전 미출고 주문은 범위 밖.** 아직 안 나간 주문은 닫을 수 없다. 이 주문들이 드레인 동안 출고 준비 화면에 보통 주문처럼 뜨는 문제(이중 출고 위험)는 #1412 로 뗐다 — 출고 준비 리더(`outbound-preparation.reader.ts`)는 `draft`·`planned` 상자를 시각 구분 없이 전부 보여 주고 화면에 주문 시각도 없다(2026-11-17 확인).

## 3. 목표 · 비목표 · 반목표

**목표**
- 컷오버 다음 날 앱·admin-web 목록에 셀메이트로 나간 자사몰 주문의 출고주문·상자·대기열 행이 없다.
- 닫을 것과 살릴 것의 경계가 **판매주문 상태**로 정해져 있고, 앱이 출고하는 주문은 어떤 경우에도 건드리지 않는다.

**비목표**
- Medusa 쪽 정리(`mark-medusa-shipped` 가 이미 한다), 마켓 주문, 가짜 발주.
- 취소된 판매주문인데 출고주문이 열린 행의 자동 정리 — 보고만 한다(§5.3).

**반목표**
- 상태를 직접 UPDATE 하는 **새** SQL 을 쓴다. 도메인 명령이나 기존 스크립트의 문장만 쓴다.
- 앱이 출고하는 주문이나 아직 셀메이트에서 안 나간 주문을 닫는다.
- 취소된 주문의 상자를 도메인 경로(리컨실러 30번 `order-reconcile.subject.ts`) 밖에서 닫는다.
- 다시 돌릴 때 다른 결과를 낸다.


## 4. 경계 — 판매주문 상태 (시각으로 자르지 않는다)

`orderStatusEnum` 주석대로 core 코드는 판매주문을 `shipped`·`delivered` 로 올리지 않는다. 그 값을 쓰는 건 셀메이트 스크립트(`mark-shipped-from-csv`·`mark-core-shipped`, 셀메이트 출고 CSV 가 입력)뿐이고, 읽는 곳은 모두 «core 밖에서 나갔다(외부 출고)»로 읽는다. 앱이 출고한 주문의 진실은 FO·상자다(ADR-0017). **그래서 판매주문 상태 자체가 «셀메이트로 나갔다»의 증거다 — 시각 T 로 자를 필요가 없다.**

| 판매주문 (자사몰) | 처리 |
|---|---|
| `shipped`·`delivered` (= 셀메이트로 나감) | 출고주문·상자·예약·대기열을 닫는다 |
| `cancelled` | 대기열 행만 닫는다 — 취소 경로가 부르는 바로 그 명령이다. 열린 FO·상자는 리컨실러 몫이라 보고만 |
| 그 밖(`pending`·`confirmed` …) | 건드리지 않는다 |

**시각으로 자르지 않는 이유(2026-11-17 사용자 결정, #1304 설계 «셀메이트에 넘긴 주문» 집합과 같은 판단):** `collect-cellmate` 는 시각이 아니라 display_id 와 입금 대기 목록으로 넘긴다. 시각으로 자르면 T 에 입금 대기였다가 T 뒤에 입금돼 앱으로 간 주문, 마지막 수집과 T 사이 주문, core 에 늦게 들어온 주문이 틀린다. 처음 설계는 `created_at < T` 를 안전띠로 뒀는데, 그러면 «드레인 미완료»가 영영 0 이 안 되고 늦게 들어온 넘긴 주문의 잔재가 남는다(빌더 점검에서 짚음). 판매주문 상태만으로 안전하므로 띠를 뺐다 **(Claude 판단)**.

**«드레인 미완료»는 넘긴 주문 집합으로 센다.** `sellmate_handed_over_orders`(저녁 맞추기 init 이 T 에 저장, #1304) 중 판매주문이 아직 `shipped`·`delivered`·`cancelled` 가 아닌 것. 집합이 비어 있으면(init 전 — 리허설) «집합 없음»으로 출력하고 그 줄만 건너뛴다.

## 5. 설계 — `scripts/sellmate/close-sellmate-leftovers.ts`

기본 dry-run, `--apply` 로 적용. `DATABASE_URL`(테넌트 1 core DB) 필수. **실행 전체가 한 트랜잭션이다**(최종 리뷰 반영 — 묶음마다 커밋하면 셀메이트로 나간 두 주문의 합포장 상자가 묶음 경계에서 갈려 안 닫히고, 중간 실패 뒤 재실행이 판매가능수량 재계산할 SKU 를 못 찾는다). 묶음(200)은 문장 파라미터 크기만 정한다. 아래 5.1~5.3 을 하고, 같은 트랜잭션에서 `markLineStateDirty(tx, salesOrderIds)` 를 부른다 — #1247 의 Medusa 예약 투영이 이 변화를 따라오게(`line-state-dirty.ts`: 바뀌는 쓰기와 같은 트랜잭션에서 부른다).

### 5.1 열린 출고주문

대상: FO 상태 `created`·`partially_reserved`·`ready`.
처리: `scripts/ops/cellmate-local/mark-core-shipped.sql.js` 의 `MARK_FULFILLMENT_ORDERS_SHIPPED`·`MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED` 를 그 판매주문의 `channel_order_id` 로 그대로 실행한다(취소 FO 건너뜀, FOI 는 취소 수량 뺀 만큼 — 그 파일의 규칙을 그대로 얻는다). 판매주문 문장은 부르지 않는다(이미 `shipped`). 판매주문:FO 는 0..1 이라(`uq_fulfillment_orders_sales_order`) 다른 FO 를 덮을 일이 없다.
FO 가 `processing`·`partially_shipped`·`recovery_required` 이면 그 판매주문은 5.1~5.3 모두 건너뛰고 보고한다 — 사람이 봐야 하는 상태다 **(Claude 판단)**.
**앱이 출고를 붙인 주문도 건너뛰고 보고한다**(최종 리뷰 반영): 교환품을 보냈거나(`customer_returns.kind='exchange'`·`exchange_released_at` 있음) 열린 입점사 상자(`shipments.supplier_id`)가 있는 주문. 교환 FOI 는 셀메이트로 나간 옛 FO 에 붙으므로 FO 째 닫으면 교환품이 송장 없이 «발송됨»이 된다.

### 5.2 상자와 예약

`scripts/sellmate/close-shipped-shipments.ts` 의 종결 로직(상자 먼저 닫고 예약 해제)을 함수로 export 하고, **판매주문 id 목록으로 좁히는 인자**를 더해 이 스크립트에서 부른다. 좁힌 조건: 상자의 모든 라인이 대상 판매주문의 FO 에 속하고 그 FO 가 terminal 이다. 진행 중 배치 작업 항목(`outbound_batch_work_items`, 상태가 `excluded`·`completed` 아님)이 가리키는 상자는 닫지 않고 보고한다. `recovery_required` 상자(집은 물건이 있을 수 있다)도 닫지 않고 보고한다 — 원래 CLI 는 닫는다 **(Claude 판단)**. 예약을 풀었으면 그 SKU 의 판매가능수량을 `ProductSellableQuantityService.recalculateAndPublishForSkus` 로 다시 계산해 낸다 — 원래 CLI 는 variant 목록만 파일로 남기고 `recalc-sellable` 을 따로 돌리게 했다 **(Claude 판단 — 한 명령으로 끝나게)**. CLI(인자 없이 부를 때)의 동작은 그대로 둔다 — T 전 매일 돌던 대로 **(Claude 판단)**.

### 5.3 대기열 행

대상: 열린 backlog(`pending`·`failed`·`processing`·`awaiting_matching`). 판매주문 `cancelled` 인 자사몰 주문의 열린 backlog 도 여기서 닫는다.
처리: `FulfillmentOrderCreationBacklogService.closeOpenForSalesOrder` (→ `not_required`). 생성은 `close-sellmate-csv-inbound.ts` 선례처럼 손으로 만든다. `processing` 은 워커가 잡은 행일 수 있지만, 워커는 `shipped` 판매주문에 FO 를 만들지 않으므로(`fulfillments.service.ts` 의 가드) 경합해도 결과가 같다.

### 5.4 보고만 하는 것

- 5.1 에서 건너뛴 판매주문(FO 가 사람이 볼 상태).
- 5.2 에서 건너뛴 상자(진행 중 배치 작업 항목).
- 앱이 출고를 붙인 주문(5.1).
- 앱 주문 줄과 섞여 남은 상자 — 셀메이트분 FO 는 닫혔으니 그대로 발송하면 409(`SHIPMENT_FOI_OVER_SHIPPED`)다. 사람이 상자를 나눠 셀메이트분 줄을 뺀다. FO 를 닫아 두는 쪽이 이중 출고보다 낫다고 본다 **(Claude 판단)**.
- 판매주문 `cancelled` 인데 FO·상자가 열린 것 — 리컨실러 30번 몫. 건수·목록만.
- «드레인 미완료» — §4. 0 이 아니면 드레인이 덜 끝났다는 뜻이니 끝난 뒤 다시 돌린다.

### 5.5 멱등 · 출력

- 대상 조건이 곧 멱등이다 — 닫힌 행은 다음 실행의 대상이 아니다. 같은 날 여러 번 돌려도 된다.
- 요약: 단계별 대상·처리 건수, 보고 항목. 주문 목록은 `--out`(기본 `apps/core/tmp/`)에 쓴다(주문 식별자가 들어가므로 커밋하지 않는다).
- 판정 스크립트 «출고 6»의 ◆ 문구(`이미 끝난 주문의 매칭 대기`)에 이 스크립트 명령을 적는다.

### 5.6 테스트

- 경계 판정을 순수 함수로 떼어 단위 테스트한다(표의 각 줄, 채널, FO 상태별 건너뜀).
- 통합 스펙(`describeIfDb`): 외부 출고 주문의 FO·상자·예약·backlog 가 닫히고 줄 상태 표시가 남는다; 앱 출고 중 주문(`confirmed`)·마켓 주문·취소 주문의 상자는 그대로; 진행 중 작업 항목이 걸린 상자는 그대로; 재실행 0건. `mark-core-shipped.integration.spec.ts` 의 픽스처를 참고한다.

## 6. 운영

- 실행 시점: **드레인 끝**(#1233·설계 문서 «컷오버 당일» 순서 4). `mark-shipped-from-csv`·`mark-core-shipped`·`mark-medusa-shipped` 를 마지막으로 돌린 **뒤** 이 스크립트 dry-run → `--apply`. **T 뒤에는 `close-shipped-shipments` 를 단독으로 돌리지 않는다** — 그 CLI 는 채널·취소를 가리지 않아 앱이 맡은 취소 주문의 상자를 도메인 경로 밖에서 닫는다. 드레인 끝의 상자 정리는 이 스크립트의 5.2 가 대신한다. 당일 순서 4 의 목록을 그렇게 고친다(#1233 본문·#1251).
- 완료 판정: 이 스크립트의 «드레인 미완료» 0 + 보고 항목 확인, 판정 스크립트 «출고 6»의 ◆ 줄(`이미 끝난 주문의 매칭 대기`) 0, «출고 4»의 «끝난 출고주문에 붙은 확정 예약» 0. 섹션 전체 초록은 기준으로 삼지 않는다 — «출고 6»의 `open`·«출고 4»의 가용 음수는 이 스크립트 밖에도 원인이 있다.
- 리허설: T 전에 dry-run 을 한 번 돌린다. 지금 쌓인 잔재 건수를 미리 본다(«드레인 미완료»는 집합이 없어 건너뛴다).
- 라이브 dry-run 은 터널이 필요하다 — 사용자가 띄운다. 배포 무관(스크립트만). 단 «드레인 미완료»는 `sellmate_handed_over_orders` 표가 있어야 하므로 #1354 의 live `db:migrate` 뒤에 의미가 있다.

## 7. 빌더에게 남긴 것

- `close-shipped-shipments.ts` 를 함수로 떼는 모양(좁히는 인자 포함).
- 출력 서식.
