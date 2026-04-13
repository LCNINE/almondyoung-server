# 주문 취소 및 변경

## 개요

판매주문이 생성된 이후 취소 또는 변경이 발생할 수 있다. 판매채널(Medusa, 네이버, 쿠팡 등)은 이 커머스 백엔드 외부에 있으므로 Kafka 이벤트 브로커와 직접 연결되어 있지 않다. 따라서 **channel-adapter가 외부 채널과 내부 이벤트 버스 사이의 번역 계층** 역할을 한다.

---

## 취소 흐름

### 전체 이벤트 흐름

```
[외부 판매채널]           [channel-adapter]          [order-matching]         [WMS]
                              (내부 앱)
 고객: 취소 요청
 (webhook/API/폴링) ──►  수신, 정규화
                          SalesOrderCancelled
                            ──kafka──────────►  변환 기록 조회
                                                 │
                                          ┌── 변환 완료 상태 ──┐
                                          │                    │
                                          │  InventoryOrder    │
                                          │  Cancelled ────────┼──────────►  취소 처리
                                          │                    │             (이행 상태에 따라 분기)
                                          └────────────────────┘             │
                                                                             │
                                          ┌── 아직 미변환 ────┐              │
                                          │  (hold 상태 등)   │              │
                                          │  변환 대기 제거   │              │
                                          │  WMS 통지 불필요  │              │
                                          └────────────────────┘             │
                                                                             │
                                                 CancelConfirmed ◄───────────┤
                          CancelConfirmed        또는                         │
                            ◄──kafka────────  CancelRejected ◄──────────────┘
 취소 결과 반영
  ◄──외부 채널 API──
```

### 각 앱의 책임

**channel-adapter:**
- 외부 채널의 webhook/polling으로 취소 요청 감지
- 내부 Kafka 이벤트(`SalesOrderCancelled`)로 정규화하여 발행
- 응답 이벤트(`CancelConfirmed`/`CancelRejected`) 소비 후 외부 채널 API를 호출하여 결과 반영

**order-matching:**
- `SalesOrderCancelled` 소비
- 해당 판매주문의 변환 기록 조회
- 변환이 이미 완료된 경우 → `InventoryOrderCancelled` 발행
- 변환 전이었던 경우 (미매칭으로 hold 중 등) → 변환 대기열에서 제거, WMS 통지 불필요
- WMS 응답(`CancelConfirmed`/`CancelRejected`)을 channel-adapter로 중계

**WMS:**
- `InventoryOrderCancelled` 소비
- 이행 상태에 따라 분기 처리 (아래 참조)
- 처리 결과를 이벤트로 발행

### WMS의 취소 가능 조건

출고 처리가 완료되어 물리적으로 우리 손을 떠난 경우만 취소가 불가능하다. 피킹이나 패킹 진행 중이라도 취소를 수용한다.

| 이행 상태 | 처리 | 발행 이벤트 |
|-----------|------|------------|
| 미처리 | 재고주문 취소, 예약(RESERVE) 해제 | `CancelConfirmed` |
| 피킹 중 | 작업 중단 알림, 예약 해제, 재고 원복 | `CancelConfirmed` |
| 패킹 중 | 작업 중단 알림, 예약 해제, 재고 원복 | `CancelConfirmed` |
| 출고 완료 (우리 손을 떠남) | 취소 불가 | `CancelRejected` (reason: `already_shipped`) |

---

## 판매주문 변경 (수량 변경, 라인 추가/삭제)

주문 변경은 **Cancel + Re-create** 패턴으로 처리한다. 기존 주문을 취소하고 변경된 내용으로 새 주문을 생성하는 방식이다.

### 흐름

```
[channel-adapter]           [order-matching]         [WMS]

SalesOrderCancelled
  (원본 주문) ──kafka──────►  InventoryOrder
                              Cancelled ─────────►  기존 재고주문 취소

SalesOrderCreated
  (변경된 주문) ──kafka────►  매칭 규칙 적용
                              새 변환 수행
                              InventoryOrder
                              Created ───────────►  새 재고주문 생성
```

### Cancel + Re-create를 선택한 이유

- order-matching과 WMS 입장에서 기존 로직(`Created`/`Cancelled`)만으로 처리 가능 — 별도의 delta 계산/적용 로직 불필요
- 변환 스냅샷이 원본/수정본 각각 독립된 기록으로 유지

### 재고 예약 gap 완화

취소와 재생성 사이에 재고 예약 gap이 발생할 수 있다. 이를 완화하기 위해 두 이벤트를 correlation ID로 연결한다.

```
SalesOrderCancelled {
  salesOrderId: "order-123",
  reason: "modified",
  replacedBy: "order-123-v2"      // 대체 주문 ID
}

SalesOrderCreated {
  salesOrderId: "order-123-v2",
  replaces: "order-123",          // 원본 주문 ID
  lines: [...]
}
```

WMS는 `replaces` 관계를 인지하면, 기존 예약을 해제하면서 동시에 새 예약을 잡아 gap을 최소화할 수 있다.

---

## 판매채널 측 중간 상태

취소/변경 요청은 비동기로 처리되므로, 판매채널은 결과가 확정될 때까지 중간 상태를 유지해야 한다. 요청 즉시 "취소되었습니다"를 보여주면 안 된다 — 이미 출고된 경우 취소가 거절될 수 있기 때문이다.

