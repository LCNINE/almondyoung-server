# MSA 이벤트/커맨드 설계 명세서

> **작성일**: 2025-10-08
> **버전**: 1.0.0
> **상태**: 초안

## 📊 시스템 개요

### 마이크로서비스 구성

- **PIM** (Product Information Management): 상품 마스터, 변형, 옵션 관리
- **WMS** (Warehouse Management System): 재고, 입고, 출고, 주문 이행
- **Channel Adapter**: 외부 판매 채널 연동 (네이버, 쿠팡, 메두사)
- **Notification**: 알림 서비스
- **Main Server**: 메인 애플리케이션 서버

### 이벤트 기반 통신 원칙

- **Stream 기반 토픽**: 하나의 토픽에 여러 이벤트 타입 포함
- **Outbox 패턴**: 트랜잭션 일관성 보장
- **Message Envelope**: 모든 메시지는 표준 Envelope로 감싸짐
- **Zod 스키마 검증**: 런타임 타입 안전성 보장

---

## 🎯 토픽별 이벤트 명세

### 1. `pim.events.v1` ⭐ (신규)

**도메인**: 상품 정보 관리
**Aggregate Type**: `Product`
**파티션 수**: 6

#### 1.1 `ProductMasterCreated`

상품 마스터가 생성되었을 때 발행

**발행자**: PIM

**구독자**:
- **WMS**: 상품 마스터 정보 저장, SKU 매칭 준비
- **Channel Adapter**: 판매 채널에 상품 등록 준비

**페이로드**:
```typescript
interface ProductMasterCreatedPayload {
  productMasterId: string;           // 상품 마스터 ID
  name: string;                       // 상품명
  brand?: string;                     // 브랜드
  basePrice?: number;                 // 기준 가격 (원 단위)
  pricingStrategy: 'option_based' | 'variant_based';  // 가격 책정 전략
  categoryIds: string[];              // 카테고리 ID 목록
  thumbnail?: string;                 // 썸네일 URL
  images?: string[];                  // 이미지 URL 목록
  description?: string;               // 설명
  status: 'active' | 'inactive' | 'draft';  // 상태
  isWholesaleOnly: boolean;          // 도매 전용 여부
  isMembershipOnly: boolean;         // 멤버십 전용 여부
  membershipPrice?: number;          // 멤버십 가격
  wholesalePrice?: number;           // 도매 가격
  tags?: string[];                   // 태그
  createdAt: string;                 // 생성 시각 (ISO 8601)
}
```

**Zod 스키마**:
```typescript
const ProductMasterCreatedSchema = z.object({
  productMasterId: z.string().uuid(),
  name: z.string().min(1).max(255),
  brand: z.string().max(100).optional(),
  basePrice: z.number().int().nonnegative().optional(),
  pricingStrategy: z.enum(['option_based', 'variant_based']),
  categoryIds: z.array(z.string().uuid()),
  thumbnail: z.string().url().optional(),
  images: z.array(z.string().url()).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'inactive', 'draft']),
  isWholesaleOnly: z.boolean(),
  isMembershipOnly: z.boolean(),
  membershipPrice: z.number().int().nonnegative().optional(),
  wholesalePrice: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string().datetime(),
});
```

---

#### 1.2 `ProductMasterUpdated`

상품 마스터가 수정되었을 때 발행

**발행자**: PIM

**구독자**:
- **WMS**: 상품 정보 업데이트
- **Channel Adapter**: 판매 채널 상품 정보 동기화

**페이로드**:
```typescript
interface ProductMasterUpdatedPayload extends ProductMasterCreatedPayload {
  updatedFields: string[];           // 변경된 필드 목록
  updatedAt: string;                 // 수정 시각 (ISO 8601)
}
```

---

#### 1.3 `ProductVariantCreated`

상품 변형(Variant)이 생성되었을 때 발행

**발행자**: PIM

**구독자**:
- **WMS**:
  - Product Matching 레코드 생성 (variant ↔ SKU 매핑)
  - 매칭 전략 결정 필요 ('void', 'variant', 'option')
