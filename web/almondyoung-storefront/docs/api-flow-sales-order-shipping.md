# 주문 조회 및 배송 추적 API 가이드

> 쇼핑몰 Front Office (고객용 마이페이지) 구현 시 참고용

## 📋 개요

이 문서는 WMS 시스템의 주문(Sales Order) 조회부터 배송 추적까지의 API 흐름을 설명합니다.

### 데이터 흐름 요약

```
Sales Order (SO) → Fulfillment Order (FO) → Invoice → 배송 추적
     ↓                    ↓                   ↓           ↓
  주문 정보         출고 처리 상태        송장 번호    택배사 추적
```

---

## 🗂️ 1. 주문 목록 조회

### `GET /sales-orders`

고객의 주문 목록을 조회합니다.

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `startDate` | string | ❌ | 조회 시작일 (YYYY-MM-DD) |
| `endDate` | string | ❌ | 조회 종료일 (YYYY-MM-DD) |
| `channel` | string | ❌ | 판매 채널 (`medusa`, `naver`, `coupang`, `3pl`) |
| `status` | string | ❌ | 주문 상태 필터 |
| `limit` | number | ❌ | 조회 개수 (기본값: 20) |
| `offset` | number | ❌ | 건너뛸 개수 (기본값: 0) |

#### 주문 상태 (`status`)

| 상태 | 설명 | 고객에게 표시할 문구 예시 |
|------|------|-------------------------|
| `pending` | 주문 접수 | 주문 접수 완료 |
| `confirmed` | 주문 확정 | 상품 준비중 |
| `processing` | 처리중 | 상품 준비중 |
| `shipped` | 발송 완료 | 배송중 |
| `delivered` | 배송 완료 | 배송 완료 |
| `cancelled` | 주문 취소 | 주문 취소됨 |
| `timeout` | 시간 초과 | 주문 처리 실패 |

#### Response 예시

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "channelOrderId": "ORD-2024-001234",
    "salesChannel": "medusa",
    "status": "shipped",
    "customerName": "홍길동",
    "customerEmail": "hong@example.com",
    "customerPhone": "010-1234-5678",
    "shippingAddress": {
      "recipientName": "홍길동",
      "phone": "010-1234-5678",
      "postalCode": "06234",
      "roadAddress": "서울시 강남구 테헤란로 123",
      "detailAddress": "456호"
    },
    "totalAmount": 45000,
    "shippingFee": 3000,
    "orderDate": "2024-12-08T10:30:00Z",
    "confirmedAt": "2024-12-08T11:00:00Z",
    "processedAt": "2024-12-08T14:00:00Z",
    "createdAt": "2024-12-08T10:30:00Z",
    "updatedAt": "2024-12-08T14:00:00Z",
    "lines": [
      {
        "id": "line-001",
        "salesOrderId": "550e8400-e29b-41d4-a716-446655440000",
        "variantId": "variant-abc",
        "productName": "프리미엄 티셔츠 (블랙/L)",
        "quantity": 2,
        "unitPrice": 22500,
        "totalPrice": 45000,
        "status": "stock_deducted"
      }
    ]
  }
]
```

---

## 📦 2. 주문 상세 조회

### `GET /sales-orders/:id`

특정 주문의 상세 정보를 조회합니다.

#### Path Parameters

| 파라미터 | 설명 |
|---------|------|
| `id` | 판매 주문 ID (UUID) |

#### Response

주문 목록 조회의 단일 항목과 동일한 구조입니다.

#### 프론트엔드 사용 예시

```typescript
// 주문 상세 조회
const order = await fetch(`/api/sales-orders/${orderId}`).then(r => r.json());

