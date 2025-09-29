# 📡 Channel Adapter 이벤트 상호작용 명세서

이 문서는 Channel Adapter가 송신하거나 수신하는 모든 이벤트의 명세를 정리합니다.

---

## 📥 수신 이벤트 (Inbound Events)

Channel Adapter가 외부 시스템으로부터 소비하는 이벤트들입니다.

### wms.stock.changed

**발행**: WMS  
**소비**: Channel Adapter  
**토픽**: `wms.stock.changed`  
**Consumer**: `StockEventConsumer`

- **payload**
  ```tsx
  {
    sku: string;                    // 상품 SKU
    deltaQty: number;               // 변경량 (+50, -10 등)
    reason: 'INBOUND' | 'OUTBOUND' | 'ADJUSTMENT' | 'DAMAGE'; // 변경 사유
    warehouseId?: string;           // 창고 ID (선택사항)
    eventVersion: number;           // 이벤트 버전 (timestamp)
    occurredAt: string;             // 이벤트 발생 시각 (ISO 8601)
  }
  ```

### wms.fulfillment.updated

**발행**: WMS  
**소비**: Channel Adapter  
**토픽**: `wms.fulfillment.updated`  
**Consumer**: `FulfillmentEventConsumer`

- **payload**
  ```tsx
  {
    orderId: string;                // 내부 주문 ID
    fulfillmentNo: string;          // 이행 번호
    status: 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED'; // 이행 상태
    trackingNo?: string;            // 송장 번호
    carrier?: string;               // 택배사 코드
    shippedAt?: string;             // 출고 시각
    deliveredAt?: string;           // 배송 완료 시각
    eventVersion: number;           // 이벤트 버전
    occurredAt: string;             // 이벤트 발생 시각
  }
  ```

### pim.product.updated

**발행**: PIM  
**소비**: Channel Adapter  
**토픽**: `pim.product.updated`  
**Consumer**: `ProductEventConsumer` (미구현)

- **payload**
  ```tsx
  {
    productId: string;              // 상품 ID
    changes: {
      name?: string;                // 상품명 변경
      price?: number;               // 가격 변경
      description?: string;         // 설명 변경
      categoryId?: string;          // 카테고리 변경
      status?: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED'; // 판매 상태 변경
      images?: string[];            // 이미지 URL 목록
      specifications?: Record<string, any>; // 상품 스펙 정보
    };
    eventVersion: number;           // 이벤트 버전
    occurredAt: string;             // 이벤트 발생 시각
  }
  ```

### wallet.payment.updated

**발행**: Wallet Service  
**소비**: Channel Adapter  
**토픽**: `wallet.payment.updated`  
**Consumer**: `PaymentEventConsumer` (미구현)

- **payload**
  ```tsx
  {
    paymentId: string;              // 결제 ID
    orderId: string;                // 주문 ID
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED'; // 결제 상태
    amount: number;                 // 결제 금액
    currency: string;               // 통화 코드
    paymentMethod: 'CARD' | 'BANK_TRANSFER' | 'VIRTUAL_ACCOUNT' | 'MOBILE'; // 결제 수단
    transactionId?: string;         // 거래 ID
    failureReason?: string;         // 실패 사유
    eventVersion: number;           // 이벤트 버전
    occurredAt: string;             // 이벤트 발생 시각
  }
  ```

### user.profile.updated

**발행**: User Service  
**소비**: Channel Adapter  
**토픽**: `user.profile.updated`  
**Consumer**: `UserEventConsumer` (미구현)

- **payload**
  ```tsx
  {
    userId: string;                 // 사용자 ID
    changes: {
      email?: string;               // 이메일 변경
      phone?: string;               // 전화번호 변경
      name?: string;                // 이름 변경
      address?: {
        postalCode: string;
        roadAddress: string;
        detailAddress: string;
      };
      preferences?: Record<string, any>; // 사용자 선호 설정
    };
    eventVersion: number;           // 이벤트 버전
    occurredAt: string;             // 이벤트 발생 시각
  }
  ```

---

## 📤 발행 이벤트 (Outbound Events)

Channel Adapter가 다른 시스템으로 발행하는 이벤트들입니다.

### channel-adapter.order.sync.completed

**발행**: Channel Adapter  
**소비**: WMS, PIM, Analytics Service  
**토픽**: `channel-adapter.order.sync.completed`

- **payload**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    syncType: 'inbound' | 'outbound'; // 수신/송신 동기화 구분
    orderCount: number;
    orders: InternalOrderEvent[];
    syncDurationMs: number;
    errors?: Array<{
      orderId: string;
      message: string;
    }>;
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### channel-adapter.inventory.sync.completed

