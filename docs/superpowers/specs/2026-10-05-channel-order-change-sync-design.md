# 수집 뒤 채널 변경을 core 판매주문에 반영한다

작성일: 2026-10-05. 조사 기준: `develop` / `61ba807ad`.
트래킹: #1016 5번 행(판단 5·6·10). 관련: #1011(결제 후 배송지 변경 — 판단 5 가 대체), #1016 6번·35번 행.

## 0. 이 문서를 읽는 법

- 구현은 PR 2개(§14)로 나뉜다. PR 마다 이 문서와 §14 의 그 PR 절을 읽고 `superpowers:writing-plans` 로 구현 계획을 쓴다
- **진행 상태는 이 문서에 적지 않는다.** #1016 의 5번 행이 들고 있다
- §3 의 결정은 사용자와 합의한 것이다. 기각한 안을 «더 간단해 보여서» 되살리지 말 것 — 기각 이유가 같이 적혀 있다
- 코드 좌표는 함수·파일 이름으로 적는다. 줄 번호는 적지 않는다

## 1. 배경 — 지금은 수집 뒤 변경이 전부 격리된다

이미 수집된 주문이 채널에서 바뀌면 channel-adapter 는 해시만 비교하고, 다르면 격리 행
(`collected_order_modification_not_accepted`)을 쓴다. core 에는 아무것도 가지 않는다. 그 사유는 replay 도 거부한다.
라이브에서 이 격리가 계속 쌓이고 있다(#1016 «라이브 실측»).

조사로 확인한 사실(2026-10-05):

| 사실 | 좌표 |
| --- | --- |
| 수집된 주문(`wms_order_mappings` 있음)의 스냅샷은 해시가 바뀌면 격리된다. 해시는 같은 트랜잭션에서 새 값으로 덮인다(같은 내용 재관측은 중복 제거) | `order-poller.orchestrator.ts` `processOrderItem`, `polling-change-hash.service.ts` `claimChanged` |
| 해시 입력은 `changes = { items(취소 라인 포함 전 라인), shippingAddress, totalAmount }`. 라인 `cancelled` 표시는 해시 밖이라 취소만으로는 바뀌지 않는다 | `channel-order.translator.ts` |
| 해시 입력에 우리 쪽 식별(`masterId`·`versionId`·`variantId`·매핑 판매상품명)이 들어 있어, PIM 쪽만 바뀌어도 «변경»으로 격리된다(6번 행의 오탐) | `channel-order.translator.ts` `buildOrderItem`, `channel-line-identity.resolver.ts` |
| channel-adapter 는 이전 스냅샷을 남기지 않는다. 비교 기준이 될 수 있는 건 core 판매주문뿐이다 | `polling_change_hashes`, `order_collection_failures.raw_order`(새 값만) |
| 계약에 `OrderModified` 가 있지만 **발행하는 곳이 없다.** core 처리기는 «무시» 로그만 남긴다. 처리기는 `payload.orderId` 를 판매주문 id 로 쓰는데, 그 값은 channel-adapter 가 만든 id 라 판매주문 id 가 아니다 | `orders.stream.ts` `OrderModifiedSchema`, `order-events.consumer.ts` `handleOrderModified` |
| 지금 `OrderModifiedSchema` 는 그대로 쓸 수 없다: 라인 `quantity` 양수 강제(수량 0 거부), `skuId` 등 `min(1)`(미식별 라인 거부), `modifiedAt` `datetime()`(네이버 `+09:00` 거부 — 2번 행과 같은 병) | `orders.stream.ts` `OrderItemSchema`·`OrderModifiedSchema` |
| 네이버 라인 취소는 lifecycle `OrderCancelled`(부분, `cancelledLines`)로 이미 core 에 간다. core 는 채널 라인 id 로 판매주문 라인을 찾아 `SalesOrdersService.cancel` 을 부른다 | `naver-order.source.ts`, `order-events.consumer.ts` `handleOrderCancelled`·`resolveSalesOrderId` |
| Medusa 는 라인 단위 취소 표시가 없다. 라인 제거·수량 감소는 스냅샷의 `quantity` 변화(또는 라인 소멸)로만 보인다 | `medusa-order.source.ts` `buildLine` |
| 두 source 모두 주문 하나를 다시 가져오는 `fetchOrder(externalOrderId)` 가 있다(지금은 replay 가 씀) | `medusa-order.source.ts`, `naver-order.source.ts`, `translating-order.provider.ts` |
| 부분취소 경로: 출고지시 전이면 백로그 수량을 줄이고, V1 은 피킹 흔적 없는 몫을 줄이고, V2 는 박스별 `cancelOutstanding` 이 초안이면 즉시, 아니면 `CANCEL_REPLAN_PENDING` 대기로 보낸다 | `sales-orders.service.ts` `cancel`·`cancelPartial`·`cancelV2Outstanding`, `shipment-planning.service.ts` `cancelOutstanding`·`requiresDurableReplan`·`withdrawalTarget` |
| 이미 취소된 수량은 `loadPriorPartialCancellationContext` 가 센다 | `sales-orders.service.ts` |
| 배송지는 세 곳에 산다: `sales_orders.shipping_address`(+해시, 생성 때만 씀), `fulfillment_orders.shipping_address`(출고지시 생성 때 복사), `shipments.recipient_snapshot`(박스 생성 때 복사). 세 곳을 함께 고치는 경로는 없다 | `sales-orders.service.ts` `createFromEvent`·`convertShippingAddress`, `fulfillments.service.ts`, #1011 |
| 박스 수령인 수정(`reviseRecipient`)은 `draft`·보관 재고/작업 없음·살아 있는 송장 없음일 때만 되고, `shipments` 만 고친다. 스냅샷 계산은 `resolveRecipientRevision` | `shipment-planning.service.ts` |
| `planned` 는 `draft` 에서 프로필·수령인 완전성·전량 예약을 확인한 뒤의 상태다. 송장은 배치 시작 때 발급된다(#986) | `shipment-planning.service.ts` `plan`·`assertRecipientComplete` |
| 송장은 발급 때의 수령인 해시를 들고 있어, 주소가 바뀌면 발송 사전검사가 `WAYBILL_STALE` 로 막는다 | `waybill.manager.ts` `assertDispatchable` |
| amendment 는 운영자 입력만 저장하는 기록이다. 적용 상태 칸도, 배송지 델타 타입도 없다. admin-web 은 이 API 를 부르지 않는다 | `sales_order_amendments`, `sales-order-amendments.service.ts`, `create-sales-order-amendment.dto.ts` |
| core 부분취소는 `SalesOrderCancelled(partial)` 을 발행하지만 channel-adapter 는 부분취소를 채널에 전파하지 않는다 | `fulfillment-events.consumer.ts` `handleCoreOrderCancelled` |
| 설치된 Medusa(2.13.4)의 `cancelOrderWorkflow` 는 결제완료분을 스스로 환불한다(`refundCapturedPaymentsWorkflow`) — Medusa 는 취소와 환불을 묶어 처리하는 엔진이다 | `@medusajs/core-flows` `cancel-order.js`, `almond-payment` `refundPayment` |

## 2. 목표와 성공 기준

1. 수집 뒤 채널에서 바뀐 주문 중 **배송지(송장 발급 전)·수량 감소·라인 제거**는 사람 손 없이 core 판매주문과 그 아래 출고에 반영된다
2. 그 밖의 변경, 그리고 단계가 막는 변경은 **무엇이 바뀌었고 왜 막혔는지** 보이는 채로 대기한다
3. 모든 변경은 amendment 한 행으로 남는다(판단 6)
4. 우리 쪽 식별만 바뀐 «변경»(6번 행의 오탐)은 아무 기록도 만들지 않는다
5. 반쯤 반영된 상태가 없다 — 판매주문은 새 주소인데 박스는 옛 주소인 상태(#1011 의 함정)가 생기지 않는다
6. `npm run type-check` 에러 0 · `npx jest` 실패 0

## 3. 결정 (사용자 결정 2026-10-05)

| # | 질문 | 결정 | 기각한 안과 이유 |
| --- | --- | --- | --- |
| R1 | 박스 쪽을 어디까지 다루나 | **지금 닿는 데까지.** 판매주문·출고지시·초안 박스(+R5)까지만 자동 반영. 그보다 앞선 단계는 `pending`. 새 대기 상태를 만들지 않는다 | S2 전체(계획·배치 박스 내용 변경, 송장 재발급·재구동 워커): 스펙·구현이 두세 배. 그 몫은 S2 뒷절반으로 남긴다(§15) |
| R2 | diff 를 누가 하나 | **channel-adapter 는 전달, core 가 판정.** 해시가 바뀌면 새 스냅샷 전체를 `OrderModified` 로 보내고, core 가 «지금 유효한 판매주문»과 비교한다 | channel-adapter 가 diff: 이전 스냅샷 저장이 새로 필요하고, core 가 이미 적용한 취소를 몰라 이중 차감을 못 막는다. 단계 판정은 어차피 core 몫이다 / 격리 화면에 «적용» 버튼: 판단 5 의 «자동»과 어긋난다 |
| R3 | 배포 겹침 | **감수한다.** 한 스택이라 순서를 못 정하고, 겹치는 동안 옛 core 가 `OrderModified` 를 버릴 수 있다. 발행 플래그를 두지 않는다 | 발행 env 플래그: 사용자 판단으로 불필요 |
| R4 | 범위 밖 변경을 어디서 보나 | **admin-web 목록 + 주문 상세의 변경 기록까지 이 스펙.** 처리완료·무시(닫기)는 6번 행 | 화면을 6번으로: 그 사이 범위 밖 변경이 사람 눈에서 사라진다(격리 행이 더 안 생기므로) / 격리 행 이중 기록: 판정이 core 에 있어 channel-adapter 가 결과를 다시 받아야 한다 |
| R5 | 배치 밖 `planned` 박스의 주소 | **자동 반영.** 판단 5 가 «송장 발급 전까지»이고 송장은 배치 시작 때 발급된다. 수령인 스냅샷만 덮으면 된다 | `planned` 전부 `pending`: 판단 5 보다 좁다 |
| R6 | 돈 | **core 는 채널 변경에 대해 돈을 움직이지 않는다.** 환불은 채널이 한다(Medusa 는 자기 환불 흐름, 결과는 지금처럼 `OrderRefundCreated` 로 기록만) | — |
| R7 | 정본(판단 10) | **채널 주문의 정본은 그 채널이다.** core 는 채널을 따라간다. 운영자의 채널 주문 취소·수정을 «채널에 먼저 요청 → 그 주문 즉시 끌어오기»로 바꾸는 일은 #1016 35번 행. 이 스펙은 그 입구(즉시 끌어오기, §9)만 만든다 | 운영자 흐름까지 이 스펙: `adminCancelRequest` 환불 방식·31번 행과 맞물려 범위가 커진다 |
| R8 | 이미 쌓인 격리 행 | **즉시 끌어오기에 `force` 를 두고 배포 뒤 아직 끝나지 않은 주문만 한 번 다시 돌린다.** 격리 행을 닫는 건 6번 행 | — |

R7 이 diff 기준(R2)의 전제다. core 가 채널 주문을 혼자 바꾸면(지금의 운영자 부분취소) 채널 스냅샷이 core 보다 커 보여
«수량 증가»로 오판된다. 35번 행이 풀리기 전까지 이미 그렇게 갈린 주문은 `OUT_OF_SCOPE` 로 `pending` 이 된다 — 틀린
반영이 아니라 사람에게 보이는 대기라 감수한다.

## 4. 흐름

```
채널 변경
  → channel-adapter 폴링(5분) 또는 즉시 끌어오기(§9)
  → 해시 비교: 같으면 끝
  → 다르면 해시 갱신 + OrderModified(전체 스냅샷) 를 같은 트랜잭션에 outbox 로     ← 격리 행을 쓰지 않는다
  → core handleOrderModified
      → 채널 키로 판매주문을 찾고 FOR UPDATE
      → 이벤트 멱등(order_events) 확인
      → diff(§6) → 실질 차이 없으면 이전 채널 pending 행만 superseded 로 바꾸고 끝(새 행 없음, §8.3)
      → 분류(§7): 델타마다 applied / pending + 막힌 사유
      → applied 델타 적용(§7)
      → amendment 한 행 기록, 같은 주문의 이전 채널 pending 행은 superseded(§8)
```

lifecycle(`OrderCancelled`·`OrderRefundCreated`)은 지금 그대로 별도 이벤트로 간다. 같은 폴링에서 둘이 함께 나오면
`OrderModified` 가 먼저 간다(정렬: order < failure < lifecycle). diff 가 취소 라인을 건너뛰므로(§6) 순서와 무관하게
이중 차감이 없다.

## 5. 계약 — `OrderModified` 를 전체 스냅샷으로

`packages/event-contracts/streams/orders.stream.ts` 의 `OrderModifiedPayload`·`OrderModifiedSchema` 를 바꾼다.
발행자가 없으므로 호환 부담이 없다.

```ts
interface OrderModifiedPayload {
  orderId: string;              // channel-adapter 의 wms_order_id (core 판매주문 id 아님 — 참고용)
  salesChannel: SalesChannel;   // 필수 — core 는 이것과 externalOrderId 로 판매주문을 찾는다
  externalOrderId: string;      // 필수
  modifiedAt: string;           // datetime({ offset: true }) — 네이버 +09:00 수용
  snapshot: {
    lines: Array<{
      channelOrderItemId: string | null;
      channelProductId: string | null;
      quantity: number;         // int, >= 0
      unitPrice: number;        // >= 0
      cancelled: boolean;
    }>;
    shippingAddress: ShippingAddress;
  };
}
```

- 라인 스키마는 **전용**이다. 기존 `OrderItemSchema` 를 쓰면 수량 0·미식별 라인이 소비 단계에서 거부된다
- 우리 쪽 식별(`masterId`·`versionId`·`variantId`·`productName`)은 싣지 않는다. diff 가 쓰지 않는다(§6)
- 공동현관 비밀번호는 싣지 않는다. core 가 그 값의 정본이고, «없음»을 «지워라»로 해석하지 않는다(처리기 주석 유지)
- `modifiedBy`·`reason`·`changes` 는 지운다

channel-adapter 의 해시 입력(`OrderFetchItem.changes`)은 **바꾸지 않는다.** 바꾸면 배포 직후 한 주기 주문이 전부 «바뀜»으로
보인다. 그래서 우리 쪽 식별 변경은 계속 `OrderModified` 를 낳지만, core diff 가 실질 차이 0 으로 버린다.

## 6. diff 규칙

기준은 **지금 유효한 판매주문**이다.

- 유효 수량 = `sales_order_lines.quantity` − 이미 취소된 수량(`loadPriorPartialCancellationContext` 와 같은 계산)
- 현재 주소 = `sales_orders.shipping_address`
- 판매주문이 `cancelled`·`timeout` 이면 diff 하지 않는다(기록 없음)

라인은 `channelOrderItemId` 로 짝짓는다.

| 스냅샷 | 판정 | 델타 |
| --- | --- | --- |
| `cancelled: true` 라인 | **건너뜀.** lifecycle 취소가 맡는다 | — |
| core 라인이 스냅샷에 없음, 또는 수량 0 | 제거 | `quantity_correction`, `correctedQuantity: 0` |
| 수량 < 유효 수량 | 감소 | `quantity_correction` |
| 수량 > 유효 수량 | 증가 → 범위 밖 | `quantity_correction`(증가) |
| core 에 없는 라인 | 추가 → 범위 밖 | `add_product` |
| `channelProductId` 다름(둘 다 있을 때) | 교체 → 범위 밖 | `replace_product` |
| `unitPrice` 다름 | 단가 변경 → 범위 밖 | `amount_correction` |
| 어느 쪽이든 `channelOrderItemId` 없음 | 짝을 못 지음 → 그 라인들 범위 밖 | 사유 `LINE_IDENTITY_MISSING` |
| 주소: 스냅샷 주소를 `convertShippingAddress` 로 바꾼 뒤 필드별 비교 — 수령인·전화·우편번호·도로명·상세·배송메모·통관부호 | 하나라도 다르면 변경 | `shipping_address_change` {before, after} |

비교하지 않는 것: 총액·할인·배송비(감소의 결과일 뿐), 우리 쪽 식별·상품명, 공동현관 비밀번호.
판매주문의 `customer_name`·`customer_phone`(생성 때 수령인에서 복사)은 주문자 칸으로 보고 고치지 않는다.

diff 는 순수 함수(`channel-order-diff.ts`)다. 입력: 유효 판매주문 뷰 + 스냅샷. 출력: 델타 목록.

## 7. 분류와 자동 반영

> **계획 단계 수정(2026-10-05):** 처음 안은 `requiresDurableReplan`·`withdrawalTarget` 술어를 공유 함수로 뽑아 순수 분류기가
> 판정하는 것이었다. 코드를 보니 «즉시 끝나는가»가 V1·V2 경로, 백로그, 박스별 `cancelOutstanding`, 이탈 판정에 흩어져 있어
> 뽑아내기가 크고 위험했다. 그래서 **같은 경로를 savepoint 안에서 실제로 시도하고, 그 자리에서 끝나지 않으면 savepoint 만
> 되돌린다.** 판정과 적용이 같은 코드라 구조적으로 갈릴 수 없다. outbox 적재도 같은 DB 트랜잭션이라 함께 되돌아간다.

판매주문 `FOR UPDATE` 아래 같은 트랜잭션에서 시도하고 적용한다. 판정과 적용 사이에 단계가 바뀌는 틈이 없다.
잠금 순서는 판매주문 → 출고지시 → 박스(취소 경로와 같다). 시도는 델타마다 savepoint 하나(`tx.transaction`)다.

> **계획 단계 수정(PR 2, 2026-10-05):** 판매주문 status 가 `shipped`·`delivered` 면 시도하지 않고 대기한다 — 배송지
> `SHIPMENT_NOT_REVISABLE`, 감소 `CANCEL_NOT_IMMEDIATE`(둘 다 `detail: 'sales order marked shipped'`). 셀메이트 과도기에
> 스크립트가 이 status 를 직접 찍어, core 출고 기록이 없어도 물건은 이미 떠났다. 그대로 시도하면 배송지는 «반영됨» 으로
> 묻히고, 감소는 V1 부분취소가 status 를 보지 않아 `awaiting_matching` 백로그를 다시 매칭 대기로 돌린다.

### 7.1 배송지

이미 발송된(`shipped`·`in_transit`·`delivered`) 박스와 끝난(`canceled`·`superseded`) 박스는 보지 않는다. savepoint 안에서:

1. 끝나지 않은(`shipped`·`completed`·`canceled` 밖) 출고지시 중 직배(`drop_ship`)이고 `direct_ship_status` 가 있는 것이 있으면
   멈춘다 → `SHIPMENT_NOT_REVISABLE`(공급처에 이미 넘어간 주소)
2. `sales_orders.shipping_address` 갱신(`shipping_address_hash` 는 건드리지 않는다 — 채널 주문은 생성 때도 null 이다)
3. 끝나지 않은 출고지시의 `shipping_address` 갱신
4. 남은 박스마다 `ShipmentPlanningService.reviseRecipientFromChannel` — 운영자용 `reviseRecipient` 와 같은 검사·같은 기록
   (`recipient_revision` 작업, 시스템 행위자, 사유 `CHANNEL_ORDER_MODIFIED`)을 하되 아래 둘이 다르다
   - `planned` 도 받는다(작업 항목이 없을 때만 — 기존 `assertNoCustodyOrActiveWork` 가 그대로 막는다). 그때 새 주소의
     완전성(`assertRecipientComplete`)을 검사한다
   - 박스가 이 판매주문 밖의 라인을 싣고 있으면 거절한다

어느 단계든 거절되면 savepoint 를 되돌리고 **이 델타 전체가 `pending`** 이다(성공 기준 5). 거절 코드는 이렇게 옮긴다:

| 거절 | 사유 |
| --- | --- |
| `SHIPMENT_ACTIVE_INVOICE` | `WAYBILL_ISSUED` |
| `SHIPMENT_ACTIVE_WORK_ITEM` · `SHIPMENT_CUSTODY_EXISTS` | `SHIPMENT_IN_BATCH` |
| `SHIPMENT_RECIPIENT_INCOMPLETE` | `RECIPIENT_INCOMPLETE` |
| `SHIPMENT_CONSOLIDATED` | `CONSOLIDATED_SHIPMENT` |
| 그 밖(`SHIPMENT_REOPEN_REQUIRED` 등 모든 예외) | `SHIPMENT_NOT_REVISABLE` |

### 7.2 수량 감소·라인 제거

감소 라인마다 savepoint 하나에서 `SalesOrdersService.cancel(soId, { lines: [그 라인], cancelledBy: 'channel',
reasonCode: 'CHANNEL_ORDER_MODIFIED', metadata: { sourceEventId: '<amendment id>:<라인 id>' } }, sp)` 를 부른다.
**`walletRefund` 를 넘기지 않는다**(R6).

- 예외가 나면 되돌리고 `CANCEL_NOT_IMMEDIATE`, 원래 메시지를 `detail` 에 담는다(이미 나간 수량·피킹 흔적 등)
- 성공했어도 그 취소 행(`sales_order_cancellations.metadata.sourceEventId` 로 찾음)의 `effects` 에 `operationStatus: 'pending'` 인
  `shipment_outstanding_cancellation` 이 있으면 되돌리고 `CANCEL_NOT_IMMEDIATE` — 박스가 `CANCEL_REPLAN_PENDING` 이나
  이탈 대기로 갔다는 뜻이다(R1: 새 대기를 만들지 않는다)
- 시도 전에 **모든 라인이 0 이 되면** 시도하지 않고 `ALL_LINES_REMOVED` — 부분취소를 전 라인에 거는 것은 전체취소와
  뜻이 다르다. 정상이면 채널이 주문 취소로 보낸다

이때 `SalesOrderCancelled(partial)` 이 나간다. channel-adapter 가 부분취소를 채널에 전파하지 않는 것(`handleCoreOrderCancelled`)이
**메아리를 막는 장치**다 — 부분취소 전파를 켤 때(35번 행) 이 경로의 이벤트는 제외해야 한다. 그 처리기 주석에 이 사실을 적는다.

### 7.3 범위 밖

증가·추가·교체·단가 변경은 분류할 것 없이 `pending`, 사유 `OUT_OF_SCOPE`(판단 5).

## 8. amendment — 단일 변경 기록

### 8.1 칸

`sales_order_amendments` 에 더한다. 기존 `decision`(approved·rejected·pending)은 운영자 «승인» 축이라 그대로 둔다.

| 칸 | 값 | 비고 |
| --- | --- | --- |
| `origin` | `channel` · `operator`, not null, 기본 `operator` | 기존 행은 `operator` |
| `status` | `applied` · `pending` · `superseded`, not null, 기본 `pending` | 운영자 행은 지금도 적용되지 않으므로 `pending` 이 사실이다 |
| `source_event_id` | varchar, unique, nullable | 채널 이벤트 messageId |
| `superseded_by_id` | uuid, 자기 참조, nullable | |

인덱스: `(status, origin, occurred_at)` — 대기 목록용.

채널 행: `created_by` null(시스템), `reason_code` `CHANNEL_ORDER_MODIFIED`, `occurred_at` = `modifiedAt`,
`amendment_kind` 는 주소 델타만 있으면 `fulfillment_only`, 아니면 `commercial`. 타임라인용 `opened_amendment` 링크는 지금처럼 쓴다.

### 8.2 델타

`deltas` jsonb 원소에 `outcome`(`applied`·`pending`)과 `blockers: { code, shipmentId? }[]`(pending 일 때)를 붙인다.
행 `status` 는 하나라도 `pending` 이면 `pending`, 아니면 `applied`.

델타 타입은 기존 것을 쓰고 `shipping_address_change` 하나를 더한다. 라인 델타에는 `channelOrderItemId` 를 싣는다
(`add_product` 는 core 라인이 없다). 채널 델타는 운영자 DTO 검증(`validateDeltas`)을 거치지 않는다 — 운영자 DTO 에 배송지 델타를 더하는 건 쓰는 곳이 생길 때 한다.

### 8.3 superseded

채널 이벤트로 새 행을 쓸 때, 같은 판매주문의 `origin = channel`·`status = pending` 행을 전부 `superseded` 로 바꾸고
`superseded_by_id` 를 새 행으로 채운다. diff 는 매번 판매주문과 새로 비교하므로 최신 행이 남은 차이를 전부 담는다.
실질 차이 0 인 이벤트(행을 안 씀)도 이전 pending 행을 superseded 로 바꾼다 — 채널이 core 와 같아졌다는 뜻이다.
이때는 대체할 행이 없으므로 `superseded_by_id` 는 null 이다.

### 8.4 막힌 사유

| 코드 | 뜻 |
| --- | --- |
| `WAYBILL_ISSUED` | 송장이 이미 있다 |
| `SHIPMENT_IN_BATCH` | 배치에 들어갔다(작업 항목·보관 재고·세션 잔량) |
| `SHIPMENT_NOT_REVISABLE` | 그 밖에 수령인을 고칠 수 없는 상태(`recovery_required` 박스, 진행 중인 직배 등) |
| `CONSOLIDATED_SHIPMENT` | 다른 주문과 같은 상자 |
| `RECIPIENT_INCOMPLETE` | 계획된 박스에 불완전한 새 주소 |
| `CANCEL_NOT_IMMEDIATE` | 취소가 그 자리에서 끝나지 않는다(예외 또는 대기 결과, 원인은 `detail`) |
| `ALL_LINES_REMOVED` | 전 라인이 0 |
| `LINE_IDENTITY_MISSING` | 채널 라인 id 가 없어 짝을 못 지음 |
| `OUT_OF_SCOPE` | 증가·추가·교체·단가(판단 5) |

### 8.5 Medusa OrderChange 와의 관계

역할은 닮았다(변경 한 건 = 한 행, 안에 동작 목록, 상태 축). 다른 점 둘:

- Medusa 는 OrderChange 를 **확정해야** 주문이 바뀐다(`order.version` 증가). 여기서는 기존 경로가 판매주문을 고치고
  amendment 는 그 옆의 기록이다. 판매주문 버전은 두지 않는다
- 채널 행의 `pending` 은 «제안»이 아니라 «채널에선 이미 바뀌었는데 core 가 못 따라간 사실»이다. 거절이 성립하지 않는다.
  6번 행의 «무시»는 «알고도 어긋난 채 둔다»는 뜻이다

## 9. 즉시 끌어오기와 백필

### 9.1 입구

channel-adapter 에 `POST /adapter/orders/:channel/:externalOrderId/sync` 를 둔다. 내부 키 인증(기존 내부 API 인증 방식을 따른다).

- 그 channel 의 source `fetchOrder(externalOrderId)` → translator → 폴링과 **같은** 주문 처리(`processOrderItem` + lifecycle)를 탄다.
  별도 경로를 만들지 않는다
- 지원: `medusa`·`naver`. 그 밖은 400
- 응답: `{ outcome: 'unchanged' | 'emitted' | 'created' | 'not_found' }`
- `force: true`(본문) — 해시가 같아도 `OrderModified` 를 발행한다. 해시는 그대로 갱신한다. 백필 전용
- 같은 주문을 폴러가 동시에 처리해도 `claimChanged` 가 한쪽만 이기게 한다(지금 구조). `force` 는 이긴 쪽이 아니어도 발행하므로
  같은 스냅샷이 두 번 갈 수 있다 — core 는 두 번째를 실질 차이 0 으로 버린다

> **계획 단계 수정(PR 2, 2026-10-05):** 응답 `outcome` 에 셋을 더했다 — `not_eligible`(수집 대상이 아닌 미수집 주문),
> `identification_failed`(번역이 식별 실패를 냄 — 폴링과 같이 미수집이면 격리, 수집됐으면 열린 격리를 닫는다),
> 그리고 비활성 채널은 409(폴링의 킬스위치와 같은 뜻). 주문을 먼저, 그 주문의 lifecycle 을 이어서 처리한다.

이 스펙에서 이 입구의 호출자는 백필뿐이다. 운영자 취소·수정의 호출자는 35번 행이 만든다.

### 9.2 백필(R8)

배포 뒤 한 번. `order_collection_failures` 에서 `reason = collected_order_modification_not_accepted`·`status = quarantined` 인 행 중,
core 판매주문이 끝나지 않은(취소·출고 완료가 아닌) 주문만 `force: true` 로 돌린다. 스크립트는 `scripts/ops/` 아래 둔다.

- 대상 수를 먼저 세고(읽기 전용), 실행은 사람이 한다
- 실제 주소 변경은 반영되고, 오탐은 기록 없이 사라진다
- 격리 행은 닫지 않는다(6번 행)

> **계획 단계 수정(PR 2, 2026-10-05):** «끝나지 않은» = 판매주문 status 가 `cancelled`·`timeout`·`shipped`·`delivered` 가
> 아닌 것. core diff 는 `shipped`·`delivered` 를 건너뛰지 않으므로 스크립트가 거른다. 판매주문이 없는 격리도 뺀다(보내면
> NotFound → DLQ). 스크립트는 `sst shell` 안에서 channel_adapter·core 를 읽기 전용으로 읽고, 쓰기는 입구가 한다.
> 스크립트: `scripts/ops/1016-backfill-channel-order-modifications.ts`.

지금 출고는 셀메이트가 하므로(#923) core 박스 주소를 고쳐도 실제 발송에는 영향이 없다. core 출고가 돌기 시작하는 컷오버 전에
core 판매주문의 주소를 맞춰 두는 의미다.

## 10. 화면 (admin-web)

- core API: `GET /sales-order-amendments?status=&origin=&cursor=` (목록, 최신순). 기존 `GET /sales-orders/:id/amendments` 응답에
  새 칸을 싣는다
- **«반영 대기 변경» 목록**: 주문번호·채널·변경 시각·델타 한 줄 요약·막힌 사유. 행을 누르면 주문 상세. 기본 필터 `status = pending`. **판매주문이 `cancelled`·`timeout` 인 행은 목록에서 뺀다** — Medusa 취소 직전 스냅샷이 남긴 pending 이 끝난 주문에 남는다
- **주문 상세의 변경 기록**: amendment 마다 델타별 결과(반영됨·대기 + 사유)
- 문구는 최소로. 요약·사유 문구는 `.ts` 순수 함수(admin-web 은 컴포넌트 테스트를 못 한다)
- 기존 «수집 후 변경(재처리 불가)» 격리 행 표시는 그대로 둔다

## 11. 오류·멱등·동시성

- 이벤트 멱등: `checkAndRecordEvent`(messageId) + `source_event_id` unique
- 판매주문을 못 찾으면 `NotFoundException`(비재시도 → DLQ). 지금 `OrderCancelled` 와 같은 규칙
- 예상 밖 오류는 트랜잭션 전체를 되돌리고 재시도 → DLQ. DLQ 재처리는 8번 행의 몫
- 판정·적용이 같은 잠금 아래라, 적용 단계의 도메인 거절(`SHIPMENT_NOT_DRAFT` 등)은 버그다 — 잡아서 `pending` 으로 바꾸지 않는다
- 운영자 수령인 수정·부분취소와의 경합은 판매주문·박스 잠금이 직렬화한다

## 12. 변경 지점

| 곳 | 변경 |
| --- | --- |
| `packages/event-contracts/streams/orders.stream.ts` | §5 |
| `apps/channel-adapter/.../order-poller.orchestrator.ts` | 수집된 주문의 해시 변경 시 격리 대신 `OrderModified` enqueue. `force` 인자 |
| `apps/channel-adapter/.../channel-order.translator.ts` | `OrderModified` 스냅샷 조립(취소 라인 포함, `cancelled` 표시) |
| `apps/channel-adapter/src/controllers/` | §9.1 입구 |
| `apps/channel-adapter/CLAUDE.md` §3-5 | 정책 문장 갱신(격리 → 전달) |
| `apps/core/src/modules/inventory/schema/inventory.schema.ts` + 마이그레이션 | §8.1 |
| `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` | `handleOrderModified` → 서비스 호출, 채널 키로 판매주문 해석 |
| `apps/core/src/modules/sales-order/channel-order-change/`(신규) | `channel-order-diff.ts`(순수), 거절 코드 변환(순수), `ChannelOrderChangeReader`, `ChannelOrderChangeManager`, 서비스 |
| `apps/core/src/modules/sales-order/services/sales-order-amendments.service.ts`·DTO | 새 칸, 새 델타 타입, 목록 조회 |
| `apps/core/src/modules/fulfillment/services/shipment-planning.service.ts` | `reviseRecipientFromChannel` 추가(§7.1) |
| `apps/channel-adapter/src/consumers/fulfillment-events.consumer.ts` | `handleCoreOrderCancelled` 주석에 메아리 방지 사실 추가(§7.2) |
| `apps/admin-web` | §10 |
| `scripts/ops/` | §9.2 백필 |
| `docs/adr/0016-post-acceptance-order-lifecycle-boundaries.md` | «수집된 변경은 격리» 문장을 이 스펙으로 갱신 |

## 13. 테스트

- **diff 순수 함수**(표 테스트): 네이버 취소 라인 건너뜀 · Medusa 수량 0 과 라인 소멸이 같은 결과 · 감소·증가·추가 · `channelProductId`
  교체 · 단가 · 라인 id 없음 · 주소 필드별 · 우리 쪽 식별만 바뀜 → 델타 0 · 취소된 판매주문 → 델타 0
- **거절 코드 변환 순수 함수**: §7.1 표의 각 행
- **`reviseRecipientFromChannel` 통합**: draft·배치 밖 planned 통과, 송장·작업 항목·합포장·불완전 주소 거절
- **core 통합**(`describeIfDb`):
  - 주소가 판매주문·출고지시·초안 박스·배치 밖 계획 박스에 한 번에 반영되고 manifestVersion 이 오른다
  - 송장 있는 박스 하나 때문에 막히면 세 곳 모두 그대로
  - 초안 감소는 즉시 반영(예약 해제 포함), `planned` 감소는 `pending`·박스 무변경
  - 같은 이벤트 재전송 → 행 하나 · 연속 이벤트 → 이전 pending 이 superseded · 실질 차이 0 이벤트도 superseded 만 남김
  - 네이버 `OrderModified` 와 `OrderCancelled(partial)` 가 어느 순서로 와도 감소는 한 번
- **channel-adapter**: 해시가 바뀌면 격리 행 없이 `OrderModified` 하나 · 같은 해시는 없음 · `force` 는 같은 해시에도 발행 ·
  계약 스키마가 `+09:00`·수량 0·미식별 라인을 받음
- **admin-web**: 요약·사유 문구 순수 함수

## 14. PR 분할

### PR 1 — 반영과 대기 목록

- **범위:** §5~§8, §10, §11, §12(즉시 끌어오기·백필 제외)
- **끝나면 성립:** 성공 기준 1~6
- **배포:** 마이그레이션은 추가뿐 → `migrate → deploy`. 배포 전 라이브 `sales_order_amendments` 행 수를 센다(0 기대 — admin-web
  이 API 를 부르지 않는다). 겹치는 동안의 유실은 감수(R3)
- 화면과 채널 쪽 전환은 **같은 PR** 이다. 나눠 배포하면 그 사이 범위 밖 변경이 어디에도 안 보인다

### PR 2 — 즉시 끌어오기와 백필

- **범위:** §9
- **배포 뒤:** 백필 대상 수 확인 → 사람이 실행

## 15. 범위 밖과 알고 남기는 틈

- **계획·배치 박스의 내용 변경, 송장 재발급·재구동 워커(S2 뒷절반):** 그 단계의 변경은 `pending` 으로 남는다. S1 스펙 §7.3,
  #986 스펙 §16 이 넘긴 몫
- **pending 닫기(처리완료·무시):** 6번 행. 기존 격리 행 닫기도 6번 행
- **운영자 채널 주문 취소·수정을 채널 먼저로:** 35번 행. 그때까지 core 가 혼자 바꾼 주문은 이후 채널 변경이 `OUT_OF_SCOPE` 로 대기한다(§3)
- **고객 스토어프론트 배송지 변경:** #1011 미결. 열면 Medusa 주문만 바꾸면 되고 core 반영은 이 경로를 탄다
- **식별 실패로 건너뛰는 수집된 주문:** `channel_product_identification_failed` 가 걸린 수집된 주문은 해시 비교 전에 건너뛴다(지금 동작).
  그 주문의 변경은 이 경로에 안 들어온다
- **네이버 취소 요청 진행 중(`CANCEL_REQUEST` 등):** 해시 밖이라 core 가 출고를 멈추라는 신호를 못 받는다(지금 동작)
- **공동현관 비밀번호 변경:** 이벤트에 없다. 운영자 경로로만 고친다
- **Medusa 라인 제거의 실제 모양:** 수량 0 으로 남는지 라인이 사라지는지 실측하지 않았다. diff 는 둘을 같게 다루므로 결과는 같다.
  PR 1 통합 테스트 픽스처를 만들 때 dev Medusa 에서 한 번 확인한다
- **셀메이트 출고 뒤 표시 전의 변경:** 셀메이트가 실제로 출고한 뒤 일일 표시 스크립트(`mark-shipped-from-csv.ts`)가 돌기 전에 온 변경은
  판매주문이 아직 `pending` 이라 그대로 반영된다(셀메이트 과도기 한정, 컷오버하면 사라진다)
