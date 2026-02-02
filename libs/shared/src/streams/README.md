# Kafka Event Streams Documentation

이 문서는 Almondyoung Server 마이크로서비스 간 Kafka를 통해 통신하는 모든 이벤트 스트림을 정의합니다.

## 목차

- [아키텍처 개요](#아키텍처-개요)
- [스트림 목록](#스트림-목록)
  - [User Stream](#user-stream)
  - [Cart Stream](#cart-stream)
  - [Order Stream](#order-stream)
  - [Orders Stream](#orders-stream)
  - [Payment Stream](#payment-stream)
  - [Fulfillment Stream](#fulfillment-stream)
  - [Inventory Stream](#inventory-stream)
  - [Channel Adapter Stream](#channel-adapter-stream)
- [이벤트 스키마 검증](#이벤트-스키마-검증)
- [사용 예제](#사용-예제)

---

## 아키텍처 개요

### Event-Driven Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Medusa    │────▶│    Kafka    │◀────│     WMS     │
│   Server    │     │   Streams   │     │   Service   │
└─────────────┘     └─────────────┘     └─────────────┘
                           ▲
                           │
                    ┌──────┴──────┐
                    │   Channel   │
                    │   Adapter   │
                    └─────────────┘
```

### 설계 원칙

- **도메인별 스트림 분리**: 각 도메인(User, Order, Inventory 등)은 독립적인 Kafka 토픽을 가짐
- **타입 안전성**: TypeScript 타입과 Zod 스키마를 통한 런타임 검증
- **이벤트 버전 관리**: 토픽명에 버전 포함 (`*.events.v1`)
- **파티셔닝 전략**: 처리량에 따라 파티션 수 조정 (6~24개)

---

## 스트림 목록

### User Stream

**토픽**: `users.events.v1`
**파티션**: 6
**Aggregate**: `User`

사용자 계정 생성, 수정, 삭제 및 인증 관련 이벤트를 처리합니다.

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `UserCreated` | 사용자 계정 생성 | `userId`, `email`, `name` |
| `UserVerification` | 이메일 인증 요청 | `verificationToken`, `callbackUrl` |
| `UserUpdated` | 사용자 정보 수정 | `userId`, `email?`, `name?` |
| `UserDeleted` | 사용자 삭제 (논리 삭제) | `userId` |
| `UserDormantConverted` | 휴면 계정 전환 | `userId`, `convertedAt` |
| `UserPermanentDeleted` | 완전 삭제 (GDPR) | `userId`, `deletedAt` |
| `UserFindId` | 아이디 찾기 결과 | `phoneNumber`, `loginId` |
| `UserResetPassword` | 비밀번호 재설정 요청 | `phoneNumber` |

#### Payload 예시

```typescript
// UserCreated
{
  userId: "usr_01234567890",
  email: "user@example.com",
  name: "홍길동"
}

// UserVerification
{
  userId: "usr_01234567890",
  email: "user@example.com",
  name: "홍길동",
  verificationToken: "abc123xyz",
  callbackUrl: "https://api.example.com/verify",
  redirectTo: "/welcome"
}
```

---

### Cart Stream

**토픽**: `carts.events.v1`
**파티션**: 6
**Aggregate**: `Cart`

장바구니 생성 및 변경 이벤트를 처리합니다.

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `CartCreated` | 장바구니 생성 | `id`, `customer_id`, `region_id` |
| `CartUpdated` | 장바구니 아이템 변경 | `id`, `items`, `total`, `subtotal` |

#### Payload 예시

```typescript
// CartUpdated
{
  id: "cart_01H8X...",
  items: [
    {
      id: "item_01H8Y...",
      title: "상품명",
      quantity: 2,
      unit_price: 10000,
      variant_id: "variant_01H8Z..."
    }
  ],
  total: 20000,
  subtotal: 20000,
  updated_at: "2024-03-01T12:00:00Z"
}
```

---

### Order Stream

**토픽**: `orders.events.v1`
**파티션**: 12
**Aggregate**: `Order`

주문 생성, 결제, 취소 등의 핵심 주문 이벤트를 처리합니다. (Medusa 호환)

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `OrderCreated` | 주문 생성 | `orderId`, `status`, `total`, `items` |
| `OrderCancelled` | 주문 취소 | `orderId`, `status` |
| `OrderPaymentComplete` | 결제 완료 | `order_id`, `payment_id`, `amount` |
| `OrderReturnRequested` | 반품 요청 | `order_id`, `return_id`, `items` |
| `OrderRefundCreated` | 환불 생성 | `order_id`, `refund_id`, `amount` |

#### Payload 예시

```typescript
// OrderCreated
{
  orderId: "order_01H8...",
  status: "pending",
  total: 50000,
  items: [
    { id: "item_01H8...", quantity: 2 }
  ]
}

// OrderReturnRequested
{
  order_id: "order_01H8...",
  return_id: "ret_01H8...",
  items: [
    {
      item_id: "item_01H8...",
      quantity: 1,
      reason: "SIZE_NOT_FIT"
    }
  ],
  requested_at: "2024-03-01T12:00:00Z"
}
```

---

### Orders Stream

**토픽**: `orders.events.v1`
**파티션**: 12
**Aggregate**: `Order`

WMS 통합을 위한 확장된 주문 이벤트 스트림입니다. 재고 차감/복원 정보를 포함합니다.

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `OrderCreated` | 주문 생성 (상세) | `orderId`, `salesChannel`, `items`, `shippingAddress` |
| `OrderConfirmed` | 주문 확정 (재고 차감) | `orderId`, `stockDeductionResults` |
| `OrderModified` | 주문 수정 | `orderId`, `changes`, `modifiedBy` |
| `OrderCancelled` | 주문 취소 (재고 복원) | `orderId`, `reason`, `stockRestorationResults` |
| `OrderPaymentCompleted` | 결제 완료 | `orderId`, `paymentId`, `amount` |
| `OrderReturnRequested` | 반품 요청 | `orderId`, `returnId`, `items` |
| `OrderRefundCreated` | 환불 생성 | `orderId`, `refundId`, `amount` |
| `OrderMerged` | 주문 병합 | `targetOrderId`, `sourceOrderIds` |

#### SalesChannel Types

```typescript
type SalesChannel = 'medusa' | 'naver' | 'coupang' | '3pl';
```

#### OrderStatus Types

```typescript
type OrderStatus =
  | 'pending'       // 주문 대기
  | 'confirmed'     // 주문 확정
  | 'processing'    // 처리 중
  | 'shipped'       // 배송 중
  | 'delivered'     // 배송 완료
  | 'cancelled'     // 취소됨
  | 'timeout';      // 시간 초과
```

#### Payload 예시

```typescript
// OrderCreated
{
  orderId: "ORD-20240301-001",
  externalOrderId: "NAVER-12345",
  salesChannel: "naver",
  customerId: "cust_01H8...",
  items: [
    {
      orderItemId: "item_01",
      skuId: "SKU-001",
      quantity: 2,
      unitPrice: 25000,
      totalPrice: 50000
    }
  ],
  totalAmount: 53000,
  subtotalAmount: 50000,
  shippingAmount: 3000,
  discountAmount: 0,
  currency: "KRW",
  shippingAddress: {
    recipientName: "홍길동",
    phone: "010-1234-5678",
    postalCode: "12345",
    roadAddress: "서울시 강남구 테헤란로 123",
    detailAddress: "4층"
  },
  status: "pending",
  createdAt: "2024-03-01T12:00:00Z"
}

// OrderConfirmed
{
  orderId: "ORD-20240301-001",
  confirmedAt: "2024-03-01T12:05:00Z",
  confirmedBy: "admin_01",
  stockDeductionResults: [
    {
      orderItemId: "item_01",
      skuId: "SKU-001",
      requestedQty: 2,
      deductedQty: 2,
      stockEventId: "evt_stock_001"
    }
  ]
}

// OrderCancelled
{
  orderId: "ORD-20240301-001",
  reason: "OUT_OF_STOCK",
  reasonDetail: "SKU-001 재고 부족",
  cancelledBy: "system",
  cancelledAt: "2024-03-01T12:10:00Z",
  refundRequired: true,
  refundAmount: 53000,
  stockRestorationResults: [
    {
      orderItemId: "item_01",
      skuId: "SKU-001",
      restoredQty: 2,
      stockEventId: "evt_stock_002"
    }
  ]
}
```

---

### Payment Stream

**토픽**: `payments.events.v1`
**파티션**: 6
**Aggregate**: `Payment`

결제 및 환불 이벤트를 처리합니다.

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `PaymentCaptured` | 결제 승인 완료 | `order_id`, `payment_id`, `amount` |
| `PaymentRefundRequest` | 환불 요청 | `refund_id`, `paymentEventId`, `amount` |
| `PaymentRefundCompleted` | 환불 완료 | `refundId`, `data`, `completedAt` |

#### Payload 예시

```typescript
// PaymentCaptured
{
  order_id: "order_01H8...",
  payment_id: "pay_01H8...",
  amount: 50000,
  currency_code: "KRW",
  created_at: "2024-03-01T12:00:00Z"
}

// PaymentRefundRequest
{
  refund_id: "ref_01H8...",
  user_id: "usr_01H8...",
  paymentEventId: "pay_01H8...",
  amount: 25000,
  reason: "부분 환불"
}
```

---

### Fulfillment Stream

**토픽**: `fulfillments.events.v1`
**파티션**: 6
**Aggregate**: `Fulfillment`

주문 이행 및 배송 상태 이벤트를 처리합니다.

#### FulfillmentMode

```typescript
type FulfillmentMode =
  | 'in_house'   // 자체 물류
  | '3pl'        // 3자 물류
  | 'drop_ship'; // 직송
```

#### FulfillmentStatus

```typescript
type FulfillmentStatus =
  | 'created'    // 생성됨
  | 'ready'      // 출고 준비 완료
  | 'labeled'    // 송장 출력 완료
  | 'shipped'    // 출고 완료
  | 'delivered'  // 배송 완료
  | 'cancelled'  // 취소됨
  | 'returned';  // 반품됨
```

#### Carrier

```typescript
type Carrier = 'CJ' | 'HANJIN' | 'LOTTE' | 'LOGEN' | 'KDEXP' | 'CJGLS';
```

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `FulfillmentCreated` | 이행 생성 | `fulfillmentId`, `orderId`, `mode`, `items` |
| `FulfillmentReady` | 출고 준비 완료 | `fulfillmentId`, `readyItems`, `readyBy` |
| `FulfillmentLabeled` | 송장 출력 완료 | `fulfillmentId`, `trackingInfo` |
| `FulfillmentShipped` | 출고 완료 | `fulfillmentId`, `trackingInfo`, `shippedItems` |
| `FulfillmentDelivered` | 배송 완료 | `fulfillmentId`, `deliveredAt`, `recipient` |
| `FulfillmentCancelled` | 이행 취소 | `fulfillmentId`, `reason`, `cancelledBy` |
| `FulfillmentReturned` | 반품 완료 | `fulfillmentId`, `returnedItems`, `returnReason` |

#### Payload 예시

```typescript
// FulfillmentCreated
{
  fulfillmentId: "fulf_01H8...",
  fulfillmentNo: "FULF-20240301-001",
  orderId: "order_01H8...",
  mode: "in_house",
  warehouseId: "WH-001",
  items: [
    {
      fulfillmentItemId: "fitem_01",
      orderItemId: "oitem_01",
      skuId: "SKU-001",
      quantity: 2
    }
  ],
  createdAt: "2024-03-01T12:00:00Z"
}

// FulfillmentShipped
{
  fulfillmentId: "fulf_01H8...",
  orderId: "order_01H8...",
  trackingInfo: {
    carrier: "CJ",
    trackingNumber: "123456789012",
    invoiceUrl: "https://tracker.cjlogistics.com/123456789012"
  },
  shippedAt: "2024-03-02T09:00:00Z",
  estimatedDeliveryDate: "2024-03-04",
  shippedItems: [
    {
      fulfillmentItemId: "fitem_01",
      skuId: "SKU-001",
      shippedQty: 2
    }
  ]
}

// FulfillmentCancelled
{
  fulfillmentId: "fulf_01H8...",
  orderId: "order_01H8...",
  reason: "OUT_OF_STOCK",
  reasonDetail: "재고 부족으로 인한 취소",
  cancelledBy: "admin_01",
  cancelledAt: "2024-03-01T13:00:00Z"
}
```

---

### Inventory Stream

**토픽**: `inventory.events.v1`
**파티션**: 24
**Aggregate**: `Stock`

재고 입출고, 조정, 이동, 예약 등 모든 재고 변경 이벤트를 처리합니다.

#### StockState

```typescript
type StockState =
  | 'ON_HAND'      // 정상 재고
  | 'DEFECTIVE'    // 불량 재고
  | 'IN_TRANSFER'; // 이동 중
```

#### InboundType

```typescript
type InboundType =
  | 'DOMESTIC'  // 국내 입고
  | 'OVERSEAS'  // 해외 입고
  | 'RETURN'    // 반품 입고
  | 'GENERAL';  // 일반 입고
```

#### OutboundType

```typescript
type OutboundType =
  | 'ORDER'    // 주문 출고
  | 'DAMAGE'   // 파손 출고
  | 'LOSS'     // 분실 출고
  | 'DISPOSAL' // 폐기 출고
  | 'GENERAL'; // 일반 출고
```

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `StockReceived` | 재고 입고 | `skuId`, `quantity`, `warehouseId`, `inboundType` |
| `StockShipped` | 재고 출고 | `skuId`, `quantity`, `warehouseId`, `outboundType` |
| `StockAdjusted` | 재고 조정 | `skuId`, `deltaQuantity`, `beforeQuantity`, `afterQuantity` |
| `StockMoved` | 재고 이동 | `skuId`, `fromWarehouseId`, `toWarehouseId` |
| `StockReserved` | 재고 예약 | `skuId`, `quantity`, `reservedFor`, `expiresAt` |
| `StockReservationConfirmed` | 예약 확정 | `reservationId`, `skuId`, `quantity` |
| `StockReservationReleased` | 예약 해제 | `reservationId`, `skuId`, `reason` |
| `StockDamaged` | 재고 파손 | `skuId`, `quantity`, `damageReason` |
| `StockLost` | 재고 분실 | `skuId`, `quantity`, `lostReason` |
| `StockDisposed` | 재고 폐기 | `skuId`, `quantity`, `disposalReason` |
| `StockDefectMarked` | 불량 지정 | `skuId`, `quantity`, `defectReason` |
| `StockReworked` | 불량 양품화 | `skuId`, `quantity`, `reworkNote` |

#### Payload 예시

```typescript
// StockReceived
{
  stockEventId: "evt_stock_001",
  skuId: "SKU-001",
  skuCode: "PROD-001-RED-M",
  quantity: 100,
  warehouseId: "WH-001",
  locationId: "LOC-A-01-01",
  inboundType: "DOMESTIC",
  inboundId: "IB-20240301-001",
  purchaseOrderId: "PO-001",
  receivedAt: "2024-03-01T10:00:00Z",
  reason: "정기 입고",
  note: "품질 검수 완료"
}

// StockAdjusted
{
  stockEventId: "evt_stock_002",
  skuId: "SKU-001",
  skuCode: "PROD-001-RED-M",
  deltaQuantity: -5,
  beforeQuantity: 100,
  afterQuantity: 95,
  warehouseId: "WH-001",
  locationId: "LOC-A-01-01",
  adjustmentType: "INVENTORY_COUNT",
  reason: "재고 실사 결과 조정",
  note: "실사 담당: 김철수",
  adjustedBy: "admin_01",
  adjustedAt: "2024-03-01T15:00:00Z"
}

// StockReserved
{
  reservationId: "rsv_01H8...",
  skuId: "SKU-001",
  skuCode: "PROD-001-RED-M",
  quantity: 2,
  warehouseId: "WH-001",
  reservedFor: "ORDER",
  orderId: "order_01H8...",
  expiresAt: "2024-03-01T18:00:00Z",
  reservedAt: "2024-03-01T12:00:00Z"
}

// StockDamaged
{
  stockEventId: "evt_stock_003",
  skuId: "SKU-001",
  skuCode: "PROD-001-RED-M",
  quantity: 3,
  warehouseId: "WH-001",
  locationId: "LOC-A-01-01",
  damageReason: "운송 중 파손",
  damageDescription: "상자 찌그러짐 및 제품 파손",
  damagePhotoUrls: ["https://s3.../damage1.jpg"],
  damagedAt: "2024-03-01T11:00:00Z",
  reportedBy: "worker_01"
}
```

---

### Channel Adapter Stream

**토픽**: `channel-adapter.events.v1`
**파티션**: 6
**Aggregate**: `ChannelAdapter`

외부 판매 채널(네이버, 쿠팡 등)과의 연동 이벤트를 처리합니다.

#### ChannelType

```typescript
type ChannelType = 'naver_smartstore' | 'coupang' | 'medusa';
```

#### Events

| 이벤트명 | 설명 | 주요 필드 |
|---------|------|----------|
| `OrderSyncCompleted` | 주문 동기화 완료 | `channelType`, `syncType`, `orders`, `orderCount` |
| `InventorySyncCompleted` | 재고 동기화 완료 | `channelType`, `productId`, `stockQuantity` |
| `CommandExecuted` | 채널 명령 실행 | `channelType`, `commandType`, `executionResult` |
| `SyncFailure` | 동기화 실패 | `channelType`, `syncType`, `failureReason` |
| `ChannelStatusChanged` | 채널 상태 변경 | `channelType`, `previousStatus`, `currentStatus` |
| `QueryExecuted` | 조회 쿼리 실행 | `channelType`, `queryType`, `resultCount` |

#### Payload 예시

```typescript
// OrderSyncCompleted
{
  channelType: "naver_smartstore",
  syncType: "inbound",
  orderCount: 15,
  orders: [
    {
      channelType: "naver_smartstore",
      externalOrderId: "NAVER-12345",
      status: "PENDING",
      quantity: 2,
      priceAmount: 50000
    }
  ],
  syncDurationMs: 1523,
  errors: []
}

// InventorySyncCompleted
{
  channelType: "coupang",
  productId: "PROD-001",
  syncType: "single",
  stockQuantity: 95,
  syncResult: "success"
}

// CommandExecuted
{
  channelType: "naver_smartstore",
  commandType: "order.confirm",
  targetId: "NAVER-12345",
  executionResult: "success",
  processedCount: 1,
  failedCount: 0,
  executionDurationMs: 856
}

// SyncFailure
{
  channelType: "coupang",
  syncType: "orders",
  failureReason: "API rate limit exceeded",
  retryCount: 2,
  maxRetries: 3,
  nextRetryAt: "2024-03-01T12:15:00Z",
  affectedIds: ["CPG-001", "CPG-002"]
}

// ChannelStatusChanged
{
  channelType: "naver_smartstore",
  previousStatus: "active",
  currentStatus: "error",
  reason: "인증 토큰 만료",
  lastSyncAt: "2024-03-01T11:30:00Z",
  errorDetails: {
    message: "Authentication token expired",
    code: "AUTH_EXPIRED",
    occurredAt: "2024-03-01T12:00:00Z"
  }
}
```

---

## 이벤트 스키마 검증

모든 이벤트는 [Zod](https://github.com/colinhacks/zod) 스키마를 통해 런타임 검증됩니다.

### 검증 항목

- **필수 필드**: 모든 필드가 존재하는지 확인
- **타입 검증**: 문자열, 숫자, 날짜 등 타입 일치 여부
- **범위 검증**: 양수, 음수 아닌 값 등
- **형식 검증**: 이메일, URL, ISO 8601 날짜 형식 등

### 검증 실패 시

- 이벤트가 Kafka에 발행되지 않음
- 에러 로그 기록
- 적절한 에러 응답 반환

---

## 사용 예제

### 이벤트 발행 (Publisher)

```typescript
import { INVENTORY_STREAM } from '@app/shared/streams';
import { StreamPublisher } from '@app/events';

@Injectable()
export class InventoryService {
  constructor(
    private readonly publisher: StreamPublisher,
  ) {}

  async receiveStock(dto: ReceiveStockDto) {
    // ... 비즈니스 로직 ...

    // 이벤트 발행
    await this.publisher.publish(INVENTORY_STREAM.events.StockReceived, {
      stockEventId: 'evt_stock_001',
      skuId: dto.skuId,
      skuCode: dto.skuCode,
      quantity: dto.quantity,
      warehouseId: dto.warehouseId,
      locationId: dto.locationId,
      inboundType: 'DOMESTIC',
      receivedAt: new Date().toISOString(),
    });
  }
}
```

### 이벤트 구독 (Consumer)

```typescript
import { INVENTORY_STREAM } from '@app/shared/streams';
import { EventSubscriber } from '@app/events';

@Injectable()
export class InventoryConsumer {
  @EventSubscriber(INVENTORY_STREAM.events.StockReceived)
  async handleStockReceived(event: StockReceivedPayload) {
    console.log(`재고 입고: SKU ${event.skuId}, 수량 ${event.quantity}`);

    // 재고 요약 테이블 업데이트
    await this.updateStockSummary(event);

    // 외부 시스템에 알림
    await this.notifyExternalSystems(event);
  }
}
```

### 트랜잭션 컨텍스트에서 이벤트 발행

```typescript
async createOrder(dto: CreateOrderDto, tx?: DbTx) {
  return this.inTx(async (tx) => {
    // DB 트랜잭션 내에서 주문 생성
    const order = await tx.insert(orders).values(dto).returning();

    // 트랜잭션 커밋 후 이벤트 발행
    await this.publisher.publish(ORDER_STREAM.events.OrderCreated, {
      orderId: order.id,
      salesChannel: dto.salesChannel,
      items: dto.items,
      // ...
    });

    return order;
  }, tx);
}
```

---

## 주의사항

### 1. 이벤트 순서 보장

- **동일 Partition Key**: 같은 주문/재고/사용자에 대한 이벤트는 동일한 파티션으로 전송
- **예시**: `orderId`, `skuId`, `userId`를 파티션 키로 사용

### 2. 멱등성 (Idempotency)

- **중복 처리 방지**: 이벤트 ID를 사용하여 중복 처리 감지
- **예시**: `stockEventId`, `reservationId` 등을 DB에 저장하여 중복 체크

### 3. 에러 핸들링

- **Retry 전략**: 일시적 오류에 대한 재시도 로직 구현
- **Dead Letter Queue**: 처리 실패한 이벤트는 별도 큐로 이동
- **알림**: 중요한 이벤트 처리 실패 시 관리자에게 알림

### 4. 스키마 변경

- **하위 호환성 유지**: 필드 추가는 가능하나, 제거/변경 시 주의
- **버전 관리**: 큰 변경 시 새로운 토픽 생성 (`*.events.v2`)

### 5. 성능 고려사항

- **배치 처리**: 대량 이벤트는 배치로 발행
- **파티션 수 조정**: 트래픽 증가 시 파티션 수 증가
- **Consumer Group**: 수평 확장을 위한 컨슈머 그룹 사용

---

## 관련 문서

- [NestJS Microservices](https://docs.nestjs.com/microservices/basics)
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/)
- [Zod Schema Validation](https://github.com/colinhacks/zod)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)

---

**Last Updated**: 2024-03-01
**Version**: 1.0.0
