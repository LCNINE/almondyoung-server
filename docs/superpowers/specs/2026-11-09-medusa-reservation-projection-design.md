# Medusa 예약을 core 판매주문 줄 상태로 맞춘다 — 설계 (#1247)

상위: #1233 축 5 · 대체: `scripts/sellmate/clear-reservations.ts` · 관련: #832

## 1. 왜

Medusa 는 주문마다 자기 예약(`reservation_item`)을 잡고, 그 예약은 Medusa fulfillment 로만 풀린다.
우리 dispatch 는 fulfillment 를 만들지 않고 주문 metadata 만 쓴다
(`apps/channel-adapter/src/adapters/medusa/medusa.client.ts` `updateOrderShipmentAttemptProjection`).
그래서 Medusa 예약이 영원히 남는다. core 가 Medusa 에 보내는 판매가능수량은 이미 core 예약·출고를 뺀 값이라,
Medusa 가 자기 예약을 또 빼면 **이중 차감 → 가짜 품절**이다.

지금은 사람이 `clear-reservations` 로 «셀메이트 재고 CSV 시각 이전 예약»을 매일 지운다. 셀메이트를 끊으면
그 CSV 가 없어지고 기준도 사라진다. 이 작업이 끝나면 **컷오버 뒤 `clear-reservations` 없이 하루가 지나도
Medusa 예약이 core 상태와 맞는다**(완료 조건, 판정 스크립트 `scripts/ops/cutover-preflight/` 축 0 으로 잰다).

## 2. 목표 · 비목표 · 반목표

**목표**
- 시각 T 이후 생긴 Medusa 주문의 줄마다, Medusa 예약 수량이 `max(0, 주문 − core 예약 − 출고 − 취소)` 와 같다.
- 평소엔 이벤트로 바로 맞고, 놓친 줄은 하루 한 번 대사가 고친다.
- 대사가 비정상적으로 많이 고치려 하면 멈추고 admin-web 에 남긴다. 사람이 확인하고 버튼 하나로 마저 고친다.

