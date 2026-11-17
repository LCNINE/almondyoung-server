# 컷오버: 셀메이트 시기 자사몰 잔재(어긋난 출고주문·대기열 행)를 닫는다 — 설계

- 이슈: #1243 (상위 지도 #1233 · 축 3 출고)
- 날짜: 2026-11-17
- 짝: #1236 (재고를 선반 로케이션으로) — 별도 PR, 별도 설계 문서

## 1. 왜

셀메이트가 출고하는 동안 core 에는 실제와 어긋난 행이 쌓였다 — 판매주문은 셀메이트로 나갔는데 출고주문(FO)은 열린 채, 출고주문 생성 대기열(backlog)은 `awaiting_matching` 등으로 남은 채. 컷오버 뒤 이것들이 앱·admin-web 목록(출고 준비 화면, 매칭 대기)에 섞이면 작업자가 이미 나간 주문을 다시 본다.

## 2. 범위

- **1단계 = 자사몰(`sales_channel = 'medusa'`)만.** 마켓 주문은 1단계 내내 셀메이트가 처리하므로 그 잔재는 2단계(#1306)에서 본다.
- **가짜 발주 라인(셀메이트 CSV 거울)은 범위 밖** — #1240 의 `scripts/ops/close-sellmate-csv-inbound.ts` 가 닫는다. 이 스크립트는 발주·입고 표를 건드리지 않는다.
- **드레인 중 T 이전 미출고 주문은 범위 밖.** 아직 안 나간 주문은 닫을 수 없다. 이 주문들이 드레인 동안 출고 준비 화면에 보통 주문처럼 뜨는 문제(이중 출고 위험)는 별도 이슈로 뗀다 — 출고 준비 리더(`outbound-preparation.reader.ts`)는 `draft`·`planned` 상자를 시각 구분 없이 전부 보여 주고 화면에 주문 시각도 없다(2026-11-17 확인).

## 3. 목표 · 비목표 · 반목표

**목표**
- 컷오버 다음 날 앱·admin-web 목록에 셀메이트로 나간 자사몰 주문의 출고주문·상자·대기열 행이 없다.
- 닫을 것과 살릴 것의 경계가 **판매주문 상태**로 정해져 있고, T 이후 주문은 어떤 경우에도 건드리지 않는다.

**비목표**
- Medusa 쪽 정리(`mark-medusa-shipped` 가 이미 한다), 마켓 주문, 가짜 발주.
- 취소된 판매주문인데 출고주문이 열린 행의 자동 정리 — 보고만 한다(§5.3).

**반목표**
- 상태를 직접 UPDATE 하는 **새** SQL 을 쓴다. 도메인 명령이나 기존 스크립트의 문장만 쓴다.
- 앱이 출고 중인(T 이후) 주문이나 아직 셀메이트에서 안 나간 주문을 닫는다.
- 다시 돌릴 때 다른 결과를 낸다.

## 4. 경계 — 판매주문 상태

`orderStatusEnum` 주석대로 core 코드는 판매주문을 `shipped`·`delivered` 로 올리지 않는다. 그 값을 쓰는 건 셀메이트 스크립트뿐이고, 읽는 곳은 모두 «core 밖에서 나갔다(외부 출고)»로 읽는다. 앱이 출고한 주문의 진실은 FO·상자다(ADR-0017). 그래서:

| 판매주문 | 처리 |
|---|---|
| `shipped`·`delivered` (= 셀메이트로 나감) | 닫는다 |
| `cancelled` | 대기열 행만 닫는다. 열린 FO 는 보고만 |
| 그 밖(`pending`·`confirmed` …) | 건드리지 않는다. T 이전 것은 «드레인 미완료»로 센다 |

여기에 **`sales_orders.created_at < T`** 를 안전띠로 더한다(`--cutover-at=<T>` 필수). T 이후 주문은 상태와 상관없이 대상에서 빠진다.

## 5. 설계 — `scripts/sellmate/close-sellmate-leftovers.ts`

기본 dry-run, `--apply` 로 적용. `DATABASE_URL`(테넌트 1 core DB) 필수, `--cutover-at` 필수. 순서가 중요하다 — 아래 순서대로 한다.

### 5.1 외부 출고된 주문의 열린 출고주문

대상: 자사몰 · T 이전 · 판매주문 `shipped`/`delivered` · FO 상태 `created`·`partially_reserved`·`ready`.
처리: 대상 판매주문의 `channel_order_id` 목록으로 `scripts/ops/cellmate-local/mark-core-shipped.sql.js` 의 `MARK_FULFILLMENT_ORDERS_SHIPPED`·`MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED` 를 그대로 실행한다(그 파일의 취소 존중 규칙 — 취소 FO 건너뜀, FOI 는 취소 수량 뺀 만큼 — 을 그대로 얻는다). 판매주문 문장은 부르지 않는다(이미 `shipped`).
FO 가 `processing`·`partially_shipped`·`recovery_required` 인 것은 사람이 봐야 하는 상태라 **보고만** 한다 **(Claude 판단)**.

### 5.2 상자와 예약

5.1 뒤에 `scripts/sellmate/close-shipped-shipments.ts` 의 종결 로직(상자 먼저 닫고 예약 해제)을 같은 실행 안에서 부른다. 그 스크립트를 함수로 export 하도록 최소한으로 고치고, CLI 동작은 그대로 둔다 **(Claude 판단 — 한 명령으로 끝나게)**. 그 로직은 채널을 가리지 않는다 — 원래 매일 그렇게 돌던 스크립트이고, 판정 기준(상자의 FO 가 전부 terminal)이 채널과 무관하게 옳다.

### 5.3 대기열 행

대상: 자사몰 · T 이전 · 판매주문 `shipped`/`delivered`/`cancelled` · 열린 backlog(`pending`·`failed`·`processing`·`awaiting_matching`).
처리: 판매주문마다 `FulfillmentOrderCreationBacklogService.closeOpenForSalesOrder` (→ `not_required`). 생성은 `close-sellmate-csv-inbound.ts` 선례처럼 손으로 만든다.
`processing` 은 워커가 잡은 행일 수 있다. 실행 시점(드레인 뒤, 이 주문들엔 새 작업이 없음)에는 안전하다고 보고 서비스 규칙을 그대로 따른다 **(Claude 판단)**.

### 5.4 보고만 하는 것

- 판매주문 `cancelled` 인데 FO 가 열린 것 — 취소 커널(K7)을 거쳤다면 없어야 한다. 있으면 건수·주문 목록을 출력하고 사람이 본다.
- T 이전 · 판매주문이 아직 외부 출고 전 — «드레인 미완료». 0 이 아니면 드레인이 덜 끝났다는 뜻이니 끝난 뒤 다시 돌린다.
- T 이후 주문 건수(건드리지 않았음을 보이려고).

### 5.5 멱등 · 출력

- 대상 조건이 곧 멱등이다 — 닫힌 행은 다음 실행의 대상이 아니다. 같은 날 여러 번 돌려도 된다.
- 요약: 단계별 대상·처리 건수, 보고 항목. 주문 목록은 `--out`(기본 `apps/core/tmp/`)에 쓴다(주문 식별자가 들어가므로 커밋하지 않는다).
- 판정 스크립트 «출고 6»의 ◆ 문구(`이미 끝난 주문의 매칭 대기`)에 이 스크립트 명령을 적는다.

### 5.6 테스트

- 경계 판정을 순수 함수로 떼어 단위 테스트한다(표의 각 줄, T 경계, 채널).
- 통합 스펙(`describeIfDb`): 외부 출고 주문의 FO·상자·예약·backlog 가 닫히고, T 이후 주문·미출고 주문·마켓 주문은 그대로; 재실행 0건. `mark-core-shipped.integration.spec.ts` 의 픽스처를 참고한다.

## 6. 운영

- 실행 시점: **당일 순서 4, 드레인 끝** — `mark-shipped-from-csv`·`mark-core-shipped`·`mark-medusa-shipped`·`close-shipped-shipments` 를 마지막으로 돌린 **뒤** dry-run → `--apply`. «드레인 미완료»가 0 인지 본다. 판정 스크립트 재실행(«출고 4»·«출고 6» 초록).
- 리허설: T 전에 dry-run 을 한 번 돌린다(`--cutover-at` 에 지금 시각). 지금 쌓인 잔재 건수를 미리 본다.
- 라이브 dry-run 은 터널이 필요하다 — 사용자가 띄운다. 배포 무관(스크립트만).
- 런북(#1251)에 실행 시점을 적는다 — 런북 문서가 아직 없으므로 #1251 본문에 한 줄 더한다.

## 7. 빌더에게 남긴 것

- `close-shipped-shipments.ts` 를 함수로 떼는 모양.
- 5.1 의 `MARK_FULFILLMENT_ORDERS_SHIPPED` 는 `status not in ('shipped','canceled')` 라 같은 판매주문의 `completed` FO 도 `shipped` 로 덮는다. 대상 판매주문에 `completed` FO 가 섞여 있으면 그 판매주문은 5.1 에서 빼고 보고로 돌린다.
- 출력 서식.