// 배송 정보 표시를 위해 Fulfillment 조회 필요
if (order.status === 'shipped' || order.status === 'delivered') {
  const fulfillments = await fetch(`/api/fulfillments?salesOrderId=${orderId}`);
}
```

---

## 🚚 3. 출고/배송 처리 조회 (Fulfillment Order)

### `GET /fulfillments`

출고 처리 목록을 조회합니다.

#### Query Parameters

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| `limit` | number | ❌ | 조회 개수 (기본값: 20) |
| `offset` | number | ❌ | 건너뛸 개수 (기본값: 0) |

> **Note**: `salesOrderId`로 필터링하려면 서버 측 구현 추가 필요

### `GET /fulfillments/:id`

특정 출고 주문의 상세 정보를 조회합니다.

#### Fulfillment 상태 (`status`)

| 상태 | 설명 | 고객에게 표시할 문구 예시 |
|------|------|-------------------------|
| `created` | 생성됨 | 상품 준비중 |
| `reserving` | 재고 예약중 | 상품 준비중 |
| `ready` | 준비 완료 | 상품 준비 완료 |
| `allocated` | 할당됨 | 출고 준비중 |
| `picking` | 피킹중 | 출고 준비중 |
| `picked` | 피킹 완료 | 출고 준비 완료 |
| `inspecting` | 검수중 | 검수중 |
| `invoiced` | 송장 발급됨 | 배송 준비중 |
| `shipped` | 발송됨 | 배송중 |
| `completed` | 완료됨 | 배송 완료 |
| `canceled` | 취소됨 | 주문 취소됨 |

#### Response 예시

```json
{
  "id": "fo-550e8400-e29b-41d4-a716-446655440000",
  "salesOrderId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "shipped",
  "priority": "normal",
  "totalItems": 1,
  "totalQty": 2,
  "totalReservedQty": 2,
  "shippingAddress": {
    "recipientName": "홍길동",
    "phone": "010-1234-5678",
    "postalCode": "06234",
    "roadAddress": "서울시 강남구 테헤란로 123",
    "detailAddress": "456호"
  },
  "allocatedAt": "2024-12-08T12:00:00Z",
  "shippedAt": "2024-12-08T15:00:00Z",
  "createdAt": "2024-12-08T11:00:00Z",
  "updatedAt": "2024-12-08T15:00:00Z",
  "invoice": {
    "id": "inv-001",
    "invoiceNumber": "6123456789012",
    "status": "shipped",
    "carrierCode": "CJ",
    "issueMethod": "goodsflow"
  }
}
```

---

## 📮 4. 송장 상세 조회

### `GET /invoices/:id`

송장 상세 정보를 조회합니다.

#### Response 예시

```json
{
  "id": "inv-001",
  "fulfillmentOrderId": "fo-550e8400-e29b-41d4-a716-446655440000",
  "invoiceNumber": "6123456789012",
  "carrierCode": "CJ",
  "issueMethod": "goodsflow",
  "status": "shipped",
  "issuedAt": "2024-12-08T14:30:00Z",
  "printedAt": "2024-12-08T14:35:00Z",
  "shippedAt": "2024-12-08T15:00:00Z",
  "items": []
}
```

#### Invoice 상태 (`status`)

| 상태 | 설명 |
|------|------|
| `issued` | 송장 발급됨 |
| `printed` | 송장 출력됨 |
| `shipped` | 발송됨 |
| `canceled` | 취소됨 |

#### 택배사 코드 (`carrierCode`)

| 코드 | 택배사 |
|------|--------|
| `CJ` | CJ대한통운 |
| `HANJIN` | 한진택배 |
| `LOTTE` | 롯데택배 |
| `POST` | 우체국 |
| `LOGEN` | 로젠택배 |

---

## 🔍 5. 배송 추적

### `GET /invoices/:id/track`

송장의 배송 추적 정보를 조회합니다.

> **Note**: Goodsflow를 통해 발급된 송장(`issueMethod: 'goodsflow'`)만 추적 가능합니다.

#### Response 예시

```json
{
  "status": "IN_TRANSIT",
  "currentLocation": "서울 송파 터미널",
  "estimatedDelivery": "2024-12-09",
  "history": [
    {
      "status": "PICKED_UP",
      "location": "서울 강남 집하장",
      "timestamp": "2024-12-08T15:00:00Z",
      "description": "물품 접수"
    },
    {
      "status": "IN_TRANSIT",
      "location": "서울 송파 터미널",
      "timestamp": "2024-12-08T18:00:00Z",
      "description": "배송중 - 터미널 도착"
    }
  ]
}
```

---

## 🎯 프론트엔드 구현 가이드

### 고객 마이페이지 - 주문 목록

```typescript
interface OrderListItem {
  id: string;
  channelOrderId: string;
  status: string;
  totalAmount: number;
  orderDate: string;
  productSummary: string; // e.g., "프리미엄 티셔츠 외 2건"
}

// 주문 목록 조회
async function fetchMyOrders(page: number = 1, limit: number = 10) {
  const offset = (page - 1) * limit;
  const response = await fetch(`/api/sales-orders?limit=${limit}&offset=${offset}`);
  return response.json();
}
```

### 고객 마이페이지 - 주문 상세 + 배송 정보

```typescript
interface OrderDetail {
  order: SalesOrder;
  shipping: {
    status: string;
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
  } | null;
}

