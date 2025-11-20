# Inbound API 문서

## 개요

Inbound API는 입고(Inbound) 관리 및 입고예정(Plan) 관리를 위한 RESTful API입니다.

**Base URL**: `/wms/inbound`

---

## 목차

1. [간편입고](#간편입고)
2. [개별입고](#개별입고)
3. [입고 예정 관리](#입고-예정-관리)
4. [입고 조회](#입고-조회)
5. [입고 작업 관리](#입고-작업-관리)
6. [데이터 모델](#데이터-모델)
7. [에러 처리](#에러-처리)

---

## 간편입고

### 1. 간편입고

SKU 리스트를 지정 위치로 즉시 입고합니다. 모든 SKU는 시스템 입고 기본존으로 입고됩니다.

**Endpoint**: `POST /wms/inbound/simple`

**Request Body**:

```json
{
  "warehouseId": "uuid",
  "items": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "memo": "입고 메모 (선택사항)"
    }
  ]
}
```

**Request Schema**:

- `warehouseId` (string, required): 타겟 창고 ID (UUID)
- `items` (array, required): 입고 아이템 목록
  - `skuId` (string, required): SKU ID (UUID)
  - `quantity` (number, required): 입고 수량 (최소 1)
  - `memo` (string, optional): 입고 메모

**Response**: `201 Created`

```json
{
  "success": true,
  "count": 2,
  "receiptId": "uuid",
  "totalQuantity": 200
}
```

**Response Schema**:

- `success` (boolean): 성공 여부
- `count` (number): 입고된 아이템 개수
- `receiptId` (string): 입고 회차 ID
- `totalQuantity` (number): 총 입고 수량

---

### 2. 전수조사 간편입고

전수조사 간편입고를 처리합니다. 서버는 간편입고와 동일하게 처리하되, 기록만 구분됩니다.

**Endpoint**: `POST /wms/inbound/simple-fullscan`

**Request Body**:

```json
{
  "warehouseId": "uuid",
  "items": [
    {
      "skuId": "uuid",
      "quantity": 100,
      "memo": "전수조사 입고 메모 (선택사항)"
    }
  ]
}
```

**Request Schema**:

- `warehouseId` (string, required): 타겟 창고 ID (UUID)
- `items` (array, required): 입고 아이템 목록
  - `skuId` (string, required): SKU ID (UUID)
  - `quantity` (number, required): 입고 수량 (최소 1)
  - `memo` (string, optional): 입고 메모

**Response**: `201 Created`

```json
{
  "success": true,
  "count": 2,
  "receiptId": "uuid",
  "totalQuantity": 200
}
```

---

## 개별입고

### 개별입고

단일 SKU를 지정 로케이션(옵션, 없으면 기본입고존)으로 입고합니다.

**Endpoint**: `POST /wms/inbound/individual`

**Request Body**:

```json
{
  "warehouseId": "uuid",
  "skuId": "uuid",
  "quantity": 50,
  "locationId": "uuid",
  "memo": "개별입고 메모 (선택사항)"
}
```

**Request Schema**:

- `warehouseId` (string, required): 타겟 창고 ID (UUID)
- `skuId` (string, required): SKU ID (UUID)
- `quantity` (number, required): 입고 수량 (최소 1)
- `locationId` (string, optional): 타겟 로케이션 ID (UUID). 지정하지 않으면 시스템 입고 기본존 사용
- `memo` (string, optional): 입고 메모

**Response**: `201 Created`

```json
{
  "success": true,
  "receiptId": "uuid",
  "lineId": "uuid",
  "quantity": 50
}
```

**Response Schema**:

- `success` (boolean): 성공 여부
- `receiptId` (string): 입고 회차 ID
- `lineId` (string): 입고 라인 ID
- `quantity` (number): 입고 수량

---

## 입고 예정 관리

### 1. 입고예정 생성

새로운 입고예정을 생성합니다.

**Endpoint**: `POST /wms/inbound/plans`

**Request Body**:

```json
{
  "expectedDate": "2024-01-15",
  "warehouseId": "uuid"
}
```

**Request Schema**:

- `expectedDate` (string, required): 예정일 (YYYY-MM-DD 형식)
- `warehouseId` (string, required): 창고 ID (UUID)

**Response**: `201 Created`

```json
{
  "id": "uuid",
  "expectedDate": "2024-01-15T00:00:00.000Z",
  "warehouseId": "uuid",
  "status": "pending",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

---

### 2. 입고예정 아이템 추가

입고예정에 아이템을 추가합니다.

**Endpoint**: `POST /wms/inbound/plans/items`

**Request Body**:

```json
{
  "planId": "uuid",
  "items": [
    {
      "skuId": "uuid",
      "expectedQty": 100
    }
  ]
}
```

**Request Schema**:

- `planId` (string, required): 입고예정 ID (UUID)
- `items` (array, required): 입고예정 아이템 목록
  - `skuId` (string, required): SKU ID (UUID)
  - `expectedQty` (number, required): 예정 수량 (최소 1)

**Response**: `201 Created`

```json
{
  "success": true
}
```

**Error Response**: `404 Not Found`

```json
{
  "statusCode": 404,
  "message": "inbound plan not found"
}
```

---

### 3. 입고예정 아이템 조회

입고예정 아이템을 조회합니다. 헤더 무시, 아이템 기준으로 조회됩니다.

**Endpoint**: `GET /wms/inbound/plans/items`

**Query Parameters**:

- `startDate` (string, optional): 시작일 (YYYY-MM-DD)
- `endDate` (string, optional): 종료일 (YYYY-MM-DD)
- `warehouseId` (string, optional): 창고 ID (UUID)
- `skuId` (string, optional): SKU ID (UUID)

**Response**: `200 OK`

```json
{
  "total": 2,
  "items": [
    {
      "planItemId": "uuid",
      "planId": "uuid",
      "expectedDate": "2024-01-15T00:00:00.000Z",
      "warehouseId": "uuid",
      "skuId": "uuid",
      "expectedQty": 100,
      "receivedQty": 50,
      "status": "pending"
    }
  ]
}
```

**Response Schema**:

- `total` (number): 조회된 아이템 총 개수
- `items` (array): 입고예정 아이템 목록
  - `planItemId` (string): 입고예정 아이템 ID
  - `planId` (string): 입고예정 ID
  - `expectedDate` (string): 예정일 (ISO 8601)
  - `warehouseId` (string): 창고 ID
  - `skuId` (string): SKU ID
  - `expectedQty` (number): 예정 수량
  - `receivedQty` (number): 입고 수량
  - `status` (string): 상태 (`pending` | `confirmed`)

---

### 4. 입고예정 아이템 기반 실입고 처리

입고예정 아이템을 기반으로 실입고를 처리합니다.

**Endpoint**: `POST /wms/inbound/plans/receive`

**Request Body**:

```json
{
  "planItemId": "uuid",
  "quantity": 50,
  "locationId": "uuid",
  "memo": "실입고 메모 (선택사항)"
}
```

**Request Schema**:

- `planItemId` (string, required): 입고예정 아이템 ID (UUID)
- `quantity` (number, required): 실입고 수량 (최소 1)
- `locationId` (string, optional): 입고 로케이션 ID (UUID). 지정하지 않으면 시스템 입고 기본존 사용
- `memo` (string, optional): 입고 메모

**Response**: `201 Created`

```json
{
  "success": true,
  "receiptId": "uuid"
}
```

**Error Responses**:

- `404 Not Found`: 입고예정 아이템 또는 입고예정을 찾을 수 없습니다.

---

### 5. 입고 예정 목록 조회

입고 예정 목록을 조회합니다.

**Endpoint**: `GET /wms/inbound/pending`

**Query Parameters**:

- `warehouseId` (string, optional): 창고 ID (UUID)

**Response**: `200 OK`

```json
{
  "warehouseId": "uuid",
  "totalPendingPlans": 2,
  "totalPendingQuantity": 300,
  "pendingPlans": [
    {
      "planId": "uuid",
      "planType": "source",
      "warehouseId": "uuid",
      "expectedDate": "2024-01-15T00:00:00.000Z",
      "isLinkedPlan": false,
      "sourcePlanStatus": null,
      "purchaseOrder": {
        "id": "uuid",
        "type": "domestic",
        "supplier": {
          "name": "공급업체명",
          "contactInfo": "연락처 정보"
        }
      },
      "items": [
        {
          "skuId": "uuid",
          "skuName": "상품명",
          "skuCode": "SKU001",
          "expectedQty": 100,
          "receivedQty": 50,
          "pendingQty": 50
        }
      ],
      "totalQuantity": 100,
      "totalPendingQuantity": 50
    }
  ]
}
```

**Response Schema**:

- `warehouseId` (string, optional): 창고 ID
- `totalPendingPlans` (number): 총 입고 예정 개수
- `totalPendingQuantity` (number): 총 입고 예정 수량
- `pendingPlans` (array): 입고 예정 목록
  - `planId` (string): 입고예정 ID
  - `planType` (string): 계획 유형 (`source` | `destination`)
  - `warehouseId` (string): 창고 ID
  - `expectedDate` (string, nullable): 예정일 (ISO 8601)
  - `isLinkedPlan` (boolean): 연결된 계획 여부 (destination plan 여부)
  - `sourcePlanStatus` (string, optional): 소스 계획 상태
  - `purchaseOrder` (object, optional): 발주 정보
    - `id` (string): 발주 ID
    - `type` (string): 발주 유형 (`domestic` | `foreign`)
    - `supplier` (object, optional): 공급업체 정보
      - `name` (string): 공급업체명
      - `contactInfo` (string): 연락처 정보
  - `items` (array): 아이템 목록
    - `skuId` (string): SKU ID
    - `skuName` (string): SKU 이름
    - `skuCode` (string): SKU 코드
    - `expectedQty` (number): 예정 수량
    - `receivedQty` (number): 입고 수량
    - `pendingQty` (number): 대기 수량 (예정 수량 - 입고 수량)
  - `totalQuantity` (number): 총 수량
  - `totalPendingQuantity` (number): 총 대기 수량

---

## 입고 조회

### 1. 입고내역(현황) 조회

입고내역을 조회합니다. (sku, quantity, occurredAt, method)

**Endpoint**: `GET /wms/inbound/receipts`

**Query Parameters**:

- `skuId` (string, optional): SKU ID (UUID)
- `warehouseId` (string, optional): 창고 ID (UUID)
- `method` (enum, optional): 입고 방법 (`individual` | `simple` | `simple_fullscan` | `planned`)
- `startDate` (string, optional): 시작일 (YYYY-MM-DD)
- `endDate` (string, optional): 종료일 (YYYY-MM-DD)
- `limit` (number, optional): 조회 개수 (기본: 50)
- `offset` (number, optional): 오프셋 (기본: 0)

**Response**: `200 OK`

```json
{
  "total": 10,
  "items": [
    {
      "receiptId": "uuid",
      "method": "simple",
      "occurredAt": "2024-01-15T10:00:00.000Z",
      "warehouseId": "uuid",
      "locationId": "uuid",
      "skuId": "uuid",
      "quantity": 100
    }
  ]
}
```

**Response Schema**:

- `total` (number): 조회된 항목 총 개수
- `items` (array): 입고내역 목록
  - `receiptId` (string): 입고 회차 ID
  - `method` (string): 입고 방법
  - `occurredAt` (string): 발생 일시 (ISO 8601)
  - `warehouseId` (string): 창고 ID
  - `locationId` (string): 로케이션 ID
  - `skuId` (string): SKU ID
  - `quantity` (number): 입고 수량

---

### 2. 입고 작업 타임라인 조회

입고 작업 타임라인을 조회합니다. (INBOUND/PUTAWAY/RETURN/CANCEL)

**Endpoint**: `GET /wms/inbound/work-logs`

**Query Parameters**:

- `warehouseId` (string, optional): 창고 ID (UUID)
- `skuId` (string, optional): SKU ID (UUID)
- `type` (enum, optional): 작업 유형 (`INBOUND` | `PUTAWAY` | `RETURN` | `CANCEL`)
- `method` (enum, optional): 입고 방법 (`individual` | `simple` | `simple_fullscan` | `planned`)
- `startDate` (string, optional): 시작일 (YYYY-MM-DD)
- `endDate` (string, optional): 종료일 (YYYY-MM-DD)
- `limit` (number, optional): 조회 개수 (기본: 100)
- `offset` (number, optional): 오프셋 (기본: 0)

**Response**: `200 OK`

```json
{
  "total": 20,
  "items": [
    {
      "id": "uuid",
      "type": "INBOUND",
      "timestamp": "2024-01-15T10:00:00.000Z",
      "receiptId": "uuid",
      "lineId": "uuid",
      "planItemId": null,
      "skuId": "uuid",
      "warehouseId": "uuid",
      "fromLocationId": null,
      "toLocationId": "uuid",
      "quantity": 100,
      "method": "simple",
      "reason": "simple_inbound",
      "eventId": "uuid"
    }
  ]
}
```

**Response Schema**:

- `total` (number): 조회된 항목 총 개수
- `items` (array): 작업 로그 목록
  - `id` (string): 작업 로그 ID
  - `type` (string): 작업 유형
  - `timestamp` (string): 타임스탬프 (ISO 8601)
  - `receiptId` (string): 입고 회차 ID
  - `lineId` (string, nullable): 입고 라인 ID
  - `planItemId` (string, nullable): 입고예정 아이템 ID
  - `skuId` (string): SKU ID
  - `warehouseId` (string): 창고 ID
  - `fromLocationId` (string, nullable): 출발 로케이션 ID
  - `toLocationId` (string, nullable): 도착 로케이션 ID
  - `quantity` (number): 수량
  - `method` (string): 입고 방법
  - `reason` (string): 작업 사유
  - `eventId` (string, nullable): 이벤트 ID

---

### 3. 집계 입고현황(확정수량) 조회

집계 입고현황을 조회합니다. 취소/회송이 반영된 확정수량을 포함합니다.

**Endpoint**: `GET /wms/inbound/status`

**Query Parameters**:

- `skuId` (string, optional): SKU ID (UUID)
- `warehouseId` (string, optional): 창고 ID (UUID)
- `startDate` (string, optional): 시작일 (YYYY-MM-DD)
- `endDate` (string, optional): 종료일 (YYYY-MM-DD)
- `limit` (number, optional): 조회 개수 (기본: 50)
- `offset` (number, optional): 오프셋 (기본: 0)

**Response**: `200 OK`

```json
{
  "total": 10,
  "items": [
    {
      "receiptId": "uuid",
      "lineId": "uuid",
      "occurredAt": "2024-01-15T10:00:00.000Z",
      "method": "simple",
      "warehouseId": "uuid",
      "locationId": "uuid",
      "skuId": "uuid",
      "qtyReceived": 100,
      "qtyReturned": 10,
      "confirmedQty": 90
    }
  ]
}
```

**Response Schema**:

- `total` (number): 조회된 항목 총 개수
- `items` (array): 입고현황 목록
  - `receiptId` (string): 입고 회차 ID
  - `lineId` (string): 입고 라인 ID
  - `occurredAt` (string): 발생 일시 (ISO 8601)
  - `method` (string): 입고 방법
  - `warehouseId` (string): 창고 ID
  - `locationId` (string): 로케이션 ID
  - `skuId` (string): SKU ID
  - `qtyReceived` (number): 입고 수량
  - `qtyReturned` (number): 회송 수량
  - `confirmedQty` (number): 확정 수량 (입고 수량 - 회송 수량)

---

### 4. 입고 실적 조회

입고 실적을 조회합니다.

**Endpoint**: `GET /wms/inbound/history`

**Query Parameters**:

- `skuId` (string, optional): SKU ID (UUID)
- `warehouseId` (string, optional): 창고 ID (UUID)
- `days` (number, optional): 조회 기간 (일, 기본: 30)

**Response**: `200 OK`

```json
[
  {
    "skuId": "uuid",
    "skuName": "상품명",
    "warehouseId": "uuid",
    "totalQuantity": 500,
    "lastInboundDate": "2024-01-15T10:00:00.000Z"
  }
]
```

---

### 5. 바코드 검증

입고 검수를 위한 바코드 스캔을 검증합니다.

**Endpoint**: `POST /wms/inbound/verify-barcode`

**Request Body**:

```json
{
  "barcode": "1234567890",
  "expectedSkuId": "uuid"
}
```

**Request Schema**:

- `barcode` (string, required): 바코드
- `expectedSkuId` (string, optional): 예상 SKU ID (UUID)

**Response**: `200 OK`

```json
{
  "valid": true,
  "skuId": "uuid",
  "skuName": "상품명",
  "matches": true
}
```

**Response Schema**:

- `valid` (boolean): 바코드 유효 여부
- `skuId` (string): SKU ID
- `skuName` (string): SKU 이름
- `matches` (boolean): 예상 SKU와 일치 여부 (expectedSkuId가 제공된 경우)

**Error Responses**:

- `404 Not Found`: 바코드에 해당하는 SKU를 찾을 수 없습니다.
- `400 Bad Request`: 스캔한 SKU가 예상 SKU와 다릅니다.

---

## 입고 작업 관리

### 1. 입고 적치(즉시 이동)

원위치에서 목적지로 즉시 이동합니다.

**Endpoint**: `POST /wms/inbound/putaway`

**Request Body**:

```json
{
  "lineId": "uuid",
  "toLocationId": "uuid",
  "quantity": 50
}
```

**Request Schema**:

- `lineId` (string, required): 입고 라인 ID (UUID)
- `toLocationId` (string, required): 목적지 로케이션 ID (UUID)
- `quantity` (number, required): 이동 수량 (최소 1)

**Response**: `201 Created`

```json
{
  "success": true,
  "eventId": "uuid",
  "fromLocationId": "uuid",
  "toLocationId": "uuid",
  "quantity": 50
}
```

**Error Responses**:

- `404 Not Found`: 입고 라인 또는 입고 회차를 찾을 수 없습니다.
- `400 Bad Request`: 원위치가 없거나, 목적지 로케이션이 비활성화되었거나, 다른 창고에 속해 있습니다.

---

### 2. 입고 회송

원위치 잔량에서 차감합니다.

**Endpoint**: `POST /wms/inbound/return`

**Request Body**:

```json
{
  "lineId": "uuid",
  "quantity": 10
}
```

**Request Schema**:

- `lineId` (string, required): 입고 라인 ID (UUID)
- `quantity` (number, required): 회송 수량 (최소 1)

**Response**: `201 Created`

```json
{
  "success": true,
  "lineId": "uuid",
  "returnedQty": 10
}
```

**Error Responses**:

- `404 Not Found`: 입고 라인을 찾을 수 없습니다.
- `400 Bad Request`: 회송 수량이 원위치 잔량을 초과합니다.

---

### 3. 입고 취소

오입고 정정을 위해 원위치 잔량에서 차감합니다.

**Endpoint**: `POST /wms/inbound/cancel`

**Request Body**:

```json
{
  "lineId": "uuid",
  "quantity": 5
}
```

**Request Schema**:

- `lineId` (string, required): 입고 라인 ID (UUID)
- `quantity` (number, required): 취소 수량 (최소 1)

**Response**: `201 Created`

```json
{
  "success": true,
  "lineId": "uuid",
  "canceledQty": 5
}
```

**Error Responses**:

- `404 Not Found`: 입고 라인을 찾을 수 없습니다.
- `400 Bad Request`: 취소 수량이 원위치 잔량을 초과합니다.

---

### 4. 입고 라인 메모 수정

입고 라인의 메모를 수정합니다.

**Endpoint**: `POST /wms/inbound/lines/:lineId/memo`

**Path Parameters**:

- `lineId` (string): 입고 라인 ID (UUID)

**Request Body**:

```json
{
  "memo": "수정된 메모 내용"
}
```

**Request Schema**:

- `memo` (string, required): 메모 내용 (최대 255자)

**Response**: `200 OK`

```json
{
  "success": true
}
```

**Error Response**: `404 Not Found`

```json
{
  "statusCode": 404,
  "message": "inbound line not found"
}
```

---

## 데이터 모델

### InboundMethod

입고 방법을 나타냅니다.

```typescript
enum InboundMethod {
  INDIVIDUAL = 'individual', // 개별입고
  SIMPLE = 'simple', // 간편입고
  SIMPLE_FULLSCAN = 'simple_fullscan', // 전수조사 간편입고
  PLANNED = 'planned', // 예정입고
}
```

### InboundWorkLogType

입고 작업 로그 유형을 나타냅니다.

```typescript
enum InboundWorkLogType {
  INBOUND = 'INBOUND', // 입고
  PUTAWAY = 'PUTAWAY', // 적치
  RETURN = 'RETURN', // 회송
  CANCEL = 'CANCEL', // 취소
}
```

### InboundPlanStatus

입고예정 상태를 나타냅니다.

```typescript
enum InboundPlanStatus {
  PENDING = 'pending', // 대기 중
  CONFIRMED = 'confirmed', // 확정됨
}
```

### InboundPlanType

입고예정 유형을 나타냅니다.

```typescript
enum InboundPlanType {
  SOURCE = 'source', // 소스 계획
  DESTINATION = 'destination', // 목적지 계획
}
```

### SimpleInboundResponse

간편입고 응답 모델입니다.

```typescript
interface SimpleInboundResponse {
  success: boolean;
  count: number;
  receiptId: string;
  totalQuantity: number;
}
```

### IndividualInboundResponse

개별입고 응답 모델입니다.

```typescript
interface IndividualInboundResponse {
  success: boolean;
  receiptId: string;
  lineId: string;
  quantity: number;
}
```

### InboundReceiptResponse

입고내역 응답 모델입니다.

```typescript
interface InboundReceiptResponse {
  receiptId: string;
  method: InboundMethod;
  occurredAt: Date;
  warehouseId: string;
  locationId: string;
  skuId: string;
  quantity: number;
}
```

### InboundWorkLogResponse

입고 작업 로그 응답 모델입니다.

```typescript
interface InboundWorkLogResponse {
  id: string;
  type: InboundWorkLogType;
  timestamp: Date;
  receiptId: string;
  lineId: string | null;
  planItemId: string | null;
  skuId: string;
  warehouseId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  quantity: number;
  method: InboundMethod;
  reason: string;
  eventId: string | null;
}
```

### InboundStatusResponse

집계 입고현황 응답 모델입니다.

```typescript
interface InboundStatusResponse {
  receiptId: string;
  lineId: string;
  occurredAt: Date;
  method: InboundMethod;
  warehouseId: string;
  locationId: string;
  skuId: string;
  qtyReceived: number;
  qtyReturned: number;
  confirmedQty: number;
}
```

### InboundPendingResponse

입고 예정 응답 모델입니다.

```typescript
interface InboundPendingResponse {
  planId: string;
  planType: InboundPlanType;
  warehouseId: string;
  expectedDate: Date | null;
  isLinkedPlan: boolean;
  sourcePlanStatus?: string;
  purchaseOrder?: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: {
      name: string;
      contactInfo: string;
    };
  };
  items: Array<{
    skuId: string;
    skuName: string;
    skuCode: string;
    expectedQty: number;
    receivedQty: number;
    pendingQty: number;
  }>;
  totalQuantity: number;
  totalPendingQuantity: number;
}
```

---

## 에러 처리

API는 표준 HTTP 상태 코드를 사용합니다:

- `200 OK`: 요청 성공
- `201 Created`: 리소스 생성 성공
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

### 시나리오 1: 간편입고 처리

1. 간편입고 실행

```bash
POST /wms/inbound/simple
{
  "warehouseId": "warehouse-uuid",
  "items": [
    {
      "skuId": "sku-uuid-1",
      "quantity": 100
    },
    {
      "skuId": "sku-uuid-2",
      "quantity": 50
    }
  ]
}
```

2. 입고내역 조회

```bash
GET /wms/inbound/receipts?warehouseId=warehouse-uuid&method=simple
```

---

### 시나리오 2: 입고예정 기반 입고 처리

1. 입고예정 생성

```bash
POST /wms/inbound/plans
{
  "expectedDate": "2024-01-15",
  "warehouseId": "warehouse-uuid"
}
```

2. 입고예정 아이템 추가

```bash
POST /wms/inbound/plans/items
{
  "planId": "plan-uuid",
  "items": [
    {
      "skuId": "sku-uuid",
      "expectedQty": 200
    }
  ]
}
```

3. 입고예정 아이템 기반 실입고 처리

```bash
POST /wms/inbound/plans/receive
{
  "planItemId": "plan-item-uuid",
  "quantity": 100
}
```

4. 입고 예정 목록 조회

```bash
GET /wms/inbound/pending?warehouseId=warehouse-uuid
```

---

### 시나리오 3: 입고 적치 및 회송

1. 간편입고 실행

```bash
POST /wms/inbound/simple
{
  "warehouseId": "warehouse-uuid",
  "items": [
    {
      "skuId": "sku-uuid",
      "quantity": 100
    }
  ]
}
```

2. 입고내역 조회하여 라인 ID 확인

```bash
GET /wms/inbound/receipts?skuId=sku-uuid
```

3. 입고 적치

```bash
POST /wms/inbound/putaway
{
  "lineId": "line-uuid",
  "toLocationId": "location-uuid",
  "quantity": 80
}
```

4. 입고 회송

```bash
POST /wms/inbound/return
{
  "lineId": "line-uuid",
  "quantity": 10
}
```

5. 집계 입고현황 조회

```bash
GET /wms/inbound/status?skuId=sku-uuid
```

---

## 참고사항

- 모든 날짜/시간 필드는 ISO 8601 형식을 사용합니다.
- UUID는 표준 UUID v4 형식을 사용합니다.
- 수량(quantity)은 항상 양수여야 합니다.
- 간편입고와 전수조사 간편입고는 항상 시스템 입고 기본존으로 입고됩니다.
- 개별입고는 `locationId`를 지정하지 않으면 시스템 입고 기본존을 사용합니다.
- 입고예정 아이템 기반 실입고도 `locationId`를 지정하지 않으면 시스템 입고 기본존을 사용합니다.
- 입고 적치 시 목적지 로케이션은 반드시 동일 창고에 속해야 합니다.
- 회송 및 취소 수량은 원위치 잔량을 초과할 수 없습니다.
- 집계 입고현황의 `confirmedQty`는 입고 수량에서 회송 수량을 뺀 값입니다.