- **Channel Adapter**: 옵션 상품 등록

**페이로드**:
```typescript
interface ProductVariantCreatedPayload {
  variantId: string;                 // 변형 ID
  masterId: string;                  // 마스터 상품 ID
  variantName?: string;              // 변형명 (수동 설정)
  priceAdjustment: number;           // 기준가 대비 조정 금액
  optionValues: Array<{              // 옵션 값 조합
    optionGroupId: string;
    optionGroupName: string;         // 예: '색상', '사이즈'
    optionValueId: string;
    optionValue: string;             // 예: '빨강', 'L'
    displayName: string;             // 예: '빨간색', 'L사이즈'
  }>;
  inventoryManagement: boolean;      // 재고 관리 여부
  components?: Array<{               // SKU 구성 정보 (세트 상품용)
    skuId: string;                   // WMS SKU ID
    skuName?: string;                // SKU 이름 (표시용)
    quantity: number;                // 수량
  }>;
  status: 'active' | 'inactive';
  displayOrder?: number;             // 표시 순서
  createdAt: string;                 // 생성 시각 (ISO 8601)
}
```

**Zod 스키마**:
```typescript
const OptionValueSchema = z.object({
  optionGroupId: z.string().uuid(),
  optionGroupName: z.string().min(1),
  optionValueId: z.string().uuid(),
  optionValue: z.string().min(1),
  displayName: z.string().min(1),
});

const ComponentSchema = z.object({
  skuId: z.string().uuid(),
  skuName: z.string().optional(),
  quantity: z.number().int().positive(),
});

const ProductVariantCreatedSchema = z.object({
  variantId: z.string().uuid(),
  masterId: z.string().uuid(),
  variantName: z.string().max(255).optional(),
  priceAdjustment: z.number().int(),
  optionValues: z.array(OptionValueSchema),
  inventoryManagement: z.boolean(),
  components: z.array(ComponentSchema).optional(),
  status: z.enum(['active', 'inactive']),
  displayOrder: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
});
```

---

#### 1.4 `ProductVariantUpdated`

상품 변형이 수정되었을 때 발행

**발행자**: PIM

**구독자**:
- **WMS**: Product Matching 정보 업데이트
- **Channel Adapter**: 채널 상품 정보 업데이트

**페이로드**:
```typescript
interface ProductVariantUpdatedPayload extends ProductVariantCreatedPayload {
  updatedFields: string[];
  updatedAt: string;
}
```

---

#### 1.5 `ProductVariantDeleted`

상품 변형이 삭제되었을 때 발행

**발행자**: PIM

**구독자**:
- **WMS**: Product Matching 레코드 삭제/비활성화
- **Channel Adapter**: 채널 상품 판매 중지

**페이로드**:
```typescript
interface ProductVariantDeletedPayload {
  variantId: string;
  masterId: string;
  reason?: string;                   // 삭제 사유
  deletedAt: string;
}
```

---

### 2. `inventory.events.v1` ✅ (기존)

**도메인**: 재고 관리
**Aggregate Type**: `Stock`
**파티션 수**: 24
**파일 경로**: `libs/shared/src/streams/inventory.stream.ts`

#### 2.1 `StockReceived`

재고 입고 완료

**발행자**: WMS (Inbound Service)

**구독자**:
- **Channel Adapter**: 판매 채널 재고 수량 동기화
- **Notification**: 입고 완료 알림 (관리자용)

**페이로드**: (기존 정의됨)
```typescript
interface StockReceivedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;
  quantity: number;
  warehouseId: string;
  locationId: string;
  inboundType: 'DOMESTIC' | 'OVERSEAS' | 'RETURN' | 'GENERAL';
  inboundId?: string;
  purchaseOrderId?: string;
  receivedAt: string;
  reason?: string;
  note?: string;
}
```

---

#### 2.2 `StockShipped`

재고 출고 완료

**발행자**: WMS (Fulfillment Service)

