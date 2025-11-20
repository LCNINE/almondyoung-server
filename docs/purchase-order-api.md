# Purchase Order API 문서

## 개요

Purchase Order API는 발주(Purchase Order) 관리 및 발주대기리스트(Cart) 관리를 위한 RESTful API입니다.

**Base URL**: `/wms/purchase-orders`

---

## 목차

1. [발주대기리스트 (Cart) 관리](#발주대기리스트-cart-관리)
2. [발주 관리](#발주-관리)
3. [재주문 제안](#재주문-제안)
4. [Audit Workflow](#audit-workflow)
5. [데이터 모델](#데이터-모델)
6. [에러 처리](#에러-처리)

---

## 발주대기리스트 (Cart) 관리

### 1. 발주대기리스트에 아이템 추가

발주대기리스트에 새로운 아이템을 추가합니다.

**Endpoint**: `POST /wms/purchase-orders/cart`

**Request Body**:

```json
{
  "skuId": "uuid",
  "quantity": 100,
  "type": "domestic",
  "supplierInfo": {}
}
```

**Request Schema**:

- `skuId` (string, required): SKU ID (UUID)
- `quantity` (number, required): 수량 (양수)
- `type` (enum, required): 발주 유형 (`domestic` | `foreign`)
- `supplierInfo` (object, optional): 공급업체 정보

**Response**: `201 Created`

```json
{
  "id": "uuid",
  "skuId": "uuid",
  "quantity": 100,
  "type": "domestic",
  "supplierInfo": {},
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "sku": {
    "name": "상품명",
    "barcode": "1234567890"
  }
}
```

---

### 2. 발주대기리스트 조회

발주대기리스트의 모든 아이템을 조회합니다.

**Endpoint**: `GET /wms/purchase-orders/cart`

**Query Parameters**:

- `type` (enum, optional): 발주 유형 필터 (`domestic` | `foreign`)

**Response**: `200 OK`

```json
[
  {
    "id": "uuid",
    "skuId": "uuid",
    "quantity": 100,
    "type": "domestic",
    "supplierInfo": {},
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "sku": {
      "name": "상품명",
      "barcode": "1234567890"
    }
  }
]
```

---

### 3. 발주대기리스트 아이템 수정

발주대기리스트의 특정 아이템을 수정합니다.

**Endpoint**: `PUT /wms/purchase-orders/cart/:itemId`

**Path Parameters**:

- `itemId` (string): 발주대기리스트 아이템 ID

**Request Body**:

```json
{
  "quantity": 150,
  "supplierInfo": {}
}
```

**Request Schema**:

- `quantity` (number, required): 수량 (양수)
- `supplierInfo` (object, optional): 공급업체 정보

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "skuId": "uuid",
  "quantity": 150,
  "type": "domestic",
  "supplierInfo": {},
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "sku": {
    "name": "상품명",
    "barcode": "1234567890"
  }
}
```

---

### 4. 발주대기리스트에서 아이템 제거

발주대기리스트에서 특정 아이템을 제거합니다.

**Endpoint**: `DELETE /wms/purchase-orders/cart/:itemId`

**Path Parameters**:

- `itemId` (string): 발주대기리스트 아이템 ID

**Response**: `204 No Content`

---

### 5. 발주대기리스트 비우기

발주대기리스트의 모든 아이템을 제거합니다.

**Endpoint**: `DELETE /wms/purchase-orders/cart`

**Query Parameters**:

- `type` (enum, optional): 발주 유형 필터 (`domestic` | `foreign`). 지정 시 해당 유형만 삭제

**Response**: `204 No Content`

---

## 발주 관리

### 1. 발주 생성

새로운 발주를 생성합니다.

**Endpoint**: `POST /wms/purchase-orders`

**Request Body**:

```json
{
  "type": "domestic",
  "supplierId": "uuid",
  "expectedArrival": "2024-01-15T00:00:00.000Z",
  "destinationWarehouseId": "uuid",
  "lines": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "unitPrice": 10000
    }
  ]
}
```

**Request Schema**:

- `type` (enum, required): 발주 유형 (`domestic` | `foreign`)
- `supplierId` (string, required): 공급업체 ID (UUID)
- `expectedArrival` (string, optional): 입고 예정일 (ISO 8601)
- `destinationWarehouseId` (string, required): 목적지 창고 ID (UUID)
- `lines` (array, required): 발주 상품 목록
  - `skuId` (string, required): SKU ID (UUID)
  - `quantity` (number, required): 발주 수량 (양수)
  - `unitPrice` (number, optional): 단가

**Response**: `201 Created`

```json
{
  "id": "uuid",
  "type": "domestic",
  "supplierId": "uuid",
  "expectedArrival": "2024-01-15T00:00:00.000Z",
  "status": "created",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "lines": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "unitPrice": 10000,
      "sku": {
        "name": "상품명",
        "barcode": "1234567890"
      }
    }
  ],
  "supplier": {
    "name": "공급업체명",
    "contactInfo": {}
  }
}
```

---

### 2. 장바구니에서 발주 생성

발주대기리스트의 아이템들로부터 발주를 생성합니다.

**Endpoint**: `POST /wms/purchase-orders/from-cart`

**Request Body**:

```json
{
  "cartItemIds": ["uuid1", "uuid2"],
  "supplierId": "uuid",
  "expectedArrival": "2024-01-15T00:00:00.000Z",
  "destinationWarehouseId": "uuid"
}
```

**Request Schema**:

- `cartItemIds` (array, required): 장바구니 아이템 ID 목록 (UUID 배열)
- `supplierId` (string, required): 공급업체 ID (UUID)
- `expectedArrival` (string, optional): 입고 예정일 (ISO 8601)
- `destinationWarehouseId` (string, required): 목적지 창고 ID (UUID)

**Response**: `201 Created`

```json
{
  "id": "uuid",
  "type": "domestic",
  "supplierId": "uuid",
  "expectedArrival": "2024-01-15T00:00:00.000Z",
  "status": "created",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "lines": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "unitPrice": 10000,
      "sku": {
        "name": "상품명",
        "barcode": "1234567890"
      }
    }
  ],
  "supplier": {
    "name": "공급업체명",
    "contactInfo": {}
  }
}
```

---

### 3. 발주 목록 조회

발주 목록을 조회합니다.

**Endpoint**: `GET /wms/purchase-orders`

**Query Parameters**:

- `status` (enum, optional): 발주 상태 필터 (`created` | `confirmed` | `received`)
- `type` (enum, optional): 발주 유형 필터 (`domestic` | `foreign`)
- `limit` (number, optional): 조회 개수 (기본: 50)
- `offset` (number, optional): 오프셋 (기본: 0)

**Response**: `200 OK`

```json
[
  {
    "id": "uuid",
    "type": "domestic",
    "supplierId": "uuid",
    "expectedArrival": "2024-01-15T00:00:00.000Z",
    "status": "created",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "lines": [
      {
        "skuId": "uuid",
        "quantity": 100,
        "unitPrice": 10000,
        "sku": {
          "name": "상품명",
          "barcode": "1234567890"
        }
      }
    ],
    "supplier": {
      "name": "공급업체명",
      "contactInfo": {}
    }
  }
]
```

---

### 4. 발주 상세 조회

특정 발주의 상세 정보를 조회합니다.

**Endpoint**: `GET /wms/purchase-orders/:id`

**Path Parameters**:

- `id` (string): 발주 ID

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "type": "domestic",
  "supplierId": "uuid",
  "expectedArrival": "2024-01-15T00:00:00.000Z",
  "status": "created",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "lines": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "unitPrice": 10000,
      "sku": {
        "name": "상품명",
        "barcode": "1234567890"
      }
    }
  ],
  "supplier": {
    "name": "공급업체명",
    "contactInfo": {}
  }
}
```

