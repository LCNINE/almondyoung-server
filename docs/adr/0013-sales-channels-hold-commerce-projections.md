# 판매채널은 commerce SoT 의 projection 을 보유한다

Core 와 관련 백엔드는 상품, 가격, 재고, 주문 처리의 source of truth 를 나누어 가진다. Medusa, Naver, Coupang 같은 판매채널은 이 내부 모델을 직접 공유하지 않고, channel-adapter 가 전달한 projection 만 보유한다. 주문도 판매채널이 Core API 로 직접 생성하지 않고 channel-adapter 가 Payment Accepted 주문을 수집해 Core 판매주문 이벤트로 번역한다.

## Consequences

- Medusa 는 자사몰이지만 Core 관점에서는 외부 판매채널이다.
- Medusa checkout 은 Core availability/WMS API 를 직접 호출하지 않고, Medusa inventory module 에 반영된 Product Sellable Quantity projection 으로 판단한다.
- Core → Medusa 상품/가격/판매가능수량 반영과 Medusa → Core 주문 수집은 channel-adapter 의 책임이다.
- 인증, 멤버십, 결제처럼 판매채널 운영에 필요한 별도 bounded context 호출은 예외가 될 수 있지만, commerce SoT 판단을 위해 Core 를 직접 호출하는 경로는 지양한다.
