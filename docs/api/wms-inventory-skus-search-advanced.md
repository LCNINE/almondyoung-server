# 고급 재고 검색 API

## 개요

SKU 정보와 재고 정보를 함께 조회하는 고급 검색 API입니다. 다양한 필터 옵션을 제공하며, 각 SKU의 현재 재고 수량(`currentStock`)을 포함합니다.

**엔드포인트**: `GET /wms/inventory/skus/search/advanced`

**태그**: Inventory

---

## 설명

이 API는 다음 기능을 제공합니다:

- SKU 기본 정보 조회 (이름, 코드, 옵션 등)
- **재고 정보 포함** (`currentStock` 필드)
- 다양한 필터 옵션 (검색어, 재고 상태, 창고, 공급처 등)
- 페이지네이션 지원
- 정렬 기능

**재고 정보 동작 방식**:
- `warehouseId` 필터가 제공되면 해당 창고의 재고만 합산
- `warehouseId` 필터가 없으면 모든 창고의 재고를 합산

---

## 요청 파라미터

모든 파라미터는 선택적(optional)입니다.

### 기본 검색

| 파라미터 | 타입 | 설명 | 예시 |
|---------|------|------|------|
| `search` | string | SKU 이름/코드 검색 (부분 일치) | `lash` |
| `barcode` | string | 바코드 검색 | `8801234567890` |

### 재고 필터

| 파라미터 | 타입 | 설명 | 가능한 값 |
|---------|------|------|----------|
| `displayMode` | enum | 재고 표시 모드 | `all`, `below_safety`, `with_stock`, `out_of_stock` |
| `warehouseId` | string | 창고 ID (UUID) | `550e8400-e29b-41d4-a716-446655440001` |
| `locationId` | string | 위치 ID (UUID) | `550e8400-e29b-41d4-a716-446655440002` |
| `stockType` | string | 재고 유형 | `normal` |

**displayMode 값 설명**:
- `all`: 모든 SKU 조회
- `below_safety`: 안전 재고 미만인 SKU만 조회
- `with_stock`: 재고가 있는 SKU만 조회
- `out_of_stock`: 재고가 없는 SKU만 조회

### 공급처 필터

| 파라미터 | 타입 | 설명 | 예시 |
|---------|------|------|------|
| `supplierId` | string | 공급처 ID (UUID) | `550e8400-e29b-41d4-a716-446655440000` |

### 날짜 범위 필터

| 파라미터 | 타입 | 설명 | 형식 | 예시 |
|---------|------|------|------|------|
| `startDate` | string | 시작일 | YYYY-MM-DD | `2025-01-01` |
| `endDate` | string | 종료일 | YYYY-MM-DD | `2025-12-31` |

### WMS 내부 그룹 필터

| 파라미터 | 타입 | 설명 | 예시 |
|---------|------|------|------|
| `groupId` | string (UUID) | SKU 그룹 ID | `550e8400-e29b-41d4-a716-446655440003` |
| `groupCode` | string | SKU 그룹 코드 | `LASH-GROUP-001` |
| `isGrouped` | boolean | 그룹화된 SKU만 조회 (`true`=그룹 있음, `false`=독립 SKU) | `true` |
| `inventoryMasterId` | string (UUID) | Inventory Master ID | `550e8400-e29b-41d4-a716-446655440004` |

### 페이지네이션

| 파라미터 | 타입 | 설명 | 기본값 | 최소값 | 최대값 |
|---------|------|------|--------|--------|--------|
| `limit` | number | 페이지 크기 | `50` | `1` | `200` |
| `offset` | number | 페이지 오프셋 | `0` | `0` | - |

### 정렬

| 파라미터 | 타입 | 설명 | 가능한 값 |
|---------|------|------|----------|
| `sortBy` | string | 정렬 필드 | `name`, `code`, `createdAt`, `updatedAt`, `safetyStock` |
| `sortOrder` | enum | 정렬 방향 | `asc`, `desc` |

**기본값**: `sortBy=createdAt`, `sortOrder=desc`

---

## 응답

### 성공 응답 (200 OK)

