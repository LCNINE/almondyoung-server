# Library ownership grant 트리거는 OrderCreated(payment-confirmed) — OrderConfirmed Kafka 이벤트 폐기

ADR-0006 과 ADR-0008 은 "SO confirmed (결제 완료) 시점에 grant" 를 결정했다. 본 ADR 은 그 *시점* 의 매커니즘을 명확화한다. 코드 추적 결과, "SO confirmed" 라는 표현이 두 가지 다른 의미로 쓰이고 있었고, 그 모호함이 grant 경로 자체가 동작하지 않는 버그로 이어졌다.

## 발견된 용어 충돌

`confirmed` 라는 단어가 코드 전반에서 두 가지 다른 사건을 가리키고 있었다:

| | 의미 | 발생 시점 | 행위 주체 |
|---|---|---|---|
| **결제 확정** | "이 주문은 돈을 받은 주문이다" | 채널 어댑터가 주문을 우리에게 넘기는 순간 (채널은 PAYED 만 polling) | 채널 시스템 (Naver/Coupang/Medusa) |
| **출고 확정** | "이 SO 를 창고에 보내 처리한다" | `POST /sales-orders/:id/confirm` 호출 시점 | 운영자 (admin) |

증거:
- `SalesOrdersService.confirm(id, warehouseId?)` 는 `warehouseId` 인자를 받아 `createSnapshotForVariant` 를 호출 — *창고 배정* 행위.
- `apps/admin-web/.../sales-orders.client.ts` 의 `POST /sales-orders/:id/confirm` 은 어드민 운영자 액션으로 호출됨.
- 대시보드 쿼리(`sales-orders.service.ts:557`)는 `pending` + `productMatchingId IS NULL` 을 "매칭 대기" 카드로 표시 — 즉 `pending` 은 "결제 안 됨" 이 아니라 "운영자가 아직 손대지 않은 SO".
- 채널 어댑터의 모든 publish 경로(`OrderEventPublisher.publishOrderConfirmed`, `MedusaOrderProvider.fetchOrders`)는 SO 생성 시점에 이미 `payload.status: 'confirmed'` 를 박아 보냄.

ADR-0006/0008 의 "SO confirmed (결제 완료) 시점" 문장은 두 개념을 한 단어로 묶어 적혔다. 그러나 코드의 현실은:
- 채널 어댑터의 `publishOrderConfirmed` 가 Kafka 에 enqueue 하는 `eventType` 은 **`OrderCreated`** (payload.status='confirmed' 동봉, `apps/channel-adapter/src/services/order-event.publisher.ts:168`).
- core 의 `handleOrderConfirmed` 핸들러는 별개의 `eventType: 'OrderConfirmed'` Kafka 이벤트를 기다리고 있었음 (`apps/core/src/modules/sales-order/consumers/order-events.consumer.ts:113`).
- 어떤 publisher 도 `eventType: 'OrderConfirmed'` 를 발행한 적 없음 — grep 으로 확인.

결과: `handleOrderConfirmed` 는 dead code. `grantOwnershipsForOrder` 는 일반 결제 경로에서 절대 호출되지 않음. 디지털 상품을 결제해도 library ownership 이 생성되지 않음.

## Decision

- **Grant 트리거는 `OrderCreated` 이벤트 도착 + `payload.status === 'confirmed'` 가드.** `handleOrderCreated` 가 `createFromEvent` 직후 같은 트랜잭션에서 `LibraryService.grantOwnershipsForOrder(salesOrderId, tx)` 를 호출. ADR-0006 의 "같은 트랜잭션, 부분실패 방지" 원칙은 그대로 유지.
- **`OrderConfirmed` Kafka 이벤트는 도메인에서 폐기**:
  - `packages/event-contracts/streams/orders.stream.ts` 의 `OrderConfirmedPayload` / `OrderConfirmedSchema` / `ORDER_STREAM.events.OrderConfirmed` 삭제.
  - `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts` 의 `handleOrderConfirmed` 메서드 + `OrderConfirmedPayload` import 삭제.
  - `apps/core/src/modules/sales-order/services/sales-orders.service.ts:209-218` 의 `outbox.enqueue(ORDER_EVENTS.CONFIRMED, ...)` 호출 삭제 — 어차피 `OutboxDispatcherService` 의 `'Stock'` / `fulfillmentPublisher` 분기 어디에도 매칭 안 돼 발행 실패할 운명이었음.
  - `apps/core/src/modules/sales-order/common/events.ts` 의 `CONFIRMED` 상수 제거.
- **SO 의 `pending → confirmed` 상태 전이는 WMS 출고 워크플로우 그대로 유지.** 운영자가 `POST /sales-orders/:id/confirm` 으로 호출하는 path 는 library 와 무관 — 결제 확정과 별도 사건.
- **멱등성: existing SO path 도 grant 시도.** `findByChannelOrderId` 가 existing 을 찾으면 SO 생성/`orderEvents` insert 는 skip 하되, grant 시도는 동일하게 실행. 이유:
  - `grantOwnershipsForOrder` 는 `(customerId, assetId, salesOrderId)` unique index 로 idempotent — 한 번의 grant 시도 비용은 query 두어 번.
  - "현재 prod 에 grant 누락 SO 가 0건" 은 *지금 시점 DB 상태* 일 뿐, *코드가 보장하는 invariant* 가 아님. 배포 윈도우 안의 Kafka redelivery race(구 코드 처리 → 새 코드 재처리), 미래의 외부 데이터 import, 운영자 수동 개입 등으로 "SO 는 있는데 grant 가 없는" 시나리오는 막혀있지 않음. 자가치유 effect 가 cheap 한 보호.
  - 본 fix 의 원인이 wiring 버그였다 — 같은 종류의 재발 / drift 에 대비해 핸들러 자체가 self-healing 인 편이 합당.