**Error Response**: `404 Not Found`

```json
{
  "statusCode": 404,
  "message": "발주를 찾을 수 없음"
}
```

---

### 5. 발주 상태 업데이트

발주의 상태를 업데이트합니다.

**Endpoint**: `PUT /wms/purchase-orders/:id/status`

**Path Parameters**:

- `id` (string): 발주 ID

**Request Body**:

```json
{
  "status": "confirmed",
  "expectedArrival": "2024-01-20T00:00:00.000Z"
}
```

**Request Schema**:

- `status` (enum, required): 발주 상태 (`created` | `confirmed` | `received`)
- `expectedArrival` (string, optional): 입고 예정일 (ISO 8601)

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "type": "domestic",
  "supplierId": "uuid",
  "expectedArrival": "2024-01-20T00:00:00.000Z",
  "status": "confirmed",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "lines": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "unitPrice": 10000,
      "sku": {
        "name": "상품명",
        "barcode": "1234567890"
      }
    }
  ],
  "supplier": {
    "name": "공급업체명",
    "contactInfo": {}
  }
}
```

---

## 재주문 제안

### 재주문 제안 조회

안전재고 미만으로 떨어진 상품들의 재주문 제안 목록을 조회합니다.

**Endpoint**: `GET /wms/purchase-orders/suggestions/reorder`

**Query Parameters**:

- `warehouseId` (string, optional): 창고 ID (선택사항)

**Response**: `200 OK`

```json
[
  {
    "skuId": "uuid",
    "skuName": "상품명",
    "currentStock": 50,
    "safetyStock": 100,
    "shortfall": 50,
    "suggestedOrder": 200,
    "onOrderQty": 0,
    "inTransferQty": 0
  }
]
```

**Response Schema**:

- `skuId` (string): SKU ID
- `skuName` (string): SKU 이름
- `currentStock` (number): 현재 재고
- `safetyStock` (number): 안전재고
- `shortfall` (number): 부족량 (안전재고 - 현재재고)
- `suggestedOrder` (number): 제안 발주량
- `onOrderQty` (number): 발주 중 수량
- `inTransferQty` (number): 이동 중 수량

---

## Audit Workflow

발주 승인 워크플로우를 관리합니다. 발주는 다음 상태를 가집니다:

- `draft`: 초안 상태
- `pending_audit`: 검토 대기 중
- `approved`: 승인됨
- `rejected`: 거부됨

### 1. 검토 제출 (Submit for Audit)

발주를 검토 요청 상태로 제출합니다.

**Endpoint**: `PUT /wms/purchase-orders/:id/submit-for-audit`

**Path Parameters**:

- `id` (string): 발주 ID

**Request Body**:

```json
{
  "notes": "Please review this purchase order for approval"
}
```

**Request Schema**:

- `notes` (string, optional): 제출 메모

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "auditStatus": "pending_audit",
  "submittedAt": "2024-01-01T00:00:00.000Z",
  "message": "검토 요청이 제출되었습니다. (Submitted for audit)"
}
```

