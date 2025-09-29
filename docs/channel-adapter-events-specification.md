# 📡 Channel Adapter 이벤트 명세서

## 📋 개요

Channel Adapter는 WMS와 외부 판매채널(네이버 스마트스토어, 쿠팡, 메두사) 간의 이벤트 기반 통신을 중계하는 서비스입니다. 이 문서는 어댑터가 처리하는 모든 이벤트의 명세를 정의합니다.

### 🎯 핵심 원칙

- **SoT (Source of Truth) 원칙**: 데이터 소유권에 따른 이벤트 방향 결정
- **멱등성 보장**: `idempotencyKey`를 통한 중복 처리 방지
- **약한 일관성**: 부분 성공 허용, DLQ를 통한 실패 관리
- **이벤트 기반 아키텍처**: 느슨한 결합을 통한 확장성 확보

---

## 🔄 이벤트 흐름 다이어그램

```
WMS ──────────────────────► Channel Adapter ──────────────────────► External Channels
    │                                    │                                    │
    │ ① Stock Changed Event              │ ② Inventory Sync                   │
    │ ② Fulfillment Updated Event        │ ③ Order Status Sync                │
    │                                    │ ④ Command Execution                │
    │                                    │                                    │
    │ ⑤ Order Creation (HTTP)            │ ⑤ WMS API Calls                   │
    │ ⑥ Order Updates (HTTP)             │ ⑥ Synchronous Requests             │
    └────────────────────────────────────┘                                    │
                                                                               │
Channel Adapter ◄──────────────────────────────────────────────────────────┘
    │
    │ ⑦ Event Publishing (Success/Failure)
    ▼
Kafka Topics
```

---

## 📥 수신 이벤트 (Inbound Events)

### 1. WMS 재고 변경 이벤트

**토픽**: `wms.stock.changed`  
**Consumer**: `StockEventConsumer`

```typescript
interface StockChangedEvent {
  sku: string; // 상품 SKU
  deltaQty: number; // 변경량 (+50, -10 등)
  reason: 'INBOUND' | 'OUTBOUND' | 'ADJUSTMENT' | 'DAMAGE';
  warehouseId?: string; // 창고 ID
  eventVersion: number; // 이벤트 버전 (타임스탬프)
  occurredAt: string; // 발생 시각 (ISO 8601)
}
```

**처리 로직**:

1. 멱등키 체크 (`WMS:STOCK_CHANGED:${sku}:${eventVersion}`)
2. 현재 재고 계산
3. 모든 채널에 재고 동기화 (네이버, 쿠팡)
4. 필수 채널 성공 시 멱등키 처리 완료

**재시도 정책**:

- 최대 재시도: 3회
- 백오프: [1000ms, 5000ms, 30000ms]
- DLQ: `channel-adapter.stock.dlq`

---

### 2. WMS 이행 상태 업데이트 이벤트

**토픽**: `wms.fulfillment.updated`  
**Consumer**: `FulfillmentEventConsumer`

```typescript
interface FulfillmentUpdatedEvent {
  orderId: string; // 내부 주문 ID
  fulfillmentNo: string; // 이행 번호
  status: 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'RETURNED';
  trackingNo?: string; // 송장 번호
  carrier?: string; // 택배사 코드
  shippedAt?: string; // 출고 시각
  deliveredAt?: string; // 배송 완료 시각
  eventVersion: number; // 이벤트 버전
  occurredAt: string; // 발생 시각
}
```

**처리 로직**:

1. 멱등키 체크 (`WMS:FULFILLMENT_UPDATED:${orderId}:${eventVersion}`)
2. 이행 정보 내부 형식으로 변환
3. 상태별 특별 처리 (출고완료, 배송완료, 반품 등)
4. 모든 채널에 이행 상태 동기화
5. 필수 채널 성공 시 멱등키 처리 완료

**상태별 매핑**:

- `PREPARING` → 출고 준비 중
- `SHIPPED` → 출고 완료 (송장번호 필수)
- `DELIVERED` → 배송 완료
- `RETURNED` → 반품 처리

**재시도 정책**:

- 최대 재시도: 3회
- 백오프: [2000ms, 10000ms, 60000ms] (이행 정보는 더 긴 간격)
- DLQ: `channel-adapter.fulfillment.dlq`

---

## 📤 발행 이벤트 (Outbound Events)

### 1. 주문 동기화 완료 이벤트

**토픽**: `channel-adapter.order.sync.completed`

```typescript
interface OrderSyncCompletedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'inbound' | 'outbound'; // 수신/송신 동기화 구분
  orderCount: number; // 처리된 주문 수
  orders: InternalOrderEvent[]; // 동기화된 주문 목록
  syncDurationMs: number; // 동기화 소요 시간
  errors?: Array<{
    // 실패한 주문들
    orderId: string;
    message: string;
  }>;
}
```