```typescript
const salesOrder = existing ?? (await this.salesOrdersService.createFromEvent(payload, tx));

if (!existing) {
  await tx.insert(wmsTables.orderEvents).values({ ... });
}

// ADR-0010: 채널이 payment-confirmed 주문만 넘기는 것이 현재 invariant 지만,
// grant 는 fail-closed 로 명시 가드 (미래의 미결제 채널 도입 대비).
const isPaymentConfirmed = payload.status === 'confirmed';
if (isPaymentConfirmed) {
  await this.libraryService.grantOwnershipsForOrder(salesOrder.id, tx);
}
```

## Why this shape

검토한 대안과 채택 이유:

- **(α) ADR-0006/0008 in-place 수정으로 끝**: ADR retcon. 결정의 history 가 사라져 미래 독자가 "왜 이렇게 됐지" 를 추적 불가. 발견 자체(용어 충돌이 prod 버그로 이어졌다는 사실)도 흔적이 안 남음. 기각.
- **(β) `OrderPaymentCompleted` 이벤트를 실제 publish 하도록 구현**: contract 의 `OrderPaymentCompleted` 항목이 이미 정의돼 있고, "OrderCreated → OrderPaymentCompleted" 의 두 이벤트로 분리하면 의미 분리는 명확. 그러나 채널 어댑터의 본성상 두 이벤트가 항상 0 초 차이로 항상 묶여 발행됨 — 두 outbox row 비용을 치를 *의미 있는* 분리가 아님. 미래에 BNPL/가상계좌처럼 결제 시점이 SO 생성과 분리되는 채널이 도입되면 그때 부활시킬 가치 있음. 기각 (지금은).
- **(γ, 채택) `OrderCreated` 단일 이벤트 + payload.status 가드**: 현재 채널들의 본성 — "PAYED 만 polling, 결제완료된 주문만 우리에게 넘김" — 을 그대로 모델에 반영. 별도 Kafka 이벤트의 비용 없이 의도 표현. payload.status 가드가 미래의 미결제 채널 도입 시 "이 채널의 OrderCreated 는 결제완료가 아님" 을 컨슈머 쪽에서도 명시적으로 표현 가능하게 함 (즉 결제완료 invariant 를 채널 어댑터 한 곳에만 의존 안 함).

`payload.status` 가드를 두는 이유 (가드 없이 무조건 grant 와의 비교):
- 도메인 결정 "미결제 SO 를 만들지 않는다" 가 명시적으로 확정된 적 없음. 미래에 BNPL/가상계좌처럼 미결제 SO 가 생기는 시나리오를 봉쇄 안 함.
- grant 는 금전/권리 부여 — fail-closed 원칙. `confirmed` 가 아닐 때 grant 하지 않는 쪽이 안전.

## Consequences

- ADR-0006 의 "Grant 시점은 SO confirmed (결제 완료)" 문장 / Consequences 의 "OrderConfirmed 핸들러" 참조는 본 ADR 로 의미가 명확화됨. 0006 자체는 *grant 가 fulfillment_orders 와 무관하다* 는 본질적 결정을 담은 ADR 이라 supersede 하지 않음 — Update 노트만 추가.
- ADR-0008 의 "0 원 결제도 같은 OrderConfirmed → SO confirmed → grantOwnershipsForOrder 흐름" 문장도 같음 — 본질("grant 단일 경로 = 결제") 은 유지, 매커니즘 표현만 본 ADR 로 갱신.
- CONTEXT.md 의 라이브러리 섹션 "Ownership grant 시점: SO confirmed (결제 완료) 시점" 은 in-place 로 정정 — CONTEXT.md 는 현재의 진실만 담는 곳.
- contract 변경(`OrderConfirmed` event 삭제)이 다른 서비스에 영향이 없는지 확인 완료 — notification/wallet/orchestrator 어디서도 `OrderConfirmed` 를 구독/발행하지 않음.
- 별도 backfill 스크립트는 불필요 — library 가 신설 단계라 prod 에 디지털 ownership 데이터 0 건이고, existing-path grant 재시도가 자가치유 역할도 겸함. 배포 윈도우 안의 race 로 grant 누락된 SO 가 생기더라도 다음 OrderCreated redelivery 시 자동 보정.
- **재검토 트리거**: 이 ADR 의 재검토는 다음 조건에서 정당화된다 — (가) BNPL/가상계좌 같이 SO 생성 시점에 결제가 아직 미확정인 채널이 도입되고, (나) 그 미결제 구간이 운영적 의미를 가져 "결제 확정" 이라는 별개 사건을 downstream 이 알아야 하는 경우. 그때는 contract 에 `OrderPaymentCompleted` 를 부활시키고 (지금 contract 에 정의는 살아있음), grant 트리거를 거기로 옮긴다.