```json
{
  "items": [
    {
      "id": "c9ed36fe-7c98-42ca-b459-a17a195aa9db",
      "name": "아이래쉬 마스카라",
      "code": "LASH-001",
      "defaultBarcode": "8801234567890",
      "deliveryProfileId": "550e8400-e29b-41d4-a716-446655440000",
      "sale1m": 150,
      "sale3m": 450,
      "safetyStock": 10,
      "currentStock": 150,
      "masterId": "550e8400-e29b-41d4-a716-446655440004",
      "optionKey": "M / 흰색",
      "master": {
        "id": "550e8400-e29b-41d4-a716-446655440004",
        "name": "아이래쉬 마스카라",
        "code": "LASH-MASTER-001",
        "hasOptions": true
      },
      "barcodes": [
        {
          "id": "barcode-id-1",
          "barcode": "8801234567890",
          "barcodeType": "standard",
          "packingUnit": "EA"
        }
      ],
      "supplierNames": ["공급처 A", "공급처 B"],
      "categoryNames": ["화장품", "마스카라"],
      "mainImageUrl": "https://example.com/images/lash-001.jpg",
      "createdAt": "2025-01-15T10:00:00Z",
      "updatedAt": "2025-01-20T15:30:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

### 응답 필드 설명

#### items 배열

각 SKU 객체는 다음 필드를 포함합니다:

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `id` | string (UUID) | ✅ | SKU ID |
| `name` | string | ✅ | SKU 이름 |
| `code` | string | ✅ | SKU 코드 |
| `defaultBarcode` | string | ❌ | 기본 바코드 |
| `deliveryProfileId` | string (UUID) | ❌ | 배송 프로필 ID |
| `sale1m` | number | ❌ | 1개월 판매량 |
| `sale3m` | number | ❌ | 3개월 판매량 |
| `safetyStock` | number | ✅ | 안전 재고 (기본값: 0) |
| `currentStock` | number | ✅ | **현재 재고 수량** (warehouseId 필터가 있으면 해당 창고만, 없으면 모든 창고 합계) |
| `masterId` | string (UUID) | ✅ | 마스터 ID |
| `optionKey` | string | ❌ | 옵션 식별자 (예: "M / 흰색") |
| `master` | object | ❌ | 마스터 정보 |
| `master.id` | string (UUID) | - | 마스터 ID |
| `master.name` | string | - | 마스터 이름 |
| `master.code` | string | - | 마스터 코드 |
| `master.hasOptions` | boolean | - | 옵션 존재 여부 |
| `barcodes` | array | ✅ | 바코드 목록 (빈 배열 가능) |
| `barcodes[].id` | string | - | 바코드 ID |
| `barcodes[].barcode` | string | - | 바코드 값 |
| `barcodes[].barcodeType` | string | - | 바코드 타입 |
| `barcodes[].packingUnit` | string | ❌ | 포장 단위 |
| `supplierNames` | string[] | ✅ | 공급처 이름 목록 |
| `categoryNames` | string[] | ✅ | 카테고리 이름 목록 |
| `mainImageUrl` | string | ❌ | 메인 이미지 URL |
| `createdAt` | string (ISO 8601) | ✅ | 생성일시 |
| `updatedAt` | string (ISO 8601) | ✅ | 수정일시 |

#### 페이지네이션 정보

| 필드 | 타입 | 설명 |
|------|------|------|
| `total` | number | 전체 결과 수 |
| `limit` | number | 페이지 크기 |
| `offset` | number | 페이지 오프셋 |

---

## 사용 예시

### 예시 1: 기본 검색

```http
GET /wms/inventory/skus/search/advanced?search=lash&limit=20&offset=0
```

**설명**: "lash"가 포함된 SKU 이름/코드를 검색하고, 첫 20개 결과를 반환합니다.

### 예시 2: 재고 상태 필터링

```http
GET /wms/inventory/skus/search/advanced?displayMode=below_safety&warehouseId=550e8400-e29b-41d4-a716-446655440001
```

**설명**: 특정 창고에서 안전 재고 미만인 SKU만 조회합니다.

### 예시 3: 재고가 있는 SKU만 조회

```http
GET /wms/inventory/skus/search/advanced?displayMode=with_stock&sortBy=currentStock&sortOrder=desc
```

**설명**: 재고가 있는 SKU를 재고 수량 기준 내림차순으로 정렬합니다.

### 예시 4: 복합 필터

```http
GET /wms/inventory/skus/search/advanced?search=마스카라&supplierId=550e8400-e29b-41d4-a716-446655440000&warehouseId=550e8400-e29b-41d4-a716-446655440001&displayMode=with_stock&limit=50&offset=0&sortBy=name&sortOrder=asc
```

**설명**: 
- "마스카라"가 포함된 SKU
- 특정 공급처
- 특정 창고
- 재고가 있는 것만
- 이름 기준 오름차순 정렬
- 50개씩 페이지네이션

---

## 주의사항

1. **재고 정보 (`currentStock`)**:
   - `warehouseId` 필터가 제공되면 해당 창고의 재고만 합산됩니다
   - `warehouseId` 필터가 없으면 모든 창고의 재고를 합산합니다
   - 재고가 없는 경우 `0`을 반환합니다

2. **페이지네이션**:
   - `limit`의 최대값은 200입니다
   - `offset`은 0부터 시작합니다

3. **정렬**:
   - 기본 정렬은 `createdAt` 기준 내림차순입니다
   - `sortBy`에 `currentStock`은 포함되지 않습니다 (재고 기준 정렬은 지원하지 않음)

4. **필터 조합**:
   - 여러 필터를 동시에 사용할 수 있으며, AND 조건으로 결합됩니다

---

## 에러 응답

### 400 Bad Request
잘못된 파라미터 형식이나 값이 전달된 경우

### 500 Internal Server Error
서버 내부 오류가 발생한 경우

---

## 관련 API

- `GET /wms/inventory/stocks/summary` - 재고 현황 요약 조회
- `GET /wms/inventory/stocks/sku/:skuId/total` - SKU별 총 재고 조회
- `GET /wms/inventory/stocks/sku/:skuId/warehouse/:warehouseId` - 특정 창고의 SKU별 재고 상세 조회
- `GET /wms/inventory/skus/:id` - SKU 상세 조회