**구독자**:
- **Channel Adapter**: 판매 채널 재고 수량 동기화
- **Notification**: 출고 완료 알림

**페이로드**: (기존 정의됨)
```typescript
interface StockShippedPayload {
  stockEventId: string;
  skuId: string;
  skuCode: string;
  quantity: number;
  warehouseId: string;
  locationId: string;
  outboundType: 'ORDER' | 'DAMAGE' | 'LOSS' | 'DISPOSAL' | 'GENERAL';
  orderId?: string;
  fulfillmentId?: string;
  shippedAt: string;
  reason?: string;
}
```

---

#### 2.3 `StockAdjusted`

재고 조정 (수동 조정, 재고 실사)

**발행자**: WMS (Inventory Correction Service)

**구독자**:
- **Channel Adapter**: 판매 채널 재고 수량 동기화
- **Notification**: 재고 조정 알림 (중요 조정 시)

**페이로드**: (기존 정의됨)

---

#### 2.4 `StockMoved`

재고 이동 (창고 간/창고 내)

**발행자**: WMS (Movement Service)

**구독자**:
- **Notification**: 창고 간 이동 알림 (해외/국내 이동 시)

---

#### 2.5 `StockReserved`

재고 예약 생성

**발행자**: WMS (Reservation Service)

**구독자**:
- **Channel Adapter**: 예약 가능 재고 수량 업데이트

---

#### 2.6 `StockReservationConfirmed`

재고 예약 확정

**발행자**: WMS

**구독자**:
- (필요 시 추가)

---

#### 2.7 `StockReservationReleased`

재고 예약 해제

**발행자**: WMS

**구독자**:
- **Channel Adapter**: 예약 가능 재고 수량 업데이트

---

#### 2.8 `StockDamaged`

재고 파손

**발행자**: WMS

**구독자**:
- **Notification**: 재고 파손 알림 (관리자용)
- **Channel Adapter**: 재고 수량 동기화

---

#### 2.9 `StockLost`

재고 분실

**발행자**: WMS

**구독자**:
- **Notification**: 재고 분실 알림 (관리자용)
- **Channel Adapter**: 재고 수량 동기화

---

#### 2.10 `StockDisposed`

재고 폐기

**발행자**: WMS

**구독자**:
- **Notification**: 재고 폐기 알림
- **Channel Adapter**: 재고 수량 동기화

---

### 3. `orders.events.v1` ✅ (기존)

**도메인**: 주문 관리
**Aggregate Type**: `Order`
**파티션 수**: 12
**파일 경로**: `libs/shared/src/streams/order.stream.ts`

#### 3.1 `OrderCreated`

주문 생성

**발행자**:
- **Channel Adapter**: 외부 채널에서 주문 수신 시
- **Main Server**: 자체 몰에서 주문 생성 시

**구독자**:
- **WMS**: Sales Order 생성, 재고 확인
- **Notification**: 신규 주문 알림 (관리자/고객)

**페이로드**: (기존 정의됨)
```typescript
interface OrderCreatedPayload {
  orderId: string;
  status: string;
  total: number;
  items: Array<{
    id: string;
    quantity: number;
  }>;
}
```

---

#### 3.2 `OrderCancelled`

주문 취소

**발행자**:
- **Channel Adapter**: 외부 채널에서 주문 취소 시
- **WMS**: 재고 부족 등으로 주문 취소 시
- **Main Server**: 고객 주문 취소 시

**구독자**:
- **WMS**: Fulfillment 취소, 재고 예약 해제
- **Channel Adapter**: 채널에 취소 정보 전송
- **Notification**: 주문 취소 알림

---

#### 3.3 `OrderPaymentComplete`

결제 완료

**발행자**: **Main Server** (결제 서비스)

**구독자**:
- **WMS**: 주문 확정 (status: pending → confirmed)
- **Notification**: 결제 완료 알림

**페이로드**: (기존 정의됨)
```typescript
interface OrderPaymentCompletePayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currencyCode: string;
  capturedAt: string;
}
```

