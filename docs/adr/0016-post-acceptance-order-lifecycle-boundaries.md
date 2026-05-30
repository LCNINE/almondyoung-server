# Payment Accepted 이후 주문 lifecycle 은 계약 스냅샷과 후속 사건으로 분리한다

Payment Accepted 된 채널주문을 Core 가 수집하면 Core 판매주문은 Medusa order 의 live projection 이 아니라 독립 처리 계약이 된다. 원 `sales_order_lines` 는 수락 당시 계약 스냅샷으로 보존하고, 이후 상품 추가/대체/수량 보정은 주문정정(SalesOrderAmendment), 취소는 주문취소(OrderCancellation), 환불은 Wallet 환불, 출고 변경은 출고 조정/반품 workflow 로 각각 다룬다.

## Decision

- Core 판매주문과 채널주문은 다른 정체성이다. Medusa order id 는 Core `sales_orders.id` 가 아니라 `(salesChannel, channelOrderId)` 로 참조되는 채널주문 ID 다.
- 수락된 판매주문 line 은 직접 PATCH/DELETE 하지 않는다. 원 line 은 계약 스냅샷이고, 사후 변경은 별도 사건과 delta 로 기록한다.
- 주문정정은 주문취소의 하위 타입이 아니고, 주문취소는 모든 line 을 제거하는 주문정정으로 환원하지 않는다.
- CS Case, 주문정정, 주문취소, Wallet 결제/환불, 출고주문/반품은 서로를 소유하지 않는다. 관리자가 한 주문의 전체 파급효과를 조회할 수 있도록 업무 연결(Business Link)로 묶는다.
- 출고 조정은 아직 출고되지 않은 수량에만 적용한다. 이미 출고된 수량은 출고주문에서 제거하지 않고 반품/회수/환불/보상 정책으로 처리한다.
- channel-adapter 가 이미 수집한 Medusa 주문의 상품/금액 변경은 계속 `collected_order_modification_not_accepted` 로 격리한다. 다만 취소/환불은 별도 lifecycle event 로 수집할 수 있다.

## Why this shape

Medusa 는 OrderChange 를 주문에 누적하는 방식으로 사후 변경을 표현하지만, Core 는 출고, 디지털 권리 부여, 결제, CS 기록을 서로 다른 bounded context 로 가진다. 판매주문 line 을 직접 수정하거나 주문취소를 line 제거로 표현하면 "고객이 무엇을 결제했고, 무엇이 출고됐고, 나중에 무엇이 보정됐는지"가 한 row 에 섞인다. 반대로 모든 후속 사건을 주문정정의 하위 엔티티로 넣으면 Wallet/CS/Fulfillment 의 SoT 경계가 깨진다.

따라서 Core 는 원 계약을 보존하고, 후속 변화는 독립 사건으로 기록한 뒤 명시적인 업무 연결로 추적한다.

## Consequences

- 기존 `OrderModified` 소비/적용 경로와 admin 의 판매주문 line 직접 수정 TODO 는 재검토 대상이다.
- 부분 취소 구현은 주문취소 범위, Wallet 환불, 출고 조정/예약 해제, Business Link 를 함께 다뤄야 한다.
- Medusa 사후 주문 변경 수집은 상품/금액 변경과 취소/환불 lifecycle 을 분리해야 한다.
- 관리자 화면은 판매주문 자체만 보여주는 것이 아니라 CS/정정/취소/환불/출고/반품 연결 timeline 을 보여줘야 한다.