**발행**: Channel Adapter  
**소비**: WMS, PIM, Analytics Service  
**토픽**: `channel-adapter.inventory.sync.completed`

- **payload**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    productId: string;
    syncType: 'single' | 'option'; // 단일상품/옵션상품 구분
    stockQuantity: number;
    syncResult: 'success' | 'failed';
    errorMessage?: string;
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### channel-adapter.command.executed

**발행**: Channel Adapter  
**소비**: WMS, Order Service, Analytics Service  
**토픽**: `channel-adapter.command.executed`

- **payload**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    commandType: string; // 'order.confirm', 'dispatch.confirm', 'cancel.approve' 등
    targetId: string; // 대상 주문/상품 ID
    executionResult: 'success' | 'failed';
    processedCount: number;
    failedCount: number;
    errors?: Array<{
      id: string;
      message: string;
    }>;
    executionDurationMs: number;
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### channel-adapter.sync.failure

**발행**: Channel Adapter  
**소비**: Monitoring Service, Alert Service  
**토픽**: `channel-adapter.sync.failure`

- **payload**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    syncType: 'orders' | 'inventory' | 'products' | 'command';
    failureReason: string;
    retryCount: number;
    maxRetries: number;
    nextRetryAt?: string; // ISO datetime
    affectedIds?: string[]; // 실패한 주문/상품 ID들
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### channel-adapter.channel.status.changed

**발행**: Channel Adapter  
**소비**: Monitoring Service, Admin Dashboard  
**토픽**: `channel-adapter.channel.status.changed`

- **payload**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    previousStatus: 'active' | 'inactive' | 'error';
    currentStatus: 'active' | 'inactive' | 'error';
    reason?: string;
    lastSyncAt?: string;
    errorDetails?: {
      message: string;
      code?: string;
      occurredAt: string;
    };
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### order.claim.created

**발행**: Channel Adapter  
**소비**: WMS, Order Service  
**토픽**: `order.claim.created`  
**발행 시점**: 외부 채널에서 클레임 웹훅 수신 시

