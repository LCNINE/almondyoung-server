# 판매채널은 공통 판매가능수량 projection 을 공유한다

판매채널에는 Core 의 SKU 재고 그래프를 복제하지 않고, Core 가 계산한 판매상품 variant 별 Product Sellable Quantity projection 만 전달한다. 이 projection 은 채널별로 할당하지 않고 모든 판매채널이 같은 수량을 공유한다. 레거시의 채널별 재고 배분은 재고가 남아 있어도 각 채널의 할당량이 부족해 판매가 막히는 문제가 있었으므로, race condition 에 의한 일부 초과판매 위험을 감수하고 공통 수량 모델로 시작한다.

## Consequences

- Medusa inventory quantity 는 Core SKU 수량이 아니라 Medusa variant 에 대응하는 Core 판매상품의 판매가능수량이다.
- Medusa 의 bundled product / variant-inventory M:M 기능으로 Core 의 판매상품↔재고상품 매칭을 복제하지 않는다.
- 채널별 버퍼, 우선순위, 예약, 배분 정책이 필요해지면 Core 의 Product Sellable Quantity projection 생성 정책에서 다룬다. channel-adapter 는 SKU 매칭이나 세트 재고 계산을 재구현하지 않는다.
- 여러 채널에서 동시에 판매되어 실제 출고 가능 수량을 초과하는 주문이 생길 수 있다. 이 경우 Core 판매주문은 존재할 수 있지만 출고주문 생성 또는 재고 예약 단계에서 대기/실패할 수 있다.