### 상태 흐름

```
고객: 취소 요청
     │
     ▼
[취소 요청됨]  ← 고객에게는 "취소 처리 중"으로 보임
     │
     ├─ CancelConfirmed 수신 → [취소 완료]   ← "취소되었습니다"
     │
     └─ CancelRejected 수신  → [취소 거절]   ← "이미 배송 중이라 취소가 불가합니다"
```

### Medusa의 Order Change 활용

Medusa에는 **Order Change** 기능이 있으며, 다음 상태를 가진다:

| 상태 | 의미 |
|------|------|
| `requested` | 변경 요청됨 |
| `pending` | 처리 대기 중 |
| `confirmed` | 승인됨 |
| `declined` | 거절됨 |
| `canceled` | 취소됨 |

이 `requested` → `confirmed`/`declined` 흐름이 우리의 "취소 요청 → WMS 확인 → 확정/거절" 패턴과 일치한다. 또한 Medusa의 Order 자체에도 `requires_action` 상태가 있어, 외부 시스템 응답을 기다리는 상황을 표현할 수 있다.

```
고객: 취소 요청
     │
     ▼
Medusa: Order Change 생성 (status: requested)
        Order 상태: requires_action
     │
     ▼
channel-adapter: Medusa API 폴링/웹훅으로 감지
                 → Kafka: SalesOrderCancelled 발행
     │
     ... (order-matching → WMS → 응답) ...
     │
     ▼
channel-adapter: CancelConfirmed 수신
                 → Medusa API: Order Change → confirmed, Order → canceled

channel-adapter: CancelRejected 수신
                 → Medusa API: Order Change → declined (reason: "already_shipped")
                    Order 상태: pending으로 복원
```

네이버, 쿠팡 등 외부 마켓플레이스도 유사한 중간 상태 패턴(판매자 승인 대기)을 가지고 있으므로, channel-adapter가 각 채널의 프로토콜 차이를 흡수한다.

---

## Race Condition 대응

### 문제

비동기 이벤트 전파 중 물리적 상태가 변할 수 있다. 채널에서 취소를 보낸 시점에는 피킹 중이었는데, 이벤트가 WMS에 도착할 때는 출고가 완료되어 있을 수 있다.

```
시간 →

채널: 취소 요청 발행 ──────────────────────────────────────────►
                                                                WMS에 도착
WMS:       [피킹 중] ──── [패킹 완료] ──── [출고 처리] ──── [취소 요청 수신]
                                              ↑
                                         전파 중 출고 완료
```

### 대응: DB 레벨 원자성

WMS는 취소 요청 도착 시점의 **실제 상태**로 판단한다. 출고와 취소가 동시에 요청되는 경우, optimistic locking으로 하나만 성공하게 한다.

```typescript
// 출고 처리
async shipOut(orderId: string, tx: DbTx) {
  const result = await tx.update(fulfillmentOrders)
    .set({ status: 'shipped', version: sql`version + 1` })
    .where(and(
      eq(fulfillmentOrders.id, orderId),
      eq(fulfillmentOrders.status, 'packing'),
      eq(fulfillmentOrders.version, currentVersion)
    ));
  if (result.rowCount === 0) throw new Error('state changed');
}

// 취소 처리
async cancelOrder(orderId: string, tx: DbTx) {
  const result = await tx.update(fulfillmentOrders)
    .set({ status: 'cancelled', version: sql`version + 1` })
    .where(and(
      eq(fulfillmentOrders.id, orderId),
      ne(fulfillmentOrders.status, 'shipped'),
      eq(fulfillmentOrders.version, currentVersion)
    ));
  if (result.rowCount === 0) {
    // 이미 출고됨 → CancelRejected 발행
  }
}
```

### 보장할 수 있는 것과 없는 것

**보장 가능:** 출고 완료된 주문은 절대 취소되지 않고, 취소된 주문은 절대 출고되지 않는다 (DB 레벨 원자성).

**보장 불가:** 채널에서 취소를 보낸 시점에 "아직 출고 안 됐으니 취소될 것이다"라는 기대. 비동기 전파 중 상태가 바뀔 수 있으므로, 채널 쪽은 항상 `CancelConfirmed`/`CancelRejected` 응답을 받아서 최종 결과를 확인해야 한다.

---

## 추가 이벤트 컨트랙트

기존 문서(04-integration.md)에 정의된 이벤트에 더해, 취소/변경 흐름에 필요한 이벤트:

| 이벤트 | 발행자 | 소비자 | 용도 |
|--------|--------|--------|------|
| `SalesOrderCancelled` | channel-adapter | order-matching | 판매주문 취소 요청 |
| `InventoryOrderCancelled` | order-matching | WMS | 재고주문 취소 요청 |
| `CancelConfirmed` | WMS | order-matching → channel-adapter | 취소 성공 |
| `CancelRejected` | WMS | order-matching → channel-adapter | 취소 거절 (이미 출고됨) |

### 응답 timeout 모니터링

channel-adapter가 `SalesOrderCancelled`를 발행한 후 일정 시간 내에 `CancelConfirmed`/`CancelRejected`가 오지 않으면, timeout 처리 및 관리자 알림이 필요하다. channel-adapter 자체에서 "내가 보낸 취소 요청의 응답을 받았는가"를 추적하는 수준으로 구현한다.