- **payload**
  ```tsx
  {
    claimId: string; // 클레임 ID
    orderId: string; // 주문 ID
    claimType: 'CANCEL' | 'RETURN' | 'EXCHANGE'; // 클레임 유형
    status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED'; // 클레임 상태
    reason: string; // 클레임 사유
    items: Array<{
      orderItemId: string;
      productId: string;
      quantity: number;
      reason: string;
    }>;
    requestedBy: 'CUSTOMER' | 'ADMIN'; // 요청자
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

### order.claim.updated

**발행**: Channel Adapter  
**소비**: WMS, Order Service  
**토픽**: `order.claim.updated`  
**발행 시점**: 클레임 상태 변경 시

- **payload** (동일한 구조)
  ```tsx
  {
    claimId: string;
    orderId: string;
    claimType: 'CANCEL' | 'RETURN' | 'EXCHANGE';
    status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED';
    reason: string;
    items: Array<{
      orderItemId: string;
      productId: string;
      quantity: number;
      reason: string;
    }>;
    requestedBy: 'CUSTOMER' | 'ADMIN';
    // BaseEventPayload 필드들
    eventId: string;
    eventVersion: number;
    occurredAt: string;
    source: string;
  }
  ```

---

## 🌐 웹훅 이벤트 (Webhook Events)

외부 채널에서 HTTP 웹훅으로 수신하는 이벤트들입니다.

### naver.webhook.order.status.changed

**발행**: 네이버 스마트스토어  
**소비**: Channel Adapter  
**엔드포인트**: `POST /adapter/webhook/naver_smartstore`

- **payload** (네이버 원본 형식)
  ```tsx
  {
    // 네이버 스마트스토어 웹훅 원본 구조
    // Strategy에서 InternalOrderEvent로 변환됨
    orderId: string;
    productOrderId: string;
    orderStatus: string;
    claimStatus?: string;
    lastChangedType: string;
    lastChangedDate: string;
    // ... 기타 네이버 필드들
  }
  ```

### coupang.webhook.order.status.changed

**발행**: 쿠팡  
**소비**: Channel Adapter  
**엔드포인트**: `POST /adapter/webhook/coupang`

- **payload** (쿠팡 원본 형식)
  ```tsx
  {
    // 쿠팡 웹훅 원본 구조
    // Strategy에서 InternalOrderEvent로 변환됨
    orderId: string;
    shipmentBoxId: string;
    status: string;
    timestamp: string;
    // ... 기타 쿠팡 필드들
  }
  ```

### medusa.webhook.order.status.changed

**발행**: Medusa (자체몰)  
**소비**: Channel Adapter  
**엔드포인트**: `POST /adapter/webhook/medusa`

- **payload** (Medusa 원본 형식)
  ```tsx
  {
    // Medusa 웹훅 원본 구조
    // Strategy에서 InternalOrderEvent로 변환됨
    id: string;
    status: string;
    payment_status: string;
    fulfillment_status: string;
    created_at: string;
    updated_at: string;
    // ... 기타 Medusa 필드들
  }
  ```

---

## 🔄 HTTP API 호출 (Synchronous Events)

Channel Adapter가 다른 시스템과 동기적으로 주고받는 API 호출들입니다.

### wms.sales-order.create

**발행**: Channel Adapter  
**소비**: WMS  
**방식**: HTTP POST  
**엔드포인트**: `POST /wms/sales-orders`

- **payload**
  ```tsx
  {
    channelOrderId: string;
    salesChannel: string;
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    shippingAddress: any;
    shippingAddressHash?: string;
    totalAmount?: number;
    shippingFee?: number;
    mergeGroupId?: string;
    orderDate?: string;
    lines: Array<{
      variantId: string;
      productMatchingId?: string;
      productName?: string;
      quantity: number;
      unitPrice?: number;
      totalPrice?: number;
    }>;
  }
  ```

### wms.sales-order.update

**발행**: Channel Adapter  
**소비**: WMS  
**방식**: HTTP PATCH  
**엔드포인트**: `PATCH /wms/sales-orders/{salesChannel}/{channelOrderId}`

- **payload**
  ```tsx
  {
    customer?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    shippingAddress?: any;
    totalAmount?: number;
    status?: string;
  }
  ```

### wms.sales-order.cancel

**발행**: Channel Adapter  
**소비**: WMS  
**방식**: HTTP POST  
**엔드포인트**: `POST /wms/sales-orders/{salesChannel}/{channelOrderId}/cancel`

- **payload**
  ```tsx
  {
    reason: string;
    cancelledAt: string;
  }
  ```

### wms.inventory.availability

**발행**: Channel Adapter  
**소비**: WMS  
**방식**: HTTP GET  
**엔드포인트**: `GET /wms/inventory/availability`

- **query parameters**

  ```tsx
  {
    skus: string[];         // 조회할 SKU 목록
    warehouseId?: string;   // 특정 창고 조회
  }
  ```

- **response**
  ```tsx
  {
    results: Array<{
      sku: string;
      availableQuantity: number;
      reservedQuantity: number;
      totalQuantity: number;
      warehouseId?: string;
    }>;
  }
  ```

---

## 📊 내부 이벤트 변환

Channel Adapter가 외부 이벤트를 내부 표준 형식으로 변환하는 구조입니다.

### InternalOrderEvent

모든 외부 채널의 주문 이벤트가 변환되는 표준 형식입니다.

- **structure**
  ```tsx
  {
    channelType: 'naver_smartstore' | 'coupang' | 'medusa';
    externalOrderId: string;        // 주문번호
    externalProductOrderId?: string; // 상품주문 단위
    status: string;                 // 주문 상태
    lastChangedType?: string;       // 상태 변경 타입
    lastChangedAt?: string;         // 상태 변경 시각
    paymentDate?: string;           // 결제 일시
    quantity: number;               // 주문 수량
    remainQuantity?: number;        // 클레임 후 남은 수량
    priceAmount: number;            // 총 상품 가격
    discountAmount?: number;        // 할인액
    buyer?: {                       // 구매자/수취인 정보
      name?: string;
      contact?: string;
      address?: {
        postalCode?: string;
        roadAddress?: string;
        detailAddress?: string;
      };
    };
    dispatch?: {                    // 배송/발송 정보
      deliveryMethod: string;
      trackingNumber?: string;
      deliveryCompanyCode?: string;
      promiseDeliveryDate?: string;
      dispatchedAt?: string;
    };
    currentClaim?: {                // 진행 중인 클레임
      claimId: string;
      claimType: 'CANCEL' | 'RETURN' | 'EXCHANGE';
      status?: string;
      reason?: string;
      quantity?: number;
      completedDate?: string;
    };
    completedClaims?: Array<{       // 완료된 클레임들
      claimId: string;
      claimType: 'CANCEL' | 'RETURN' | 'EXCHANGE';
      status?: string;
      reason?: string;
      quantity?: number;
      completedDate?: string;
    }>;
    createdAt?: string;             // 외부 기준 생성시각
    updatedAt?: string;             // 외부 기준 업데이트시각
    reason?: string;                // 취소/교환/환불 사유
    claimInfo?: {                   // 교환/환불 정보
      claimId: string;
      claimType: 'CANCEL' | 'RETURN' | 'EXCHANGE';
      status?: string;
      reason?: string;
      quantity?: number;
      completedDate?: string;
    };
    productName?: string;           // 상품명 (WMS 전달용)
  }
  ```

### InternalExchangeEvent

교환 관련 이벤트의 표준 형식입니다.

- **structure**
  ```tsx
  {
    eventId: string;
    eventType: 'exchange_created' | 'exchange_updated' | 'exchange_completed' | 'exchange_rejected';
    claimId: string;                // 내부 표준 클레임 ID
    orderId: string;                // 내부 표준 주문 ID
    channel: 'naver_smartstore' | 'coupang' | 'medusa';
    externalClaimId: string;        // 외부 채널의 원본 교환 ID
    externalOrderId: string;        // 외부 채널의 원본 주문 ID
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
    faultType: 'SELLER' | 'CUSTOMER' | 'DELIVERY' | 'PRODUCT_DEFECT' | 'OTHER';
    reason: string;                 // 교환 사유
    reasonCode?: string;            // 표준화된 사유 코드
    exchangeItems: Array<{
      originalItemId: string;
      originalItemName: string;
      targetItemId?: string;
      targetItemName?: string;
      quantity: number;
      unitPrice: number;
    }>;
    deliveryInfo?: {
      returnAddress?: {
        customerName: string;
        address: string;
        phone: string;
      };
      deliveryAddress?: {
        customerName: string;
        address: string;
        phone: string;
      };
      collectStatus?: 'PENDING' | 'COLLECTED' | 'COMPLETED';
      deliveryStatus?: 'PENDING' | 'SHIPPED' | 'DELIVERED';
    };
    createdAt: string;
    updatedAt: string;
    metadata?: {
      originalPayload?: any;
      processingNotes?: string[];
      channelSpecificData?: Record<string, any>;
    };
  }
  ```

### InternalReturnEvent

반품 관련 이벤트의 표준 형식입니다.

- **structure**
  ```tsx
  {
    eventId: string;
    eventType: 'return_created' | 'return_updated' | 'return_completed' | 'return_rejected';
    claimId: string;                // 내부 표준 클레임 ID
    orderId: string;                // 내부 표준 주문 ID
    channel: 'naver_smartstore' | 'coupang' | 'medusa';
    externalClaimId: string;
    externalOrderId: string;
    status: 'PENDING' | 'APPROVED' | 'COLLECTED' | 'COMPLETED' | 'REJECTED';
    faultType: 'SELLER' | 'CUSTOMER' | 'DELIVERY' | 'PRODUCT_DEFECT' | 'OTHER';
    reason: string;
    reasonCode?: string;
    returnItems: Array<{
      orderItemId: string;
      itemName: string;
      quantity: number;
      unitPrice: number;
      returnQuantity: number;
    }>;
    collectionInfo?: {
      collectionType: 'CUSTOMER_DIRECT' | 'PICKUP_REQUEST' | 'DROP_OFF';
      trackingNumber?: string;
      carrierCode?: string;
      collectedAt?: string;
    };
    createdAt: string;
    updatedAt: string;
    metadata?: {
      originalPayload?: any;
      processingNotes?: string[];
      channelSpecificData?: Record<string, any>;
    };
  }
  ```

---

## 🎯 이벤트 흐름 요약

### 1. 주문 생성 플로우

```
External Channel → Webhook → Channel Adapter → WMS API → WMS
                                    ↓
                            order.sync.completed Event
```

### 2. 재고 업데이트 플로우

```
WMS → stock.changed Event → Channel Adapter → External Channel APIs
                                    ↓
                          inventory.sync.completed Event
```

### 3. 이행 상태 업데이트 플로우

```
WMS → fulfillment.updated Event → Channel Adapter → External Channel APIs
                                         ↓
                                command.executed Event
```

### 4. 클레임 처리 플로우

```
External Channel → Webhook → Channel Adapter → order.claim.created Event → WMS, Order Service
                                    ↓
                            command.executed Event (채널 응답 처리 시)
```

---

**최종 업데이트**: 2025-09-25  
**버전**: 1.0.0  
**작성자**: Channel Adapter Team