---

#### 3.4 `OrderReturnRequested`

반품 요청

**발행자**:
- **Channel Adapter**: 외부 채널 반품 요청
- **Main Server**: 고객 반품 요청

**구독자**:
- **WMS**: 반품 처리 시작
- **Notification**: 반품 요청 알림

---

#### 3.5 `OrderRefundCreated`

환불 생성

**발행자**: **Main Server**

**구독자**:
- **WMS**: 반품 입고 처리 연계
- **Notification**: 환불 완료 알림

---

### 4. `fulfillments.events.v1` ✅ (기존)

**도메인**: 주문 이행/배송
**Aggregate Type**: `Fulfillment`
**파티션 수**: 6
**파일 경로**: `libs/shared/src/streams/fulfillments.stream.ts`

#### 4.1 `FulfillmentCreated`

이행 주문 생성

**발행자**: WMS (Fulfillments Service)

**구독자**:
- **Notification**: 이행 생성 알림 (내부용)

**페이로드**: (기존 정의됨)
```typescript
interface FulfillmentCreatedPayload {
  fulfillmentId: string;
  fulfillmentNo: string;
  orderId: string;
  mode: 'in_house' | '3pl' | 'drop_ship';
  warehouseId?: string;
  items: FulfillmentItem[];
  createdAt: string;
}
```

---

#### 4.2 `FulfillmentReady`

출고 준비 완료 (피킹 완료)

**발행자**: WMS

**구독자**:
- **Notification**: 피킹 완료 알림

---

#### 4.3 `FulfillmentLabeled`

송장 출력 완료

**발행자**: WMS

**구독자**:
- **Channel Adapter**: 채널에 송장 번호 전송 (필수)
- **Notification**: 송장 출력 알림

**페이로드**: (기존 정의됨)
```typescript
interface FulfillmentLabeledPayload {
  fulfillmentId: string;
  orderId: string;
  trackingInfo: {
    carrier: 'CJ' | 'HANJIN' | 'LOTTE' | 'LOGEN' | 'KDEXP' | 'CJGLS';
    trackingNumber: string;
    invoiceUrl?: string;
  };
  labeledAt: string;
}
```

---

#### 4.4 `FulfillmentShipped`

출고 완료 (배송 시작)

**발행자**: WMS

**구독자**:
- **Channel Adapter**: 채널에 배송 시작 알림 (필수)
- **Notification**: 고객에게 배송 시작 알림
- **Main Server**: 주문 상태 업데이트

---

#### 4.5 `FulfillmentDelivered`

배송 완료

**발행자**: WMS (외부 배송 추적 API 연동 시)

**구독자**:
- **Channel Adapter**: 채널에 배송 완료 전송
- **Notification**: 고객에게 배송 완료 알림
- **Main Server**: 주문 완료 처리

---

#### 4.6 `FulfillmentCancelled`

이행 취소

**발행자**: WMS

**구독자**:
- **Channel Adapter**: 채널에 취소 정보 전송
- **Notification**: 이행 취소 알림

**페이로드**: (기존 정의됨)
```typescript
interface FulfillmentCancelledPayload {
  fulfillmentId: string;
  orderId: string;
  reason: 'ORDER_CANCELLED' | 'OUT_OF_STOCK' | 'ADMIN_CANCEL';
  reasonDetail?: string;
  cancelledBy: string;
  cancelledAt: string;
}
```

---

#### 4.7 `FulfillmentReturned`

반품 완료

**발행자**: WMS

**구독자**:
- **Channel Adapter**: 채널에 반품 완료 전송
- **Notification**: 반품 완료 알림

---

### 5. `channel-adapter.events.v1` ✅ (기존)

**도메인**: 채널 어댑터
**Aggregate Type**: `ChannelAdapter`
**파티션 수**: 6
**파일 경로**: `libs/shared/src/streams/adapter.stream.ts`

#### 5.1 `OrderSyncCompleted`

주문 동기화 완료