**비목표**
- T 이전 주문. 마지막 `clear-reservations`(당일 순서 2번)와 드레인 뒤 `mark-*` 스크립트(당일 순서 5번)가 닫는다.
- 마켓(네이버·쿠팡) 예약. 마켓엔 예약 개념이 없다(능력 표 `none`).
- core 03:05 `zombie-reservation-reconciliation` 크론(#832 의 core 쪽 절반). core 의 `stock_reservations` 를
  `FULFILLMENT_ORDER` grain 으로 청소하는 별개의 문제라 이 작업이 대체하지 않는다. #832 본문에 «Medusa 쪽 절반은 #1247» 로 적고
  core 쪽은 #832 에 남긴다.
- push 알림(Google Chat 등). 지금 웹훅이 가는 방은 팀장이 볼 수 없는 방이라 쓰지 않는다. 방이 정해지면 나중에 더한다.
- Medusa 출고 수량 표시(#802), Medusa fulfillment 생성.

**반목표 (기술적으로 돌아가도 실패인 것)**
- **오버셀.** Medusa 예약을 잘못 지워 실제보다 많이 팔리게 하는 것. 어긋날 거면 «잠깐 이중 차감» 쪽으로 어긋나야 한다.
- **수집 시점에 Medusa 예약을 지우는 것.** 매칭 대기·재고 부족이면 core 예약이 0 이라, 그때 Medusa 예약까지 지우면 아무도 재고를 잡지 않는다.
- **T 이전 주문을 건드리는 것.** 셀메이트 시기 주문 중 core 가 예약하지 않은 줄의 Medusa 예약을 다시 만들면,
  `clear-reservations` 가 «CSV 에서 이미 뺐다»며 지운 예약이 되살아나 이중 차감이 돌아온다.
- **core 가 Medusa 를 아는 것.** core 는 줄의 사실만 낸다(ADR-0040 표 «Medusa 의 존재를 모른다»).
- **Medusa DB 를 직접 고치는 것.** `inventory_level.reserved_quantity`·`raw_reserved_quantity` 캐시가 예약 행과 어긋난다
  (2026-07-30·07-31 라이브에서 실제로 났다, `clear-reservations.ts` 머리 주석). 반드시 Medusa 워크플로를 지난다.

## 3. 정해진 것

**11-08 (#1247 본문)**
- core 는 판매주문 줄의 **현재 상태**(주문·core 예약·출고·취소 수량)를 그 상태가 바뀌는 트랜잭션에서 outbox 로 enqueue 한다.
  core 는 직접 발행하지 않는다(`core-no-direct-publish.spec.ts`).
- channel-adapter 가 `Medusa 예약 = max(0, 주문 − core 예약 − 출고 − 취소)` 로 그 줄
  (Medusa `line_item_id` = core 의 `channel_order_item_id`)의 Medusa 예약을 그 값으로 **설정**한다(증감이 아니다).
- `CHANNEL_CAPABILITIES` 에 예약 축 한 줄: Medusa=`projection`, 마켓=`none`.
- 하루 한 번 대사. 수집 시점에 지우지 않는다.

**11-09 (사용자 결정)**
- **켜는 시점 = 시각 T.** T 가 비어 있으면 이벤트 소비도 대사도 아무것도 하지 않는다. T 이후에 **생긴(Medusa `order.created_at`) 주문**의 줄만 맞춘다.
  그래서 channel-adapter 를 먼저 배포해도 안전하고, 컷오버 당일 순서 3번에서 T 를 넣으면 그때부터 동작한다.
- **대사는 channel-adapter 크론이다.** Medusa 는 직접 읽고 core 는 내부 HTTP 로 묶음 조회한다
  (선례: #1016 45번 `CoreSalesOrderLookupClient`). core 조회가 실패하면 «줄이 없다»로 읽지 않고 **그 주기를 통째로 건너뛴다.**
- **대사는 처음부터 직접 고친다.** 리컨실러 표준(#1016 12번)의 «관찰로 시작 → PR 로 실행 전환»에서 벗어난다.
  컷오버 뒤엔 대사가 유일한 안전망이라 관찰만 하면 아침마다 사람이 손으로 고쳐야 하기 때문이다.
- **단, 고칠 줄이 비정상적으로 많은 회차는 고치지 않고 멈춘다.** 이벤트 경로가 통째로 멈췄거나 공식에 버그가 있다는 신호라서,
  그대로 고치면 버그를 모든 줄로 옮긴다.
- **Medusa 예약을 줄이는 쓰기는 그 상품의 판매가능수량이 반영된 뒤에만 한다. 늘리는 쓰기는 바로 한다.**
  core 가 예약을 확정하면 같은 트랜잭션에서 `ProductSellableQuantityChanged` 도 나가는데
  (`apps/core/src/modules/inventory/shared/services/unified-reservation.service.ts`), channel-adapter 는 그 이벤트를 일부러 후순위 레인으로
  처리한다(`inbox-worker.service.ts` `BULK_EVENT_TYPES`, 이틀 밀린 이력). 예약 −X 가 재고 숫자 −X 보다 먼저 닿으면 그 사이 Medusa available 이
  X 만큼 부풀어 오버셀이 난다 — 11-08 의 «순서가 어긋나도 잠깐 이중 차감» 전제가 이 경우엔 틀렸다. 그래서 줄이는 쪽만 기다린다.
  대가: 판매가능수량 이벤트가 밀리는 날엔 그만큼 예약이 늦게 풀려 가짜 품절이 길어진다(밀린 게 빠지면 풀린다). 사용자가 이쪽을 골랐다.
  이벤트 소비와 대사 둘 다 같은 규칙이다. «기다림»은 실패가 아니라 다시 시도이고, 대사의 고칠 줄 수·멈춤 한도에 넣지 않는다(따로 센다).
- **멈춘 회차는 admin-web `/order/channel-mismatches` 에 보인다.** 같은 화면에 «Medusa 예약 대사가 멈췄다» 종류로:
  멈춘 시각, 고치려던 줄 수, 예시 몇 줄. 버튼은 «확인했으니 고치기»(그 자리에서 한도 없이 한 회차 실행)와 «종결».
  push 알림은 없다 — **누군가 화면을 열어야 보인다**는 걸 받아들였고, 컷오버 직후엔 판정 스크립트 ✗ 가 받친다.

## 4. 흐름

```
core  (예약 확정·해제 / 출고 / 취소 / 전달 트랜잭션 — 표시 테이블에 한 줄 INSERT)
  └─ 1분 폴러 → outbox: SalesOrderLineReservationState  (주문 단위 스냅샷 + 버전)
        ↓ Kafka
channel-adapter consumer → inbox_events (빠른 ACK)
        ↓ InboxWorkerService (eventType allowlist)
   T 이후 주문? 버전이 더 새로운가? → 목표 수량 계산 → Medusa 배치 라우트
        ↓
Medusa  POST /admin/<우리 경로>/line-item-reservations  → 워크플로 한 번 (생성·수정·삭제)

channel-adapter 크론 (하루 한 번)
  후보 = Medusa 쪽(T 이후 주문, 예약이 살아 있는 줄) ∪ core 쪽(T 이후 주문, core 가 예약하지 않은 수량이 있는 줄)
  → core 내부 API 로 줄 상태 묶음 조회 (실패 → 주기 건너뜀)
  → 목표 수량과 다른 줄 = 고칠 줄
  → 한도 이하면 같은 Medusa 배치 라우트로 고침 / 넘으면 멈추고 기록
```

이벤트 소비와 대사는 **같은 계산 함수와 같은 Medusa 라우트**를 쓴다. 공식이 두 벌이 되지 않게.

## 5. 부분별 설계

### 5-1. core — 사실과 읽는 문

- 수량의 정본은 이미 있다: `readLineQuantities`(`apps/core/src/modules/sales-order/line-quantities/line-quantities.reader.ts`,
  ADR-0047 «읽는 문 하나»). 출고·취소·전달은 거기서 읽는다. **core 예약 수량**은 그 문에 없으므로 같은 문에 더한다
  (`stock_reservations` 의 `confirmed` 행, `target_type='SHIPMENT_LINE'` → `shipment_lines.fulfillment_order_item_id` → FOI → 판매 라인).
  새 소비자가 옆에서 따로 세지 않는다 — ADR-0047 가드(`line-quantity-read.guard.spec.ts`)의 취지를 따른다.
- **판매 단위로 센다.** Medusa 예약은 variant(판매 단위) 기준이다. 세트처럼 한 판매 단위가 여러 SKU 인 줄은
  «구성 SKU 가 전부 예약·출고된 판매 단위»만 core 가 잡은 것으로 센다(구성마다 `floor(수량/qtyPerUnit)` 의 최솟값).
  일부만 잡힌 단위는 Medusa 가 계속 잡고 있게 둔다 — 반목표 «어긋날 거면 이중 차감 쪽»에 맞는 방향이다. *(Claude 판단)*
- **이벤트 `SalesOrderLineReservationState`** — 주문 단위 스냅샷. 그 판매주문의 모든 줄을 담는다:
  `salesOrderId`, `salesChannel`, `channelOrderId`, `orderedAt`, `version`, `asOf`, 줄마다 `{ salesOrderLineId, channelOrderItemId, variantId, ordered, canceledBeforeShipment, demand, heldUnits }`.
  `heldUnits` = 구성 SKU 마다 `floor((예약 + 출고 + 전달) / qtyPerUnit)` 의 최솟값 — 예약·출고·전달을 따로 세어 더하면 섞여 갖춰진 세트를 놓친다. *(계획 단계 Claude 판단)*
  스트림은 판매주문 사실이 나가는 기존 스트림 중에서 고른다(빌더 판단, zod 계약은 `packages/event-contracts`).
- **버전이 필요하다.** 11-08 본문은 «현재 상태라 순서가 바뀌어도 결과가 같다»고 했지만, 옛 스냅샷이 늦게 도착하면 새 값을 덮어쓴다.
  inbox worker 는 동시에 처리하므로 순서가 보장되지 않는다. 그래서 주문마다 단조 증가하는 버전을 싣는다.
  권장: `sales_orders` 에 카운터 열을 더하고 enqueue 하는 트랜잭션에서 `UPDATE … SET v = v + 1 RETURNING v` 로 올린다
  (행 잠금이 같은 주문의 동시 트랜잭션을 줄 세운다). additive 마이그 → **migrate → deploy**. *(Claude 판단)*
- **표시 지점과 폴러** *(계획·구현 단계 Claude 판단)*: 상태를 바꾸는 트랜잭션은 enqueue 대신 표시 테이블 `sales_order_line_state_marks` 에
  한 줄 INSERT 만 한다(판매주문 행을 잠그지 않는다 — 예약 경로는 FO→SO, 취소는 SO→FO 순서로 잠가 교착이 생기므로. FK 도 같은 이유로 두지 않는다).
  표시 지점은 둘 — 예약·출고·전달·FO 수량 변화가 전부 지나는 `reprojectFulfillmentOrders`, 그리고 `recordSalesOrderCancellation`.
  1분 `@CronOnce` 폴러가 주문마다 짧은 트랜잭션에서 `sales_orders` 행을 `FOR UPDATE SKIP LOCKED` 로 잡고(기다리지 않는다), 그 주문의 보이는 표시를
  `DELETE … RETURNING` 으로 가져간 뒤 `line_state_version` 을 올리고 스냅샷을 읽어 outbox 로 낸다. 버전을 올리는 건 폴러뿐이다.
  그 뒤에 커밋된 표시는 남아 다음 틱에 새 버전을 만든다. 유실이 없고, 여러 변화가 한 이벤트로 모인다. 대가는 최대 1분 지연. 두 표시 지점은 가드 스펙이 지킨다.
- **내부 읽기 API** (대사용, `@InternalOnly`, `CORE_INTERNAL_KEY` + 테넌트 헤더):
  - 줄 상태 묶음 조회: `channelOrderItemId[]` → 위 스냅샷과 같은 모양(같은 리더를 탄다).
  - core 쪽 후보: «채널 `medusa`, 주문 생성 ≥ T, `demand − coreReserved − shipped − forwarded > 0`» 인 줄 목록(커서).
  - core 는 T 를 모른다 — T 는 요청 인자로 받는다.

### 5-2. Medusa — 배치 라우트 하나, 워크플로 하나

- CLAUDE.md Medusa 규칙: 한 동작 = 라우트 하나 → 워크플로 하나. channel-adapter 가 Medusa 를 여러 번 순서대로 불러 조립하지 않는다.
- **쓰기 라우트**: «이 줄들의 예약을 각각 N 으로». 입력 `{ items: [{ line_item_id, quantity }] }`, 건별 결과 반환(ADR-0040: 배치 수신 라우트는
  검증 + 워크플로 한 번 + 건별 결과). 워크플로 안에서 0 이면 삭제, 줄었으면 수정, 늘었거나 없으면 생성.
  생성에 필요한 `inventory_item_id`(variant 의 인벤토리 항목, `required_quantity` 반영)와 `location_id` 는 워크플로가 주문에서 찾는다.
  Medusa 기본 예약 워크플로(`createReservationsWorkflow`·`updateReservationsWorkflow`·`deleteReservationsWorkflow`)를 조합한다 —
  확장점은 문서(`https://docs.medusajs.com/llms.txt`)에서 먼저 확인한다.
- **읽기 라우트**: «주문 생성 ≥ T 인 주문의 살아 있는 예약» 목록(커서, `line_item_id`·수량). 대사의 Medusa 쪽 후보다.
- 코어 라우트 override 는 하지 않는다. 우리 경로로 새로 둔다.
- **만들거나 늘리는 예약은 `allow_backorder: true` 로 쓴다.** 판매가능수량 이벤트보다 증가가 먼저 닿으면 Medusa 가 «재고 부족»으로 거절하고,
  그러면 줄이 덜 잡혀 오버셀 쪽으로 어긋난다. 이 플래그로 Medusa available 이 잠깐 음수가 될 수 있는데, 그건 이중 차감 쪽이라 반목표를 넘지 않는다. *(구현 단계 Claude 판단)*
- 쓰기 잠금은 고정 키 하나(타임세일 선례). 쓰기 실패 시 배치 전체가 되돌아가고, 결과는 «쓰려던 줄만 error»로 돌려준다.

### 5-3. channel-adapter — 소비자, 대사, 기록

- **능력 표**: `CHANNEL_CAPABILITIES` 의 `api` 갈래에 `reservation: ChannelRoute` 축. medusa=`projection`, naver·coupang=`none`.
  소비자와 대사는 이 축이 `projection` 인 채널만 다룬다.
- **T 의 거처는 env 가 아니라 DB 다.** env 를 바꾸려면 배포가 필요한데 T 는 컷오버 당일에 넣는 값이다.
  channel-adapter DB 의 설정 한 행 + 넣는 스크립트(런북 한 줄). 비어 있으면 소비자는 이벤트를 받아 `processed`(건너뜀)로 닫고,
  대사는 돌지 않는다. *(Claude 판단)*
- **소비자**: 기존 inbox 패턴(Kafka → `inbox_events` → `InboxWorkerService` allowlist). 처리 시
  ① T 가 없거나 주문이 T 이전이면 건너뜀 ② 이미 적용한 버전보다 낮거나 같으면 건너뜀 ③ 줄마다 목표 수량 계산
  ④ variant 에 처리되지 않은 `ProductSellableQuantityChanged` inbox 행이 남았거나 스냅샷이 정착 지연(기본 5분)보다 젊으면 그 줄은 «감소 금지»로 표시
  ⑤ Medusa 쓰기 라우트 — 감소 금지 줄의 감소는 라우트가 실제 현재값과 비교해 `deferred` 로 돌려준다 ⑥ `deferred` 가 있으면 1분 뒤 다시(재시도 횟수에 안 셈), 없으면 적용 버전 기록.
  정착 지연은 판매가능수량 이벤트가 아직 inbox 에 도착하지도 않은 경우(토픽이 달라 도착 순서가 보장되지 않는다)를 덮는다. *(계획 단계 Claude 판단)*
  워커는 `InboxWorkerService` 레인(10초 간격)과 따로 둔다.
  적용 버전은 channel-adapter 의 새 테이블(주문당 한 행)에 둔다. Medusa 주문 생성 시각은 `wms_order_mappings` 또는 수집 시점 기록에서 찾는다(빌더 판단).
- **계산 함수 하나**: `target = max(0, demand − coreReserved − shipped − forwarded)`, `demand = ordered − canceledBeforeShipment`.
  순수 함수, 소비자와 대사가 공유. **11-08 공식의 «− 취소»를 고쳤다**: 출고 후 취소(`after_shipment`)는 이미 출고된 단위의 취소라
  `shipped` 에 그대로 남는다(`line-quantities.sql.ts`, ADR-0047 E2 와 같은 정의). 갈래 무관 `canceled` 를 빼면 그 단위를 두 번 빼서
  «주문 2 · 1개 출고 · 출고 후 취소 1 · 나머지 1개 재고 부족» 줄의 목표가 1 이 아니라 0 이 되고, 오버셀이 난다. 테스트로 고정한다. *(Claude 판단, 리뷰 지적)*
- **투영 대상은 «Medusa 가 재고를 관리하는 줄»뿐이다.** variant 가 없거나 인벤토리 항목이 없는 줄은 계산하지 않는다.
  예: 교환 대체 줄은 Medusa 에서 일부러 variant 를 붙이지 않는다(`apps/medusa/src/workflows/orders/returns/exchange-replacements.ts`, 설계 E2).
  이런 줄이 «고칠 줄»·실패로 세어져 멈춤 한도를 오염시키지 않게 한다. *(Claude 판단)*
- **core 가 모르는 줄은 건드리지 않는다.** 대사의 Medusa 쪽 후보에는 core 에 판매주문 줄이 없는 예약이 섞인다 — 입금 대기 주문
  (`medusa-order.source.ts` 가 수집하지 않는다), 식별 실패로 격리된 주문. «조회는 성공했는데 줄이 없음»을 0 으로 읽으면 매칭 대기 주문의 예약을
  지운다(반목표 2). 그래서 손대지 않고, 고칠 줄 수·멈춤 한도에도 넣지 않는다. 대신 회차 기록에 «core 가 모르는 예약 n 줄, 가장 오래된 것의 나이»를 남기고
  화면에 보인다 — 만료됐는데 Medusa 가 풀지 않은 예약이 쌓이면 사람이 알아챈다. *(Claude 판단)*
- **대사 크론**: `@CronOnce`(하루 한 번, KST 새벽, 이름 유일). 후보 모으기 → core 묶음 조회(200건 단위, 선례와 같게) → 계산 → 다른 줄만 모음.
  - 고칠 줄 수 ≤ 한도 → Medusa 쓰기 라우트로 고침. 회차 결과(후보 수·고친 수·실패 수)를 기록.
  - 고칠 줄 수 > 한도 → 고치지 않고 «멈춘 회차»로 기록(예시 몇 줄 포함).
  - core 조회 실패 → 아무것도 고치지 않고 «건너뜀»으로 기록.
  - 한도는 설정값. 기본값은 빌더가 라이브의 하루 Medusa 주문 줄 수를 재서 정하고 근거를 스펙에 남긴다. *(Claude 판단)*
  - **기본값 «미실측, 200»** (`MEDUSA_RESERVATION_RECONCILE_MAX_FIXES`, 미설정·잘못된 값은 200). 터널 없이 정했다. 나중에 재는 읽기 전용 쿼리(라이브 `medusa` DB): `SELECT date_trunc('day', o.created_at) d, count(*) FROM order_line_item oli JOIN "order" o ON o.id = oli.order_id WHERE o.created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1;` — 일 최대치의 약 2배를 한도로 한다.
- **기록과 화면 API**: 회차 기록은 새 테이블(회차당 한 행: 시각·상태 `applied|halted|skipped`·수치·예시·처리자). 
  `order_reconcile_findings` 는 «주문 하나의 불일치» 모양이라 회차 단위 기록을 억지로 넣지 않는다. *(Claude 판단)*
  `adapter/order-reconcile-findings` 옆에 목록·요약을 더해 같은 화면이 읽게 한다.
  - «확인했으니 고치기»: 저장된 계획을 실행하지 않는다 — 그새 상태가 바뀌었을 수 있으니 **그 자리에서 대사를 한도 없이 한 번 다시 돈다.**
    그 회차는 처리자와 함께 기록한다.
  - «종결»: 고치지 않고 닫는다(사유 입력).
  - 권한: 기존 화면의 «다시 배달»과 같은 `order.order.write`. 읽기는 `channel.account.read`. 새 권한 키는 만들지 않는다. *(Claude 판단)*
- **열린 «멈춘 회차»가 있는 동안 다음 날 대사는?** 그대로 돈다(그날 기준으로 다시 판정). 멈춘 기록은 사람이 닫을 때까지 열려 있다.

### 5-4. admin-web

- `/order/channel-mismatches` 에 섹션 하나: 열린 «멈춘 회차» 목록(시각·고치려던 줄 수·예시), 버튼 둘.
  최근 회차 한 줄(«어제 03:xx 고침 n 줄»)도 보여 준다 — 정상 상태는 작게(`ui-minimal-text`).
- 새 뮤테이션 훅은 `useX.permission` 선언, 화면은 `run={useX}` (CLAUDE.md admin-web 게이트). 개인정보는 다루지 않는다.

### 5-5. 판정 스크립트 · 런북 · 옛 스크립트

- `scripts/ops/cutover-preflight/` 축 0 에 더한다:
  - `--after-cutover` 인데 channel-adapter 의 T 가 비어 있음 → ✗
  - 열린 «멈춘 회차» → ✗ (`/order/channel-mismatches` 에서 처리)
  - 마지막 대사 회차가 하루보다 오래됨 → ✗
  - T 이후 주문 중 Medusa 예약 ≠ 목표인 줄 수(읽기 전용 재계산) → 0 이 아니면 ✗
- `clear-reservations.ts`: channel-adapter 의 T 가 설정돼 있으면 `--apply` 를 거부한다. T 이후 예약을 지우는 사고를 막는다. *(Claude 판단)*
- 런북(#1251)의 당일 순서에 «T 설정 스크립트» 한 줄(3번)과 «첫 저녁 대사 결과 확인»(6번)을 더한다.

## 6. 배포

- 이벤트 계약 규칙: **소비자 먼저.** SST 한 스택엔 배포 순서가 없으므로 배포를 둘로 나눈다.
  1. **Medusa 라우트 + channel-adapter(소비자·대사·기록·T 설정, T 비어 있음) + core 읽기 API·마이그(버전 열·표시 테이블)** — 이 배포에선 core 가 아직 이벤트를 내지 않는다.
     core 마이그는 additive 라 `migrate → deploy`.
  2. **core 생산자(enqueue 지점)** — 소비자가 라이브인 걸 확인한 뒤.
- 두 배포 모두 T 가 비어 있으면 동작 변화가 없다. 컷오버 전에 언제든 실을 수 있다.
- 배포 전 `npm run deploy:preflight -- --stage live`.

## 7. 빌더에게 남긴 것 / 확인할 것

- **직배(K3)·디지털 상품 줄**: core 가 예약하지 않는 줄이다. Medusa 가 그 variant 의 재고를 관리하지 않으면 Medusa 예약이 애초에 없어 문제가 없다.
  관리한다면 공식이 출고·전달 전까지 Medusa 예약을 들고 있게 된다. 기본값은 `forwarded` 를 빼는 것(전달되면 우리 재고를 떠난 것). 라이브 실측으로 확인하고 스펙에 적는다.
- **Medusa 주문 편집·Medusa 쪽 취소**: Medusa 가 자기 예약을 직접 바꾸는 경로다. 우리 설정이 그 뒤에 덮어써도 목표 공식이 core 사실 기준이라 결과는 같아야 한다.
  core 가 그 취소를 아직 모르는 사이(수집 지연)엔 Medusa 가 먼저 풀어 둔 예약을 우리가 다시 만들 수 있다 — 잠깐 이중 차감 쪽이라 반목표를 넘지 않는다. 테스트로 고정한다.
- 이벤트 스트림 선택, enqueue 모으기 방식, 적용 버전 테이블 모양, Medusa 워크플로 조합, 한도 기본값.
- #832 본문 갱신(Medusa 절반은 #1247, core 03:05 크론은 #832 에 남김).
