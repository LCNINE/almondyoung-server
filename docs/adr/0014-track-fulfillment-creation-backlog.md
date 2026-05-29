# 출고주문 생성 대기는 명시적인 backlog 로 추적한다

Payment Accepted 된 채널 주문은 Core 에서 판매주문을 만든 뒤 출고주문 생성까지 자동으로 시도한다. 이 시도가 판매상품↔재고상품 매칭 누락으로 실패하면, 실패를 로그나 `sales_order_lines.productMatchingId IS NULL` 조회 규칙에만 맡기지 않고 `salesOrderId`, 실패 사유, 누락 variant 를 담은 durable backlog 로 남긴다. `OrderCreated` consumer 는 판매주문과 backlog 기록을 먼저 commit 하고, 별도 worker 가 backlog 를 처리해 출고주문 생성/예약을 수행한다. 매칭이 등록되면 Core 는 해당 variant 를 기다리던 backlog 항목만 찾아 출고주문 생성을 다시 시도한다.

## Consequences

- 판매주문 생성은 출고주문 생성 실패와 분리되어야 한다. 매칭 누락 때문에 유료 주문의 판매주문 기록까지 롤백하면 안 된다.
- `OrderCreated` 이벤트 처리는 유료 주문 수용을 책임지고, 출고주문 생성 worker 는 downstream 전환을 책임진다. worker 실패가 Kafka 주문 수집/판매주문 생성의 성공을 되돌리면 안 된다.
- 출고주문 생성 재시도는 멱등적이어야 한다. 이미 출고주문이 존재하는 판매주문은 중복 생성하지 않는다.
- 매칭 누락은 출고주문 생성 단계의 실패/대기이고, 재고 부족은 ADR-0012 처럼 생성된 출고주문의 reservation 실패/대기로 표현한다.
- `not_required` 같은 완료 상태는 "SKU 링크를 못 찾음" 에서 파생하면 안 된다. 판매상품의 상품매칭 전략이 명시적으로 재고상품 비매칭(`strategy='void'`)일 때만 물리 출고 불필요로 닫는다. `ignored` 는 상품매칭 결정이 아니므로 `pending` 과 같은 미해결로 읽고, 상품매칭 전략이 없거나 미해결이면 backlog 에 매칭 누락으로 남긴다.
- 운영 화면은 "매칭이 없어 출고주문 생성 대기 중인 주문"을 backlog 기준으로 보여줄 수 있어야 한다.

## Rejected Alternative

- `sales_order_lines.productMatchingId IS NULL` 인 오래된 판매주문을 매칭 등록 때마다 조회한다. 구현은 단순하지만, 실패 시도 이력과 누락 variant 목록이 명시적으로 남지 않고 오래된 주문/부분 매칭/중복 재시도 경계가 흐려진다.