**발행자**: Channel Adapter

**구독자**:
- **WMS**: 외부 채널 주문을 Sales Order로 생성
- **Notification**: 동기화 완료 알림 (대량 주문 시)

**페이로드**: (기존 정의됨)
```typescript
interface OrderSyncCompletedPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'inbound' | 'outbound';
  orderCount: number;
  orders: InternalOrderEvent[];
  syncDurationMs: number;
  errors?: Array<{ orderId: string; message: string }>;
}
```

---

#### 5.2 `InventorySyncCompleted`

재고 동기화 완료

**발행자**: Channel Adapter

**구독자**:
- **Notification**: 재고 동기화 완료/실패 알림

---

#### 5.3 `CommandExecuted`

채널 커맨드 실행 완료

**발행자**: Channel Adapter

**구독자**:
- **Notification**: 채널 커맨드 실행 결과 알림 (실패 시)

---

#### 5.4 `SyncFailure`

동기화 실패

**발행자**: Channel Adapter

**구독자**:
- **Notification**: 동기화 실패 긴급 알림 (관리자용)

---

#### 5.5 `ChannelStatusChanged`

채널 상태 변경

**발행자**: Channel Adapter

**구독자**:
- **Notification**: 채널 상태 변경 알림

---

### 6. `wms.commands.v1` ⭐ (신규)

**도메인**: WMS 커맨드
**용도**: 비동기 작업 지시
**파티션 수**: 12

#### 6.1 `CreateSalesOrder`

주문 생성 커맨드

**발행자**: Channel Adapter

**처리자**: WMS (Sales Orders Service)

**페이로드**:
```typescript
interface CreateSalesOrderCommand {
  channelOrderId: string;            // 채널 주문 ID
  salesChannel: 'naver' | 'coupang' | 'medusa' | '3pl';
  customer: {
    name?: string;
    email?: string;
    phone?: string;
  };
  shippingAddress: {
    postalCode?: string;
    roadAddress?: string;
    detailAddress?: string;
    recipientName?: string;
    recipientPhone?: string;
  };
  lines: Array<{
    variantId: string;               // PIM 변형 ID
    productName: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
  }>;
  totalAmount?: number;
  shippingFee?: number;
  orderDate: string;                 // ISO 8601
  expiresIn?: number;                // 커맨드 만료 시간 (ms)
}
```

**Zod 스키마**:
```typescript
const CreateSalesOrderCommandSchema = z.object({
  channelOrderId: z.string().min(1),
  salesChannel: z.enum(['naver', 'coupang', 'medusa', '3pl']),
  customer: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  }),
  shippingAddress: z.object({
    postalCode: z.string().optional(),
    roadAddress: z.string().optional(),
    detailAddress: z.string().optional(),
    recipientName: z.string().optional(),
    recipientPhone: z.string().optional(),
  }),
  lines: z.array(z.object({
    variantId: z.string().uuid(),
    productName: z.string().min(1),
    quantity: z.number().int().positive(),
    unitPrice: z.number().int().nonnegative().optional(),
    totalPrice: z.number().int().nonnegative().optional(),
  })),
  totalAmount: z.number().int().nonnegative().optional(),
  shippingFee: z.number().int().nonnegative().optional(),
  orderDate: z.string().datetime(),
  expiresIn: z.number().int().positive().optional(),
});
```

---

#### 6.2 `ReserveStock`

재고 예약 커맨드

**발행자**: WMS (Sales Orders Service)

**처리자**: WMS (Reservation Service)

**페이로드**:
```typescript
interface ReserveStockCommand {
  orderId: string;
  fulfillmentId?: string;
  reservations: Array<{
    skuId: string;
    quantity: number;
    warehouseId?: string;
  }>;
  expiresAt?: string;                // 예약 만료 시각 (ISO 8601)
}
```

---

#### 6.3 `CreateFulfillment`

이행 생성 커맨드

**발행자**: WMS (Sales Orders Service)

**처리자**: WMS (Fulfillments Service)