**발행 시점**:

- 채널에서 주문 정보 수신 완료 시
- WMS로 주문 정보 전송 완료 시

---

### 2. 재고 동기화 완료 이벤트

**토픽**: `channel-adapter.inventory.sync.completed`

```typescript
interface InventorySyncCompletedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  productId: string; // 상품 ID
  syncType: 'single' | 'option'; // 단일상품/옵션상품 구분
  stockQuantity: number; // 동기화된 재고 수량
  syncResult: 'success' | 'failed'; // 동기화 결과
  errorMessage?: string; // 실패 시 오류 메시지
}
```

**발행 시점**:

- WMS 재고 변경 이벤트 처리 완료 시
- 채널별 재고 동기화 완료 시

---

### 3. 명령 실행 완료 이벤트

**토픽**: `channel-adapter.command.executed`

```typescript
interface CommandExecutedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  commandType: string; // 'order.confirm', 'dispatch.confirm' 등
  targetId: string; // 대상 주문/상품 ID
  executionResult: 'success' | 'failed';
  processedCount: number; // 처리 성공 수
  failedCount: number; // 처리 실패 수
  errors?: Array<{
    id: string;
    message: string;
  }>;
  executionDurationMs: number; // 실행 소요 시간
}
```

**발행 시점**:

- 채널별 비즈니스 명령 실행 완료 시
- 배치 처리 작업 완료 시

---

### 4. 동기화 실패 알림 이벤트

**토픽**: `channel-adapter.sync.failure`

```typescript
interface SyncFailurePayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  syncType: 'orders' | 'inventory' | 'products' | 'command';
  failureReason: string; // 실패 사유
  retryCount: number; // 현재 재시도 횟수
  maxRetries: number; // 최대 재시도 횟수
  nextRetryAt?: string; // 다음 재시도 시각 (ISO datetime)
  affectedIds?: string[]; // 실패한 주문/상품 ID들
}
```

**발행 시점**:

- 재시도 한도 초과 시
- DLQ로 메시지 전송 시
- 임계치 초과 실패 감지 시

---

### 5. 채널 상태 변경 이벤트

**토픽**: `channel-adapter.channel.status.changed`

```typescript
interface ChannelStatusChangedPayload extends BaseEventPayload {
  channelType: 'naver_smartstore' | 'coupang' | 'medusa';
  previousStatus: 'active' | 'inactive' | 'error';
  currentStatus: 'active' | 'inactive' | 'error';
  reason?: string; // 상태 변경 사유
  lastSyncAt?: string; // 마지막 동기화 시각
  errorDetails?: {
    message: string;
    code?: string;
    occurredAt: string;
  };
}
```

**발행 시점**:

- 채널 연결 상태 변경 시
- API 호출 실패율 임계치 초과 시
- 수동 채널 비활성화/활성화 시

---

## 🔄 동기 요청 (HTTP API Calls)

### WMS API 호출

어댑터는 다음과 같은 경우 WMS에 동기 HTTP 요청을 보냅니다:

#### 1. 주문 생성

```http
POST /wms/sales-orders
Content-Type: application/json

{
  "salesChannel": "coupang",
  "channelOrderId": "ORDER-123",
  "orderData": { ... }
}
```

#### 2. 주문 업데이트

```http
PATCH /wms/sales-orders/{salesChannel}/{channelOrderId}
Content-Type: application/json

{
  "status": "CONFIRMED",
  "updatedData": { ... }
}
```

#### 3. 주문 취소

```http
POST /wms/sales-orders/{salesChannel}/{channelOrderId}/cancel
Content-Type: application/json

{
  "reason": "고객 요청",
  "cancelledAt": "2025-09-25T12:34:56Z"
}
```

---


### 처리 상태 관리

```typescript
// 처리 완료 마킹
await idempotencyService.markProcessed({
  idempotencyKey,
  source: 'WMS',
  eventType: 'STOCK_CHANGED',
  resourceId: 'SKU-123',
  eventVersion: '1695462345000'
});

// 처리 실패 마킹 (재시도 가능)
await idempotencyService.markFailed(
  idempotencyKey,
  errorMessage,
  isRetryable: true
);
```

---

## 📊 DLQ (Dead Letter Queue) 관리

### DLQ 토픽 구조

- `channel-adapter.stock.dlq` - 재고 이벤트 처리 실패
- `channel-adapter.fulfillment.dlq` - 이행 이벤트 처리 실패
- `channel-adapter.wms-api.dlq` - WMS API 호출 실패

### DLQ 메시지 형식