async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
  // 1. 주문 상세 조회
  const order = await fetch(`/api/sales-orders/${orderId}`).then(r => r.json());
  
  // 2. 배송 정보가 필요한 상태인지 확인
  if (!['shipped', 'delivered', 'processing'].includes(order.status)) {
    return { order, shipping: null };
  }
  
  // 3. Fulfillment 조회 (주문에 연결된 FO 찾기)
  const fulfillments = await fetch(`/api/fulfillments?limit=100`).then(r => r.json());
  const fo = fulfillments.find(f => f.salesOrderId === orderId);
  
  if (!fo?.invoice) {
    return { order, shipping: null };
  }
  
  // 4. 배송 정보 구성
  return {
    order,
    shipping: {
      status: fo.status,
      carrier: fo.invoice.carrierCode,
      trackingNumber: fo.invoice.invoiceNumber,
      trackingUrl: getTrackingUrl(fo.invoice.carrierCode, fo.invoice.invoiceNumber)
    }
  };
}

// 택배사별 추적 URL 생성
function getTrackingUrl(carrier: string, trackingNumber: string): string {
  const urls = {
    'CJ': `https://www.cjlogistics.com/ko/tool/parcel/tracking?gnbInvcNo=${trackingNumber}`,
    'HANJIN': `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mession=&wblnum=${trackingNumber}`,
    'LOTTE': `https://www.lotteglogis.com/home/reservation/tracking/index?InvNo=${trackingNumber}`,
    'POST': `https://service.epost.go.kr/trace.RetrieveDomRi498.postal?sid1=${trackingNumber}`,
    'LOGEN': `https://www.ilogen.com/web/personal/trace/${trackingNumber}`
  };
  return urls[carrier] || '';
}
```

### 주문 상태별 UI 표시

```typescript
function getOrderStatusDisplay(status: string): { text: string; color: string; icon: string } {
  const statusMap = {
    pending: { text: '주문 접수', color: 'gray', icon: '📋' },
    confirmed: { text: '상품 준비중', color: 'blue', icon: '📦' },
    processing: { text: '출고 준비중', color: 'blue', icon: '🏭' },
    shipped: { text: '배송중', color: 'orange', icon: '🚚' },
    delivered: { text: '배송 완료', color: 'green', icon: '✅' },
    cancelled: { text: '주문 취소', color: 'red', icon: '❌' },
    timeout: { text: '주문 실패', color: 'red', icon: '⚠️' }
  };
  return statusMap[status] || { text: status, color: 'gray', icon: '❓' };
}
```

---

## 📱 API 호출 흐름 다이어그램

```
┌─────────────────┐
│   고객 로그인    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ GET /sales-orders│  ← 주문 목록
└────────┬────────┘
         │ (주문 선택)
         ▼
┌─────────────────────┐
│ GET /sales-orders/:id│  ← 주문 상세
└────────┬────────────┘
         │
         ▼
┌────────────────────┐
│ GET /fulfillments   │  ← FO 조회 (salesOrderId로 필터)
└────────┬───────────┘
         │ (invoice 확인)
         ▼
┌──────────────────────┐
│ GET /invoices/:id/track│  ← 배송 추적
└──────────────────────┘
```

---

## ⚠️ 주의사항

1. **배송 추적은 Goodsflow 송장만 지원**
   - `invoice.issueMethod === 'goodsflow'`인 경우만 `/invoices/:id/track` API 사용 가능
   - 그 외의 경우 택배사 직접 추적 URL 사용 권장

2. **Fulfillment → Sales Order 연결**
   - Fulfillment Order는 `salesOrderId` 필드로 Sales Order와 연결됨
   - 하나의 SO에 여러 FO가 생성될 수 있음 (분할 출고 시)

3. **Invoice 상태 체크**
   - FO 조회 시 `invoice` 필드가 포함됨
   - Invoice가 없으면 아직 송장 발급 전 상태

4. **페이지네이션**
   - 목록 API는 `limit`, `offset` 파라미터로 페이지네이션 지원
   - 기본값: `limit=20`, `offset=0`

---

## 🔗 관련 API 엔드포인트 요약

| 목적 | Method | Endpoint |
|------|--------|----------|
| 주문 목록 | GET | `/sales-orders` |
| 주문 상세 | GET | `/sales-orders/:id` |
| 출고 목록 | GET | `/fulfillments` |
| 출고 상세 | GET | `/fulfillments/:id` |
| 송장 상세 | GET | `/invoices/:id` |
| 배송 추적 | GET | `/invoices/:id/track` |

