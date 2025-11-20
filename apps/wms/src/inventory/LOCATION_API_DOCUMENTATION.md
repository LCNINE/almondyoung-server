# 위치 관리 API 문서

## 개요

이 문서는 WMS(창고 관리 시스템)의 위치(Location) 관리 API에 대한 상세 설명을 제공합니다.

위치 관리 시스템은 창고 내 물리적 저장 공간을 체계적으로 관리하기 위한 시스템으로, 다음과 같은 계층 구조를 가집니다:

- **창고(Warehouse)**: 최상위 단위
- **열(Column)**: 창고 내 세로 구역 (예: A, B, C)
- **랙(Rack)**: 열 내 가로 구역 (예: 1, 2, 3)
- **빈(Bin)**: 랙 내 개별 저장 위치 (예: 01, 02, 03)
- **구역 로케이션(Zone Location)**: 표준 구조와 무관한 특수 구역 (예: 입고기본존, 반품기본존)

표준 로케이션은 `{열이름}-{랙번호}-{빈번호}` 형식의 코드를 가지며 (예: `A-01-01`), 구역 로케이션은 자유로운 코드를 가질 수 있습니다.

---

## 목차

1. [열(Column) 관리](#열column-관리)
2. [랙(Rack) 관리](#랙rack-관리)
3. [구역 로케이션(Zone Location) 관리](#구역-로케이션zone-location-관리)
4. [로케이션 조회](#로케이션-조회)
5. [로케이션 수정](#로케이션-수정)
6. [커스텀 빈 추가](#커스텀-빈-추가)
7. [DTO 상세](#dto-상세)
8. [에러 처리](#에러-처리)

---

## 열(Column) 관리

### 1. 열 생성

**엔드포인트**: `POST /wms/locations/warehouses/:warehouseId/columns`

**설명**: 특정 창고에 새로운 열(Column)을 생성합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**요청 본문** (`CreateColumnDto`):
```json
{
  "columnName": "A",
  "displayOrder": 0
}
```

**필드 설명**:
- `columnName` (string, required): 열 이름 (예: "A", "B", "C")
- `displayOrder` (number, optional): 정렬 순서 (기본값: 0)

**응답 예시** (201 Created):
```json
{
  "id": "col-uuid-123",
  "warehouseId": "warehouse-uuid-456",
  "columnName": "A",
  "displayOrder": 0,
  "isActive": true,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

**에러 응답**:
- `400 Bad Request`: 중복된 열 이름 또는 잘못된 요청 데이터
- `404 Not Found`: 창고를 찾을 수 없음

---

### 2. 열 목록 조회

**엔드포인트**: `GET /wms/locations/warehouses/:warehouseId/columns`

**설명**: 특정 창고의 모든 열을 조회합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**쿼리 파라미터** (`ColumnQueryDto`):
- `isActive` (boolean, optional): 활성 상태 필터 (true/false)

**응답 예시** (200 OK):
```json
[
  {
    "id": "col-uuid-123",
    "warehouseId": "warehouse-uuid-456",
    "columnName": "A",
    "displayOrder": 0,
    "isActive": true,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  },
  {
    "id": "col-uuid-124",
    "warehouseId": "warehouse-uuid-456",
    "columnName": "B",
    "displayOrder": 1,
    "isActive": true,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
]
```

---

### 3. 열 정보 수정

**엔드포인트**: `PUT /wms/locations/columns/:columnId`

**설명**: 기존 열의 정보를 수정합니다.

**경로 파라미터**:
- `columnId` (string, required): 열 ID

**요청 본문** (`UpdateColumnDto`):
```json
{
  "columnName": "A-New",
  "displayOrder": 1,
  "isActive": true
}
```

**필드 설명** (모든 필드 optional):
- `columnName` (string, optional): 열 이름
- `displayOrder` (number, optional): 정렬 순서
- `isActive` (boolean, optional): 활성 상태

**응답 예시** (200 OK):
```json
{
  "id": "col-uuid-123",
  "warehouseId": "warehouse-uuid-456",
  "columnName": "A-New",
  "displayOrder": 1,
  "isActive": true,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T11:00:00Z"
}
```

**에러 응답**:
- `404 Not Found`: 열을 찾을 수 없음

---

## 랙(Rack) 관리

### 1. 랙 생성 (빈 자동 생성 포함)

**엔드포인트**: `POST /wms/locations/warehouses/:warehouseId/racks`

**설명**: 특정 열에 새로운 랙을 생성하고, 필요시 표준 빈들을 자동으로 생성합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**요청 본문** (`CreateRackDto`):
```json
{
  "columnName": "A",
  "rackNumber": 1,
  "binSettings": {
    "autoGenerate": true,
    "standardBins": {
      "start": 1,
      "end": 15
    },
    "customBins": ["바닥", "상단"]
  },
  "physicalWidth": 100,
  "physicalHeight": 200,
  "notes": "메인 랙"
}
```

**필드 설명**:
- `columnName` (string, required): 열 이름
- `rackNumber` (number, required): 랙 번호 (1-999)
- `binSettings` (object, required): 빈 설정
  - `autoGenerate` (boolean, required): 빈 자동 생성 여부
  - `standardBins` (object, optional): 표준 빈 범위
    - `start` (number): 시작 빈 번호 (1 이상)
    - `end` (number): 끝 빈 번호 (1-999)
  - `customBins` (string[], optional): 커스텀 빈 이름 배열
- `physicalWidth` (number, optional): 물리적 너비 (cm)
- `physicalHeight` (number, optional): 물리적 높이 (cm)
- `notes` (string, optional): 메모

**응답 예시** (201 Created):
```json
{
  "success": true,
  "createdCount": 17,
  "createdLocationCodes": [
    "A-01-01",
    "A-01-02",
    "A-01-03",
    "...",
    "A-01-15",
    "A-01-바닥",
    "A-01-상단"
  ]
}
```

**에러 응답**:
- `400 Bad Request`: 중복된 랙, 열이 없음, 잘못된 빈 범위 등
- `404 Not Found`: 창고를 찾을 수 없음

---

### 2. 랙 목록 조회

**엔드포인트**: `GET /wms/locations/warehouses/:warehouseId/racks`

**설명**: 특정 창고의 모든 랙을 조회합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**쿼리 파라미터** (`RackQueryDto`):
- `columnName` (string, optional): 열 이름 필터
- `isActive` (boolean, optional): 활성 상태 필터
- `autoGenerateBins` (boolean, optional): 자동 생성 빈 필터

**응답 예시** (200 OK):
```json
[
  {
    "id": "rack-uuid-123",
    "columnId": "col-uuid-123",
    "rackNumber": 1,
    "defaultBinStart": 1,
    "defaultBinEnd": 15,
    "autoGenerateBins": true,
    "physicalWidth": 100,
    "physicalHeight": 200,
    "notes": "메인 랙",
    "isActive": true,
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
]
```

---

### 3. 랙 정보 수정

**엔드포인트**: `PUT /wms/locations/racks/:rackId`

**설명**: 기존 랙의 정보를 수정합니다.

**경로 파라미터**:
- `rackId` (string, required): 랙 ID

**요청 본문** (`UpdateRackDto`):
```json
{
  "defaultBinStart": 1,
  "defaultBinEnd": 20,
  "autoGenerateBins": true,
  "physicalWidth": 120,
  "physicalHeight": 250,
  "notes": "수정된 메모",
  "isActive": true
}
```

**필드 설명** (모든 필드 optional):
- `defaultBinStart` (number, optional): 기본 빈 시작 번호
- `defaultBinEnd` (number, optional): 기본 빈 끝 번호
- `autoGenerateBins` (boolean, optional): 빈 자동 생성 여부
- `physicalWidth` (number, optional): 물리적 너비 (cm)
- `physicalHeight` (number, optional): 물리적 높이 (cm)
- `notes` (string, optional): 메모
- `isActive` (boolean, optional): 활성 상태

**응답 예시** (200 OK):
```json
{
  "id": "rack-uuid-123",
  "columnId": "col-uuid-123",
  "rackNumber": 1,
  "defaultBinStart": 1,
  "defaultBinEnd": 20,
  "autoGenerateBins": true,
  "physicalWidth": 120,
  "physicalHeight": 250,
  "notes": "수정된 메모",
  "isActive": true,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T11:00:00Z"
}
```

**에러 응답**:
- `404 Not Found`: 랙을 찾을 수 없음

---

## 구역 로케이션(Zone Location) 관리

### 1. 구역 로케이션 생성

**엔드포인트**: `POST /wms/locations/warehouses/:warehouseId/zones`

**설명**: 특정 창고에 새로운 구역 로케이션을 생성합니다. 한글 이름이 포함된 경우 자동으로 `zone-N` 형태의 바코드 코드를 생성합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**요청 본문** (`CreateZoneLocationDto`):
```json
{
  "code": "입고기본존",
  "displayName": "입고 기본 구역",
  "capacityLimit": 1000,
  "fifoRank": 1,
  "isExpirySeparated": false,
  "notes": "입고된 상품의 기본 보관 구역"
}
```

**필드 설명**:
- `code` (string, required): 구역 로케이션 코드 (한글 포함 가능)
- `displayName` (string, optional): 표시명
- `capacityLimit` (number, optional): 용량 제한
- `fifoRank` (number, optional): FIFO 순위 (낮을수록 먼저 출고)
- `isExpirySeparated` (boolean, optional): 유통기한별 분리 보관 여부
- `notes` (string, optional): 메모

**응답 예시** (201 Created):
```json
{
  "id": "zone-uuid-123",
  "code": "zone-1",
  "displayName": "입고 기본 구역",
  "type": "zone",
  "warehouseId": "warehouse-uuid-456",
  "isActive": true,
  "metadata": {
    "capacityLimit": 1000,
    "fifoRank": 1,
    "isExpirySeparated": false,
    "notes": "입고된 상품의 기본 보관 구역"
  },
  "rackId": null,
  "binIdentifier": null,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

**참고**: 한글 코드가 포함된 경우, 시스템이 자동으로 `zone-1`, `zone-2` 등의 바코드 코드를 생성하지만, `displayName`에는 원래 한글 이름이 유지됩니다.

**에러 응답**:
- `400 Bad Request`: 중복된 구역명 또는 잘못된 요청 데이터
- `404 Not Found`: 창고를 찾을 수 없음

---

## 로케이션 조회

### 1. 로케이션 목록 조회 (페이징, 필터링, 검색)

**엔드포인트**: `GET /wms/locations/warehouses/:warehouseId`

**설명**: 특정 창고의 모든 로케이션(표준 로케이션 + 구역 로케이션)을 조회합니다. 페이징, 필터링, 검색 기능을 지원합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**쿼리 파라미터** (`LocationQueryDto`):
- `type` (string, optional): 로케이션 타입 필터 (`standard` | `zone`)
- `columnName` (string, optional): 열 이름 필터
- `rackNumber` (number, optional): 랙 번호 필터
- `isActive` (boolean, optional): 활성 상태 필터
- `search` (string, optional): 검색어 (코드나 이름으로 검색)
- `page` (number, optional): 페이지 번호 (기본값: 1)
- `limit` (number, optional): 페이지당 항목 수 (기본값: 20, 최대: 100)
- `sortBy` (string, optional): 정렬 필드 (`code` | `createdAt` | `columnName` | `rackNumber`, 기본값: `code`)
- `sortOrder` (string, optional): 정렬 순서 (`asc` | `desc`, 기본값: `asc`)

**요청 예시**:
```
GET /wms/locations/warehouses/warehouse-uuid-456?type=standard&columnName=A&isActive=true&page=1&limit=20&sortBy=code&sortOrder=asc
```

**응답 예시** (200 OK):
```json
{
  "items": [
    {
      "id": "loc-uuid-123",
      "code": "A-01-01",
      "displayName": "A-01-01",
      "type": "standard",
      "warehouseId": "warehouse-uuid-456",
      "isActive": true,
      "metadata": {
        "capacityLimit": 100,
        "fifoRank": 1,
        "isExpirySeparated": false
      },
      "rackId": "rack-uuid-123",
      "binIdentifier": "01",
      "columnName": "A",
      "rackNumber": 1,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z"
    },
    {
      "id": "zone-uuid-123",
      "code": "zone-1",
      "displayName": "입고 기본 구역",
      "type": "zone",
      "warehouseId": "warehouse-uuid-456",
      "isActive": true,
      "metadata": {
        "capacityLimit": 1000,
        "fifoRank": 1
      },
      "rackId": null,
      "binIdentifier": null,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20,
  "totalPages": 8,
  "hasNext": true,
  "hasPrev": false
}
```

---

### 2. 로케이션 상세 조회

**엔드포인트**: `GET /wms/locations/:locationId`

**설명**: 특정 로케이션의 상세 정보를 조회합니다.

**경로 파라미터**:
- `locationId` (string, required): 로케이션 ID

**응답 예시 - 표준 로케이션** (200 OK):
```json
{
  "id": "loc-uuid-123",
  "code": "A-01-01",
  "displayName": "A-01-01",
  "type": "standard",
  "warehouseId": "warehouse-uuid-456",
  "isActive": true,
  "metadata": {
    "capacityLimit": 100,
    "fifoRank": 1,
    "isExpirySeparated": false,
    "notes": "메인 보관 위치"
  },
  "rackId": "rack-uuid-123",
  "binIdentifier": "01",
  "columnName": "A",
  "rackNumber": 1,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

**응답 예시 - 구역 로케이션** (200 OK):
```json
{
  "id": "zone-uuid-123",
  "code": "zone-1",
  "displayName": "입고 기본 구역",
  "type": "zone",
  "warehouseId": "warehouse-uuid-456",
  "isActive": true,
  "metadata": {
    "capacityLimit": 1000,
    "fifoRank": 1,
    "isExpirySeparated": false,
    "notes": "입고된 상품의 기본 보관 구역"
  },
  "rackId": null,
  "binIdentifier": null,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

**에러 응답**:
- `404 Not Found`: 로케이션을 찾을 수 없음

---

## 로케이션 수정

### 1. 로케이션 정보 수정

**엔드포인트**: `PUT /wms/locations/:locationId`

**설명**: 로케이션의 메타데이터 정보를 수정합니다. 시스템 로케이션의 경우 제한적으로만 수정 가능합니다.

**경로 파라미터**:
- `locationId` (string, required): 로케이션 ID

**요청 본문** (`UpdateLocationDto`):
```json
{
  "displayName": "수정된 표시명",
  "capacityLimit": 150,
  "fifoRank": 2,
  "isExpirySeparated": true,
  "isActive": true,
  "notes": "수정된 메모"
}
```

**필드 설명** (모든 필드 optional):
- `displayName` (string, optional): 표시명
- `capacityLimit` (number, optional): 용량 제한
- `fifoRank` (number, optional): FIFO 순위
- `isExpirySeparated` (boolean, optional): 유통기한별 분리 보관 여부
- `isActive` (boolean, optional): 활성 상태
- `notes` (string, optional): 메모

**시스템 로케이션 수정 제한**:
시스템 로케이션(입고기본존, 반품기본존 등)의 경우 다음 필드만 수정 가능합니다:
- `displayName`
- `notes`
- `isActive`
- `capacityLimit`
- `fifoRank`
- `isExpirySeparated`

다음 필드는 수정 불가:
- `code`
- `locationType`
- `systemRole`

**응답 예시** (200 OK):
```json
{
  "id": "loc-uuid-123",
  "code": "A-01-01",
  "displayName": "수정된 표시명",
  "type": "standard",
  "warehouseId": "warehouse-uuid-456",
  "isActive": true,
  "metadata": {
    "capacityLimit": 150,
    "fifoRank": 2,
    "isExpirySeparated": true,
    "notes": "수정된 메모"
  },
  "rackId": "rack-uuid-123",
  "binIdentifier": "01",
  "columnName": "A",
  "rackNumber": 1,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T11:00:00Z"
}
```

**에러 응답**:
- `400 Bad Request`: 시스템 로케이션의 수정 불가 필드 수정 시도
- `404 Not Found`: 로케이션을 찾을 수 없음

---

## 커스텀 빈 추가

### 1. 기존 랙에 커스텀 빈 추가

**엔드포인트**: `POST /wms/locations/warehouses/:warehouseId/racks/custom-bins`

**설명**: 기존 랙에 "바닥", "상단" 등의 특수 빈을 추가합니다.

**경로 파라미터**:
- `warehouseId` (string, required): 창고 ID

**요청 본문** (`AddCustomBinDto`):
```json
{
  "columnName": "A",
  "rackNumber": 1,
  "customBinName": "바닥",
  "displayName": "바닥 보관",
  "capacityLimit": 200,
  "notes": "대형 상품 보관용"
}
```

**필드 설명**:
- `columnName` (string, required): 열 이름
- `rackNumber` (number, required): 랙 번호
- `customBinName` (string, required): 커스텀 빈 이름
- `displayName` (string, optional): 표시명
- `capacityLimit` (number, optional): 용량 제한
- `notes` (string, optional): 메모

**응답 예시** (201 Created):
```json
{
  "id": "loc-uuid-456",
  "code": "A-01-바닥",
  "displayName": "바닥 보관",
  "type": "standard",
  "warehouseId": "warehouse-uuid-456",
  "isActive": true,
  "metadata": {
    "capacityLimit": 200,
    "notes": "대형 상품 보관용"
  },
  "rackId": "rack-uuid-123",
  "binIdentifier": "바닥",
  "columnName": "A",
  "rackNumber": 1,
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:00:00Z"
}
```

**에러 응답**:
- `400 Bad Request`: 랙이 없음, 중복된 빈 이름 등
- `404 Not Found`: 창고를 찾을 수 없음

---

## DTO 상세

### CreateColumnDto
```typescript
{
  columnName: string;        // 열 이름 (required)
  displayOrder?: number;     // 정렬 순서 (optional)
}
```

### CreateRackDto
```typescript
{
  columnName: string;                    // 열 이름 (required)
  rackNumber: number;                    // 랙 번호 (required, 1-999)
  binSettings: {
    autoGenerate: boolean;               // 빈 자동 생성 여부 (required)
    standardBins?: {                     // 표준 빈 범위 (optional)
      start: number;                     // 시작 빈 번호 (1 이상)
      end: number;                       // 끝 빈 번호 (1-999)
    };
    customBins?: string[];               // 커스텀 빈 이름 배열 (optional)
  };
  physicalWidth?: number;                // 물리적 너비 (cm, optional)
  physicalHeight?: number;               // 물리적 높이 (cm, optional)
  notes?: string;                        // 메모 (optional)
}
```

### CreateZoneLocationDto
```typescript
{
  code: string;                          // 구역 로케이션 코드 (required)
  displayName?: string;                  // 표시명 (optional)
  capacityLimit?: number;                 // 용량 제한 (optional)
  fifoRank?: number;                     // FIFO 순위 (optional)
  isExpirySeparated?: boolean;           // 유통기한별 분리 보관 여부 (optional)
  notes?: string;                        // 메모 (optional)
}
```

### UpdateLocationDto
```typescript
{
  displayName?: string;                  // 표시명 (optional)
  capacityLimit?: number;                // 용량 제한 (optional)
  fifoRank?: number;                     // FIFO 순위 (optional)
  isExpirySeparated?: boolean;           // 유통기한별 분리 보관 여부 (optional)
  isActive?: boolean;                    // 활성 상태 (optional)
  notes?: string;                        // 메모 (optional)
}
```

### UpdateColumnDto
```typescript
{
  columnName?: string;                    // 열 이름 (optional)
  displayOrder?: number;                 // 정렬 순서 (optional)
  isActive?: boolean;                    // 활성 상태 (optional)
}
```

### UpdateRackDto
```typescript
{
  defaultBinStart?: number;              // 기본 빈 시작 번호 (optional)
  defaultBinEnd?: number;                // 기본 빈 끝 번호 (optional)
  autoGenerateBins?: boolean;            // 빈 자동 생성 여부 (optional)
  physicalWidth?: number;                // 물리적 너비 (cm, optional)
  physicalHeight?: number;               // 물리적 높이 (cm, optional)
  notes?: string;                        // 메모 (optional)
  isActive?: boolean;                    // 활성 상태 (optional)
}
```

### LocationQueryDto
```typescript
{
  type?: 'standard' | 'zone';            // 로케이션 타입 필터 (optional)
  columnName?: string;                   // 열 이름 필터 (optional)
  rackNumber?: number;                   // 랙 번호 필터 (optional)
  isActive?: boolean;                    // 활성 상태 필터 (optional)
  search?: string;                       // 검색어 (optional)
  page?: number;                         // 페이지 번호 (optional, 기본값: 1)
  limit?: number;                        // 페이지당 항목 수 (optional, 기본값: 20, 최대: 100)
  sortBy?: 'code' | 'createdAt' | 'columnName' | 'rackNumber';  // 정렬 필드 (optional)
  sortOrder?: 'asc' | 'desc';            // 정렬 순서 (optional, 기본값: 'asc')
}
```

### LocationResponseDto (기본)
```typescript
{
  id: string;                             // 로케이션 ID
  code: string;                           // 로케이션 코드
  displayName: string;                    // 표시명
  type: 'standard' | 'zone';             // 로케이션 타입
  warehouseId: string;                    // 창고 ID
  isActive: boolean;                      // 활성 상태
  metadata?: {                            // 메타데이터 (optional)
    capacityLimit?: number;
    fifoRank?: number;
    isExpirySeparated?: boolean;
    notes?: string;
  };
  createdAt: Date;                        // 생성일시
  updatedAt: Date;                        // 수정일시
}
```

### StandardLocationResponseDto
```typescript
extends LocationResponseDto {
  type: 'standard';                      // 표준 로케이션 타입
  rackId: string;                        // 랙 ID
  binIdentifier: string;                  // 빈 식별자
  columnName?: string;                    // 열 이름 (optional)
  rackNumber?: number;                    // 랙 번호 (optional)
}
```

### ZoneLocationResponseDto
```typescript
extends LocationResponseDto {
  type: 'zone';                           // 구역 로케이션 타입
  rackId: null;                          // 랙 ID는 항상 null
  binIdentifier: null;                    // 빈 식별자는 항상 null
}
```

### LocationListResponseDto
```typescript
{
  items: LocationResponseDto[];          // 로케이션 목록
  total: number;                         // 총 항목 수
  page: number;                          // 현재 페이지
  limit: number;                         // 페이지당 항목 수
  totalPages: number;                    // 총 페이지 수
  hasNext: boolean;                      // 다음 페이지 존재 여부
  hasPrev: boolean;                      // 이전 페이지 존재 여부
}
```

---

## 에러 처리

API는 다음과 같은 HTTP 상태 코드를 반환합니다:

### 성공 응답
- `200 OK`: 요청 성공 (조회, 수정)
- `201 Created`: 리소스 생성 성공

### 클라이언트 에러
- `400 Bad Request`: 잘못된 요청 데이터
  - 중복된 열 이름
  - 중복된 랙
  - 중복된 구역명
  - 잘못된 빈 범위
  - 시스템 로케이션의 수정 불가 필드 수정 시도
- `404 Not Found`: 리소스를 찾을 수 없음
  - 창고를 찾을 수 없음
  - 열을 찾을 수 없음
  - 랙을 찾을 수 없음
  - 로케이션을 찾을 수 없음

### 서버 에러
- `500 Internal Server Error`: 서버 내부 오류

### 에러 응답 형식
에러 응답은 일반적으로 다음과 같은 형식을 따릅니다:

```json
{
  "statusCode": 400,
  "message": "Column name 'A' already exists in this warehouse",
  "error": "Bad Request"
}
```

또는 서비스에서 던진 에러 메시지에 따라:

```json
{
  "statusCode": 404,
  "message": "Location not found",
  "error": "Not Found"
}
```

---

## 주의사항

1. **시스템 로케이션 보호**: 시스템 로케이션(입고기본존, 반품기본존 등)은 삭제할 수 없으며, 일부 필드만 수정 가능합니다.

2. **로케이션 코드 형식**:
   - 표준 로케이션: `{열이름}-{랙번호}-{빈번호}` (예: `A-01-01`)
   - 커스텀 빈: `{열이름}-{랙번호}-{커스텀빈이름}` (예: `A-01-바닥`)
   - 구역 로케이션: 자유 형식 (한글 포함 시 자동으로 `zone-N` 코드 생성)

3. **빈 자동 생성**: 랙 생성 시 `autoGenerate: true`로 설정하면 표준 빈들이 자동으로 생성됩니다. 나중에 커스텀 빈을 추가할 수 있습니다.

4. **페이징**: 로케이션 목록 조회 시 기본적으로 20개씩 페이징되며, 최대 100개까지 조회 가능합니다.

5. **정렬**: 기본 정렬은 코드(`code`) 기준 오름차순입니다.

---

## 예제 시나리오

### 시나리오 1: 표준 로케이션 구조 생성

1. 열 생성: `POST /wms/locations/warehouses/{warehouseId}/columns`
   ```json
   { "columnName": "A" }
   ```

2. 랙 생성 (빈 자동 생성): `POST /wms/locations/warehouses/{warehouseId}/racks`
   ```json
   {
     "columnName": "A",
     "rackNumber": 1,
     "binSettings": {
       "autoGenerate": true,
       "standardBins": { "start": 1, "end": 15 }
     }
   }
   ```
   → `A-01-01` ~ `A-01-15` 로케이션 자동 생성

3. 커스텀 빈 추가: `POST /wms/locations/warehouses/{warehouseId}/racks/custom-bins`
   ```json
   {
     "columnName": "A",
     "rackNumber": 1,
     "customBinName": "바닥"
   }
   ```
   → `A-01-바닥` 로케이션 생성

### 시나리오 2: 구역 로케이션 생성

1. 구역 로케이션 생성: `POST /wms/locations/warehouses/{warehouseId}/zones`
   ```json
   {
     "code": "입고기본존",
     "displayName": "입고 기본 구역",
     "capacityLimit": 1000,
     "fifoRank": 1
   }
   ```
   → `zone-1` 코드로 자동 변환되지만 표시명은 "입고 기본 구역" 유지

### 시나리오 3: 로케이션 조회 및 필터링

1. 특정 열의 활성 로케이션만 조회:
   ```
   GET /wms/locations/warehouses/{warehouseId}?type=standard&columnName=A&isActive=true
   ```

2. 검색어로 로케이션 찾기:
   ```
   GET /wms/locations/warehouses/{warehouseId}?search=A-01
   ```

3. 페이징 및 정렬:
   ```
   GET /wms/locations/warehouses/{warehouseId}?page=1&limit=50&sortBy=code&sortOrder=asc
   ```

---

## 관련 문서

- [WMS 인바운드 API 문서](../inbound/INBOUND_API_DOCUMENTATION.md)
- [재고 관리 API 문서](./INVENTORY_API_DOCUMENTATION.md) (작성 예정)