```typescript
interface DLQMessage {
  originalTopic: string; // 원본 토픽명
  originalEvent: any; // 원본 이벤트 데이터
  lastError: {
    message: string;
    stack: string;
  };
  retryCount: number; // 재시도 횟수
  failedAt: string; // 실패 시각
  consumer: string; // 처리한 Consumer 이름
}
```

### DLQ 모니터링

- **임계치 모니터링**: 시간당 DLQ 메시지 수가 설정값 초과 시 알림
- **수동 재처리**: 관리자가 특정 DLQ 메시지를 수동으로 재처리 가능
- **자동 정리**: 일정 기간 경과 후 DLQ 메시지 자동 삭제

---

## 🎯 채널별 특화 처리

### 네이버 스마트스토어

**특징**:

- `productOrderId` 기반 상품별 주문 관리
- 클레임 상태가 복잡함 (CANCEL, RETURN, EXCHANGE)
- 배송비 정책이 복잡함

**이벤트 매핑**:

- 주문 상태: `PAY_WAITING` → `PENDING`, `PAYED` → `CONFIRMED`
- 클레임 상태: `CANCEL_REQUEST` → `CANCEL_PENDING`

### 쿠팡

**특징**:

- `shipmentBoxId` 기반 배송단위 관리
- 약속 배송일(`promiseDeliveryDate`) 관리 필수
- 출고 지연 시 별도 API 호출 필요

**이벤트 매핑**:

- 주문 상태: `ACCEPT_REQUIRED` → `PENDING`, `ACCEPTED` → `CONFIRMED`
- 배송 상태: `SHIPPED` → `SHIPPED` (송장번호 필수)

### 메두사 (자체몰)

**특징**:

- 직접 DB 연동으로 실시간 처리
- 복잡한 프로모션 및 할인 로직
- 고객 맞춤 배송 옵션

---

## 🔧 설정 및 환경변수

### 필수 환경변수

```bash
# 필수 채널 목록 (쉼표로 구분)
ADAPTER_REQUIRED_CHANNELS=coupang,naver_smartstore

# DLQ 임계치 설정
DLQ_THRESHOLD_PER_HOUR=10
DLQ_ALERT_ENABLED=true

# 재시도 정책 설정
STOCK_RETRY_MAX=3
FULFILLMENT_RETRY_MAX=3
WMS_API_RETRY_MAX=5

# Kafka 설정
KAFKA_BROKERS=localhost:9092
KAFKA_GROUP_ID=channel-adapter
```

### 채널별 API 설정

```bash
# 네이버 스마트스토어
NAVER_CLIENT_ID=your_client_id
NAVER_CLIENT_SECRET=your_client_secret

# 쿠팡
COUPANG_ACCESS_KEY=your_access_key
COUPANG_SECRET_KEY=your_secret_key
COUPANG_VENDOR_ID=your_vendor_id

# WMS API
WMS_BASE_URL=http://localhost:3001
WMS_API_TIMEOUT=30000
```

---

## 📈 모니터링 및 알림

### 핵심 메트릭

1. **이벤트 처리량**
   - 초당 처리된 이벤트 수
   - 채널별 이벤트 분포

2. **성공률**
   - 전체 이벤트 처리 성공률
   - 채널별 동기화 성공률

3. **지연시간**
   - 이벤트 수신부터 처리 완료까지 소요 시간
   - WMS API 호출 응답 시간

4. **오류율**
   - DLQ 메시지 발생률
   - 재시도 발생률

### 알림 조건

- DLQ 메시지가 시간당 임계치 초과
- 특정 채널의 성공률이 90% 미만
- WMS API 응답 시간이 10초 초과
- 멱등키 충돌 발생

---

## 🚀 확장 계획

### 단기 계획

1. **배치 처리 최적화**
   - 재고 동기화 배치 처리
   - 주문 상태 업데이트 배치 처리

2. **캐시 도입**
   - 상품 정보 캐시
   - 채널별 설정 캐시

### 중기 계획

1. **새로운 채널 추가**
   - 11번가, G마켓 등
   - Strategy 패턴으로 확장 용이

2. **실시간 대시보드**
   - 채널별 실시간 상태 모니터링
   - 이벤트 흐름 시각화

### 장기 계획

1. **AI 기반 예측**
   - 재고 부족 예측
   - 주문량 예측

2. **완전 자동화**
   - 자동 재고 조정
   - 자동 가격 최적화

---

## 📚 참고 자료

- [WMS 이벤트 명세서](../WMS/docs/wms-events-specification.md)
- [네이버 커머스 API 문서](https://developers.naver.com/docs/commerce/)
- [쿠팡 파트너 API 문서](https://developers.coupangcorp.com/)
- [Kafka 설정 가이드](./kafka-configuration.md)

---

**최종 업데이트**: 2025-09-25  
**버전**: 1.0.0  
**작성자**: Channel Adapter Team
