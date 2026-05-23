# 디지털 fulfillment 와 fulfillment_orders 의 책임 경계

> **Update (ADR-0010)**: 본 ADR 의 "Grant 시점은 SO confirmed (결제 완료)" / "OrderConfirmed Kafka 이벤트 핸들러" 표현은 ADR-0010 으로 명확화됨. Grant 트리거는 `OrderCreated` 이벤트 도착 + `payload.status === 'confirmed'` 가드이며, 별도 `OrderConfirmed` Kafka 이벤트는 폐기. 본 ADR 의 본질적 결정(디지털은 fulfillment_orders 를 거치지 않음, 같은 tx 에서 부분실패 방지)은 그대로 유지.

Core 에 라이브러리(Library) 모듈을 도입하면서 "디지털 상품의 fulfillment 를 어떻게 추적할 것인가" 가 분기점이 된다. WMS 의 `fulfillment_orders` 는 SKU 의 출고 흐름(picking / inspection / labelling / shipping)을 추적하는 테이블이고, 컬럼·인덱스·상태 머신이 모두 물리적 재고 출고에 묶여 있다. 디지털 상품에는 출고 개념이 없고, "재고주문" 단계 자체가 존재하지 않는다. 이 ADR 은 디지털 fulfillment 가 별도 트랙으로 진행됨을 못 박는다.

## Decision

- **디지털 fulfillment 는 `fulfillment_orders` 를 거치지 않는다.** 라이브러리 모듈의 `digitalAssetOwnerships` row 가 디지털 fulfillment 의 추적 단위이며, `fulfillment_orders` 와는 평행한 별도 트랙.
- **Grant 시점은 SO confirmed (결제 완료).** `OrderConfirmed` Kafka 이벤트 핸들러(`apps/core/src/modules/sales-order/consumers/order-events.consumer.ts`)의 같은 트랜잭션 안에서 `LibraryService.grantOwnershipsForOrder(salesOrderId, tx)` 를 호출한다. 운영자 액션을 기다리지 않는다.
- **`grantOwnershipsForOrder` 의 본체**: SO 의 각 line item 의 variant 를 조회 → `productVariantDigitalAssetLinks` 정션을 따라 매칭된 모든 asset 조회 → asset 별로 `digitalAssetOwnerships` row 작성 (`grantedAt = now()`, `exercisedAt = null`, `revokedAt = null`). variant 에 asset 매칭이 없으면 no-op.
- **WMS 트랙과의 관계**: 한 SO line item 의 variant 가 `productMatchings` (SKU 매칭) 와 `productVariantDigitalAssetLinks` (asset 매칭) 를 동시에 가지면, OrderConfirmed 가 도착했을 때 같은 트랜잭션에서 (가) library ownership 작성 + (나) SO confirmed 처리가 일어나고, 이후 운영자/시스템이 fulfillment_order 를 별도로 생성한다. 두 트랙은 비동기적으로 독립 진행.
- **취소/환불 시 회수**: `OrderCancelled` 핸들러가 SO 의 ownership 들을 조회 → `exercisedAt IS NULL` 인 것만 `revokedAt = now()` 세팅. exercise 된 것은 회수하지 않으며, 결제 측이 환불 가부를 결정.

## Why this shape

검토한 대안과 채택 이유:

- **(α) `fulfillment_orders` 에 `type: 'physical' | 'digital'` 컬럼을 추가해 같은 테이블 공유**: 한 번에 풀필먼트 상태를 조회하기 좋다는 매력이 있지만, `fulfillment_orders` 의 컬럼들 (`warehouseId`, `pickingStartedAt`, `inspectionStatus`, `trackingNumber`, `shippedAt` …) 이 디지털 row 에서 모두 NULL 이 되어 의미가 무너진다. 상태 머신도 두 갈래로 갈라져 한 테이블이 두 도메인을 어색하게 같이 표현하게 된다. 기각.
- **(β) 별 fulfillment 추상 타입을 만들고 SKU/asset 둘 다 그 위에 구현**: 도메인적으로 매력적이지만 큰 추상화이고, 지금 시점의 요구사항을 넘는다. 두 트랙이 실제로 같은 라이프사이클을 공유하지 않는다 (디지털은 picking/inspection/shipping 이 없고, 물리는 exercise/revoke 가 없다). 미래에 더 많은 fulfillment 종류가 추가되면 재평가, 지금은 과함.
- **(γ, 채택) 평행한 별도 트랙**: 두 트랙이 진짜로 다른 모델임을 코드에 그대로 반영. CONTEXT.md 의 "라이브러리는 fulfillment 의 한 종류이지 새 상품 종류가 아니다" framing 과 정합. 한 SO 가 두 트랙을 동시에 trigger 할 수 있는 케이스 (장치 + 사용법 강의) 도 자연 표현.

Grant 를 FO 생성 시점 (운영자 액션) 이 아니라 SO confirmed 시점에 두는 이유: 디지털은 "재고가 없는 fulfillment" 이므로 운영자가 디지털용 FO 를 만드는 행위 자체가 의미가 없다. 결제 = 소유라는 디지털의 본성과 정합. 실물 동반 시에도 디지털은 즉시 grant, 실물은 별도 FO 흐름으로 자연 분리된다.

## Consequences

- `apps/core/src/modules/library` 신설. `apps/core/src/modules/library/services/library.service.ts` 에 `grantOwnershipsForOrder(salesOrderId, tx?)`, `revokeOwnershipsForOrder(salesOrderId, tx?)` 두 public method.
- `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` 의 `OrderConfirmed` / `OrderCancelled` 핸들러에 LibraryService 호출 추가. 같은 `inTx` 안에서 처리하여 부분 실패 방지.
- 운영 화면 ("이 주문이 어떻게 fulfill 되고 있나") 은 두 트랙을 union 으로 보여줘야 함 — admin 의 주문 상세에서 fulfillment_orders 와 ownerships 를 함께 표시.
- "디지털 풀필먼트 SLA" 같은 지표는 fulfillment_orders 에 묻혀있지 않음. 별도로 ownerships 의 grantedAt 분포로 본다.
- 한국 전자상거래법상 "재화 등이 공급된 시점" 은 디지털의 경우 `grantedAt` 으로 해석한다 (다운로드가 아니라 라이브러리에 도달한 시점). 분쟁 시 그 기준 사용.