**페이로드**:
```typescript
interface CreateFulfillmentCommand {
  salesOrderId: string;
  warehouseId?: string;
  ownerId?: string;                  // 3PL용
  shippingAddress?: object;
  lines?: Array<{
    skuId: string;
    quantity: number;
  }>;
}
```

---

#### 6.4 `AdjustInventory`

재고 조정 커맨드

**발행자**: Channel Adapter (수동 조정 요청 시)

**처리자**: WMS (Inventory Service)

**페이로드**:
```typescript
interface AdjustInventoryCommand {
  skuId: string;
  warehouseId: string;
  locationId?: string;
  deltaQuantity: number;             // 증감량 (양수/음수)
  reason: string;
  note?: string;
  adjustedBy: string;
}
```

---

### 7. `pim.commands.v1` ⭐ (신규)

**도메인**: PIM 커맨드
**파티션 수**: 3

#### 7.1 `CreateSKUMapping`

SKU 매핑 생성 커맨드

**발행자**: WMS

**처리자**: PIM

**용도**: WMS에서 SKU 생성 시 PIM에 역동기화

**페이로드**:
```typescript
interface CreateSKUMappingCommand {
  variantId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  createdAt: string;
}
```

---

#### 7.2 `SyncProductToChannels`

채널 상품 동기화 커맨드

**발행자**: PIM

**처리자**: Channel Adapter

**용도**: 상품 정보를 모든 활성 채널에 동기화

**페이로드**:
```typescript
interface SyncProductToChannelsCommand {
  masterId: string;
  targetChannels?: ('naver' | 'coupang' | 'medusa')[];  // 생략 시 모든 채널
  syncType: 'create' | 'update' | 'delete';
}
```

---

## 📋 서비스별 역할 요약

### PIM (Product Information Management)

**발행 토픽**:
- `pim.events.v1`: ProductMasterCreated/Updated, ProductVariantCreated/Updated/Deleted
- `pim.commands.v1`: SyncProductToChannels

**구독 토픽**:
- (선택) `wms.events.v1`: SKU 정보 동기화 (향후 확장)

**주요 역할**:
- 상품 마스터 및 변형 관리
- 상품 정보를 WMS 및 Channel Adapter에 전파

---

### WMS (Warehouse Management System)

**발행 토픽**:
- `inventory.events.v1`: 모든 재고 이벤트 (StockReceived, StockShipped, StockAdjusted 등)
- `fulfillments.events.v1`: 모든 이행 이벤트 (FulfillmentCreated ~ FulfillmentReturned)
- `orders.events.v1`: OrderCancelled (재고 부족 시)

**구독 토픽**:
- `pim.events.v1`: ProductVariantCreated (Product Matching 생성)
- `orders.events.v1`: OrderCreated, OrderPaymentComplete
- `channel-adapter.events.v1`: OrderSyncCompleted
- `wms.commands.v1`: CreateSalesOrder, ReserveStock, CreateFulfillment, AdjustInventory

**주요 역할**:
- 재고 관리 (입고, 출고, 조정, 이동)
- 주문 이행 프로세스 관리
- 상품 매칭 (PIM Variant ↔ WMS SKU)

---

### Channel Adapter

**발행 토픽**:
- `channel-adapter.events.v1`: OrderSyncCompleted, InventorySyncCompleted, CommandExecuted, SyncFailure, ChannelStatusChanged
- `orders.events.v1`: OrderCreated (외부 채널 주문 수신 시)
- `wms.commands.v1`: CreateSalesOrder

**구독 토픽**:
- `inventory.events.v1`: StockReceived, StockShipped, StockAdjusted (재고 동기화)
- `fulfillments.events.v1`: FulfillmentLabeled, FulfillmentShipped, FulfillmentDelivered
- `pim.events.v1`: 모든 Product 이벤트
- `pim.commands.v1`: SyncProductToChannels