**Error Responses**:

- `400 Bad Request`: 잘못된 상태 (현재 상태가 draft가 아님)
- `404 Not Found`: 발주를 찾을 수 없습니다.

---

### 2. 발주 승인 (Approve)

검토 대기 중인 발주를 승인합니다.

**Endpoint**: `PUT /wms/purchase-orders/:id/approve`

**Path Parameters**:

- `id` (string): 발주 ID

**Request Body**:

```json
{
  "approvalNotes": "Approved - all items verified"
}
```

**Request Schema**:

- `approvalNotes` (string, optional): 승인 메모

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "auditStatus": "approved",
  "approvedAt": "2024-01-01T00:00:00.000Z",
  "message": "발주가 승인되었습니다. (Purchase order approved)"
}
```

**Error Responses**:

- `400 Bad Request`: 잘못된 상태 (현재 상태가 pending_audit가 아님)
- `404 Not Found`: 발주를 찾을 수 없습니다.

---

### 3. 발주 거부 (Reject)

검토 대기 중인 발주를 거부합니다. 거부 시 상태가 `draft`로 재설정됩니다.

**Endpoint**: `PUT /wms/purchase-orders/:id/reject`

**Path Parameters**:

- `id` (string): 발주 ID

**Request Body**:

```json
{
  "rejectionReason": "SKU quantities exceed budget limits"
}
```

**Request Schema**:

- `rejectionReason` (string, required): 거부 사유

**Response**: `200 OK`

```json
{
  "id": "uuid",
  "auditStatus": "draft",
  "rejectedAt": "2024-01-01T00:00:00.000Z",
  "reason": "SKU quantities exceed budget limits",
  "message": "발주가 거부되었습니다. 수정 후 재제출하세요. (Purchase order rejected, please revise and resubmit)"
}
```

**Error Responses**:

- `400 Bad Request`: 잘못된 상태 (현재 상태가 pending_audit가 아님)
- `404 Not Found`: 발주를 찾을 수 없습니다.

---

## 데이터 모델

### PurchaseOrderType

발주 유형을 나타냅니다.

```typescript
enum PurchaseOrderType {
  DOMESTIC = 'domestic', // 국내 발주
  FOREIGN = 'foreign', // 해외 발주
}
```

### PurchaseOrderStatus

발주 상태를 나타냅니다.

```typescript
enum PurchaseOrderStatus {
  CREATED = 'created', // 생성됨
  CONFIRMED = 'confirmed', // 확인됨
  RECEIVED = 'received', // 입고 완료
}
```

### PurchaseOrderResponse

발주 응답 모델입니다.

```typescript
interface PurchaseOrderResponse {
  id: string;
  type: PurchaseOrderType;
  supplierId: string | null;
  expectedArrival: Date | null;
  status: PurchaseOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: {
    skuId: string;
    quantity: number;
    unitPrice: number | null;
    sku?: {
      name: string;
      barcode: string | null;
    };
  }[];
  supplier?: {
    name: string;
    contactInfo: any;
  };
}
```

### CartItemResponse

발주대기리스트 아이템 응답 모델입니다.

```typescript
interface CartItemResponse {
  id: string;
  skuId: string;
  quantity: number;
  type: PurchaseOrderType;
  supplierInfo: any;
  createdAt: Date;
  updatedAt: Date;
  sku: {
    name: string;
    barcode: string | null;
  };
}
```

### StockReorderSuggestion

재주문 제안 모델입니다.

```typescript
interface StockReorderSuggestion {
  skuId: string;
  skuName: string;
  currentStock: number;
  safetyStock: number;
  shortfall: number;
  suggestedOrder: number;
  onOrderQty: number;
  inTransferQty: number;
}
```

---

## 에러 처리

API는 표준 HTTP 상태 코드를 사용합니다:

- `200 OK`: 요청 성공
- `201 Created`: 리소스 생성 성공
- `204 No Content`: 요청 성공 (응답 본문 없음)
- `400 Bad Request`: 잘못된 요청 (유효성 검증 실패, 잘못된 상태 전환 등)
- `404 Not Found`: 리소스를 찾을 수 없음
- `500 Internal Server Error`: 서버 내부 오류

에러 응답 형식:

```json
{
  "statusCode": 400,
  "message": "에러 메시지",
  "error": "Bad Request"
}
```

---

## 사용 예시

### 시나리오 1: 발주 생성 및 승인 워크플로우

1. 발주 생성

```bash
POST /wms/purchase-orders
{
  "type": "domestic",
  "supplierId": "supplier-uuid",
  "destinationWarehouseId": "warehouse-uuid",
  "lines": [
    {
      "skuId": "sku-uuid",
      "quantity": 100,
      "unitPrice": 10000
    }
  ]
}
```

2. 검토 제출

```bash
PUT /wms/purchase-orders/{po-id}/submit-for-audit
{
  "notes": "Please review"
}
```

3. 승인

```bash
PUT /wms/purchase-orders/{po-id}/approve
{
  "approvalNotes": "Approved"
}
```

### 시나리오 2: 발주대기리스트를 통한 발주 생성

1. 발주대기리스트에 아이템 추가

```bash
POST /wms/purchase-orders/cart
{
  "skuId": "sku-uuid",
  "quantity": 100,
  "type": "domestic"
}
```

2. 발주대기리스트 조회

```bash
GET /wms/purchase-orders/cart?type=domestic
```

3. 장바구니에서 발주 생성

```bash
POST /wms/purchase-orders/from-cart
{
  "cartItemIds": ["cart-item-uuid"],
  "supplierId": "supplier-uuid",
  "destinationWarehouseId": "warehouse-uuid"
}
```

---

## 참고사항

- 모든 날짜/시간 필드는 ISO 8601 형식을 사용합니다.
- UUID는 표준 UUID v4 형식을 사용합니다.
- 수량(quantity)은 항상 양수여야 합니다.
- 발주 생성 시 공급업체의 기본 창고와 목적지 창고가 다르면 자동으로 이동(transfer)이 필요하다고 표시됩니다.
- Audit 워크플로우는 발주가 승인된 후에만 실제 입고 프로세스로 진행할 수 있습니다.