**주요 역할**:
- 외부 판매 채널 (네이버, 쿠팡 등)과 양방향 동기화
- 주문 수신 및 WMS로 전달
- 재고/배송 정보를 채널로 전송

---

### Notification

**발행 토픽**: 없음

**구독 토픽**:
- `inventory.events.v1`: StockReceived, StockShipped, StockDamaged, StockLost (알림용)
- `orders.events.v1`: OrderCreated, OrderCancelled, OrderPaymentComplete
- `fulfillments.events.v1`: FulfillmentShipped, FulfillmentDelivered
- `channel-adapter.events.v1`: SyncFailure, ChannelStatusChanged

**주요 역할**:
- 이메일, SMS, 푸시 알림 발송
- 관리자 알림 (재고 이상, 동기화 실패 등)

---

### Main Server

**발행 토픽**:
- `orders.events.v1`: OrderCreated (자체 몰 주문), OrderPaymentComplete, OrderRefundCreated

**구독 토픽**:
- `fulfillments.events.v1`: FulfillmentShipped, FulfillmentDelivered (주문 상태 업데이트)

**주요 역할**:
- 자체 쇼핑몰 주문 생성
- 결제 처리 및 결제 완료 이벤트 발행

---

## 🎯 구현 우선순위

### Phase 1: 핵심 플로우 (최우선)

1. **PIM → WMS 상품 동기화**
   - `pim.events.v1` 스트림 생성
   - ProductVariantCreated 이벤트 발행 (PIM)
   - WMS에서 Product Matching 레코드 생성

2. **Channel Adapter → WMS 주문 생성**
   - `wms.commands.v1` 스트림 생성
   - CreateSalesOrder 커맨드 발행 (Channel Adapter)
   - WMS에서 Sales Order 생성

3. **WMS → Channel Adapter 재고 동기화**
   - StockReceived, StockShipped 이벤트 구독 (Channel Adapter)
   - 채널별 재고 API 호출

4. **WMS → Channel Adapter 배송 정보 동기화**
   - FulfillmentLabeled, FulfillmentShipped 이벤트 구독 (Channel Adapter)
   - 채널별 배송 API 호출

### Phase 2: 확장 기능

5. **Notification 연동**
   - 주요 이벤트 구독
   - 알림 템플릿 구성

6. **역방향 동기화**
   - WMS → PIM: SKU 매핑 정보 전달
   - PIM → Channel Adapter: 상품 정보 자동 등록

### Phase 3: 고도화

7. **에러 처리 및 재시도**
   - DLQ 모니터링
   - 자동 재시도 정책

8. **이벤트 추적 및 모니터링**
   - Correlation ID 전파
   - 이벤트 플로우 시각화

---

## 📝 구현 체크리스트

### Stream 파일 생성

- [ ] `libs/shared/src/streams/pim.stream.ts`
- [ ] `libs/shared/src/streams/wms-commands.stream.ts`
- [ ] `libs/shared/src/streams/pim-commands.stream.ts`

### Outbox 패턴 적용

- [ ] PIM: outbox 테이블 및 dispatcher 생성
- [ ] WMS: 기존 outbox 활용 (이미 존재)
- [ ] Channel Adapter: outbox 테이블 및 dispatcher 생성

### Consumer 구현

- [ ] WMS: PIM 이벤트 핸들러
- [ ] WMS: WMS 커맨드 핸들러
- [ ] Channel Adapter: Inventory/Fulfillment 이벤트 핸들러
- [ ] Notification: 모든 알림 이벤트 핸들러

### 테스트

- [ ] E2E 테스트: PIM → WMS 상품 동기화
- [ ] E2E 테스트: Channel → WMS 주문 생성
- [ ] E2E 테스트: WMS → Channel 재고/배송 동기화

---

## 🔗 참고 문서

- [Events Module README](../libs/events/README.md)
- [Outbox Demo](../apps/outbox-demo/)
- [빠른 시작 가이드](../libs/events/docs/quick-start-guide.md)
- [스키마 검증 가이드](../libs/events/docs/schema-validation-guide.md)
