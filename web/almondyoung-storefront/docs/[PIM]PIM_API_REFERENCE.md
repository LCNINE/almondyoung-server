# PIM API 문서

## 개요

PIM (Product Information Management) API는 상품 정보 관리 시스템의 RESTful API입니다. 제품 마스터, 변형, 카테고리, 판매 채널, 채널별 제품 정보를 관리합니다.

**Base URL**:

- 개발: `https://pim-development.up.railway.app`
- 프로덕션: `https://pim.almondyoung.com`

**API 버전**: 1.0.0

**Swagger 문서**: `/docs`

---

## 목차

1. [Health Check](#health-check)
2. [제품 마스터 (Product Masters)](#제품-마스터-product-masters)
3. [제품 변형 (Product Variants)](#제품-변형-product-variants)
4. [제품 버전 (Product Versions)](#제품-버전-product-versions)
5. [카테고리 (Categories)](#카테고리-categories)
6. [태그 (Tags)](#태그-tags)
7. [가격 정책 (Pricing)](#가격-정책-pricing)
8. [판매 채널 (Sales Channels)](#판매-채널-sales-channels)
9. [채널별 제품 (Channel Products)](#채널별-제품-channel-products)
10. [배너 (Banners)](#배너-banners)
11. [배너 그룹 (Banner Groups)](#배너-그룹-banner-groups)
12. [제품 검색 (Product Search)](#제품-검색-product-search)
13. [CSV 작업 (Product CSV)](#csv-작업-product-csv)
14. [대시보드 (Dashboard)](#대시보드-dashboard)

---

## Health Check

### 서비스 헬스체크

서비스 상태를 확인합니다.

**요청**

```
GET /health
```

**응답**

```json
{
  "status": "ok",
  "service": "PIM (Product Information Management)"
}
```

**상태 코드**

- `200 OK`: 서비스 정상 작동

---

## 제품 마스터 (Product Masters)

### 제품 마스터 생성

빈 draft 상태의 판매 상품을 생성합니다.

**요청**

```
POST /masters
Content-Type: application/json
```

**요청 본문** (모든 필드 선택사항, 빈 객체로 호출 가능)

```json
{
  "name": "새 상품",
  "description": "상품 설명",
  "brand": "브랜드명"
}
```

**응답**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "새 상품",
  "description": "상품 설명",
  "brand": "브랜드명",
  "basePrice": 0,
  "status": "draft",
  "isWholesaleOnly": false,
  "isMembershipOnly": false,
  "images": {
    "primary": null,
    "additional": []
  },
  "optionGroups": [],
  "variants": []
}
```

**상태 코드**

- `201 Created`: 제품 마스터 생성 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `500 Internal Server Error`: 서버 오류

**워크플로우**

1. `POST /masters {}` - 빈 draft 생성 (name: "새 상품", 기본 variant 1개)
2. `PUT /masters/:id { name, description, ... }` - 기본 정보 입력
3. `PUT /masters/:id { optionDiff: { add: [...] } }` - 옵션 추가 (variants 자동 생성)
4. `PUT /products/:masterId/pricing { ... }` - 가격 정책 설정
5. `PATCH /masters/:masterId/versions/:versionId/publish` - 활성화

---

### 제품 마스터 목록 조회

제품 마스터 목록을 필터링 및 페이지네이션과 함께 조회합니다.

**요청**

```
GET /masters?page=1&limit=20&status=active&categoryId=xxx&brand=xxx&search=xxx&versionStatus=active&includeAllVersions=false
```

**쿼리 파라미터**

- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수
- `status` (optional): 제품 상태 필터
- `categoryId` (optional): 카테고리 ID 필터
- `brand` (optional): 브랜드 필터
- `search` (optional): 검색 키워드
- `versionStatus` (optional): 버전 상태 필터 (`draft`, `inactive`, `active`, 기본값: `active`)
- `includeAllVersions` (optional): 모든 버전 포함 여부 (기본값: `false`, active만 조회)

**응답**

```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "제품명",
      "brand": "브랜드명",
      "basePrice": 10000,
      "status": "active"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

**상태 코드**

- `200 OK`: 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 제품 마스터 상세 조회

특정 제품 마스터의 상세 정보와 연결된 이미지들을 조회합니다.

**요청**

```
GET /masters/:id
```

**경로 파라미터**

- `id`: 제품 마스터 ID

**응답**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "제품명",
  "description": "제품 설명",
  "brand": "브랜드명",
  "basePrice": 10000,
  "status": "active",
  "isWholesaleOnly": false,
  "isMembershipOnly": false,
  "images": {
    "primary": {
      "id": "image-id",
      "url": "https://example.com/image.jpg",
      "originalName": "product.jpg",
      "fileName": "product.jpg",
      "mimeType": "image/jpeg",
      "size": 102400
    },
    "additional": [
      {
        "id": "image-id-2",
        "url": "https://example.com/image2.jpg",
        "originalName": "product2.jpg",
        "fileName": "product2.jpg",
        "sortOrder": 1
      }
    ]
  },
  "optionGroups": [],
  "variants": [],
  "channelProducts": []
}
```

**상태 코드**

- `200 OK`: 조회 성공
- `404 Not Found`: 제품 마스터를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 마스터 수정

기존 제품 마스터 정보를 수정합니다. draft 상태의 버전만 수정 가능합니다.

**요청**

```
PUT /masters/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 제품 마스터 ID (버전 ID)

**요청 본문**

```json
{
  "name": "수정된 제품명",
  "description": "수정된 설명",
  "brand": "브랜드명",
  "optionDiff": {
    "add": [
      {
        "name": "색상",
        "values": ["빨강", "파랑", "노랑"]
      }
    ],
    "remove": ["옵션그룹ID"]
  }
}
```

**응답**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "수정된 제품명",
    "description": "수정된 설명"
  }
}
```

**상태 코드**

- `200 OK`: 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `403 Forbidden`: draft 상태의 버전만 수정 가능
- `404 Not Found`: 제품 마스터를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 마스터 소프트 삭제

제품 마스터를 소프트 삭제합니다. 실제로 데이터는 삭제되지 않으며 복원이 가능합니다.

**요청**

```
DELETE /masters/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 삭제할 제품 마스터 ID

**요청 본문**

```json
{
  "userId": "user-id"
}
```

**응답**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "제품명",
  "deletedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `200 OK`: 소프트 삭제 성공
- `400 Bad Request`: 삭제 요구사항 불충족
- `404 Not Found`: 제품 마스터를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 마스터 복원

소프트 삭제된 제품 마스터를 복원합니다.

**요청**

```
POST /masters/:id/restore
Content-Type: application/json
```

**경로 파라미터**

- `id`: 복원할 제품 마스터 ID

**요청 본문**

```json
{
  "userId": "user-id"
}
```

**응답**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "제품명",
  "deletedAt": null
}
```

**상태 코드**

- `200 OK`: 복원 성공
- `400 Bad Request`: 제품이 삭제되지 않았음
- `404 Not Found`: 제품 마스터를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 마스터 영구 삭제

제품 마스터를 영구적으로 삭제합니다. 이 작업은 되돌릴 수 없습니다.

**요청**

```
DELETE /masters/:id/permanent
Content-Type: application/json
```

**경로 파라미터**

- `id`: 영구 삭제할 제품 마스터 ID

**요청 본문**

```json
{
  "userId": "user-id"
}
```

**응답**

```json
{
  "deleted": true
}
```

**상태 코드**

- `200 OK`: 영구 삭제 성공
- `404 Not Found`: 제품 마스터를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 삭제된 제품 마스터 목록 조회

소프트 삭제된 제품 마스터 목록을 조회합니다.

**요청**

```
GET /masters/deleted
```

**응답**

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "제품명",
    "deletedAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**상태 코드**

- `200 OK`: 조회 성공
- `500 Internal Server Error`: 서버 오류

---

## 제품 변형 (Product Variants)

### 마스터별 제품 변형 조회

특정 제품 마스터의 모든 변형(색상, 사이즈 등)을 조회합니다.

**요청**

```
GET /variants/masters/:masterId?status=active&includePrice=true&page=1&limit=20
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**쿼리 파라미터**

- `status` (optional): 변형 상태 필터
- `includePrice` (optional): 가격 정보 포함 여부 (기본값: `true`)
- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수

**응답**

```json
{
  "items": [
    {
      "id": "variant-id",
      "masterId": "master-id",
      "sku": "SKU-001",
      "options": {
        "색상": "빨강",
        "사이즈": "M"
      },
      "price": 10000,
      "status": "active"
    }
  ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

**상태 코드**

- `200 OK`: 조회 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `500 Internal Server Error`: 서버 오류

---

### 제품 변형 상세 조회

특정 제품 변형의 상세 정보를 조회합니다.

**요청**

```
GET /variants/:id
```

**경로 파라미터**

- `id`: 제품 변형 ID

**응답**

```json
{
  "id": "variant-id",
  "masterId": "master-id",
  "sku": "SKU-001",
  "options": {
    "색상": "빨강",
    "사이즈": "M"
  },
  "price": 10000,
  "status": "active"
}
```

**상태 코드**

- `200 OK`: 조회 성공
- `400 Bad Request`: 잘못된 요청
- `404 Not Found`: 제품 변형을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 변형 수정

기존 제품 변형 정보를 수정합니다.

**요청**

```
PUT /variants/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 제품 변형 ID

**요청 본문**

```json
{
  "sku": "SKU-002",
  "price": 12000,
  "status": "active"
}
```

**응답**

```json
{
  "success": true,
  "data": {
    "id": "variant-id",
    "sku": "SKU-002",
    "price": 12000,
    "status": "active"
  }
}
```

**상태 코드**

- `200 OK`: 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 제품 변형을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 변형 일괄 수정

여러 제품 변형을 동시에 수정합니다.

**요청**

```
PUT /variants/bulk
Content-Type: application/json
```

**요청 본문**

```json
{
  "updates": [
    {
      "id": "variant-id-1",
      "price": 10000
    },
    {
      "id": "variant-id-2",
      "price": 12000
    }
  ]
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 일괄 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 일부 제품 변형을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 변형 상태 수정

제품 변형의 상태를 수정합니다 (활성/비활성 등).

**요청**

```
PUT /variants/:id/status
Content-Type: application/json
```

**경로 파라미터**

- `id`: 제품 변형 ID

**요청 본문**

```json
{
  "status": "inactive"
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 상태 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터 (status 필수)
- `404 Not Found`: 제품 변형을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 제품 버전 (Product Versions)

### 버전 트리 조회

특정 Master ID에 대한 모든 버전을 트리 구조로 조회합니다.

**요청**

```
GET /masters/:masterId/versions
```

**경로 파라미터**

- `masterId`: Master ID

**응답**

```json
[
  {
    "id": "version-id",
    "masterId": "master-id",
    "version": "1.0.0",
    "versionStatus": "active",
    "name": "제품명",
    "parentVersionId": null,
    "children": [],
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z",
    "draftOwnerId": null
  }
]
```

**상태 코드**

- `200 OK`: 조회 성공
- `404 Not Found`: 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### Active 버전 조회

특정 Master ID의 현재 active 상태인 버전을 조회합니다.

**요청**

```
GET /masters/:masterId/versions/active
```

**경로 파라미터**

- `masterId`: Master ID

**응답**

```json
{
  "id": "version-id",
  "masterId": "master-id",
  "version": "1.0.0",
  "versionStatus": "active",
  "name": "제품명",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `200 OK`: 조회 성공
- `404 Not Found`: Active 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 새 Draft 버전 생성

기존 버전을 기반으로 새로운 draft 버전을 생성합니다.

**요청**

```
POST /masters/:masterId/versions
Content-Type: application/json
```

**경로 파라미터**

- `masterId`: Master ID

**요청 본문**

```json
{
  "parentVersionId": "parent-version-id",
  "copyMappings": true
}
```

**응답**

```json
{
  "id": "new-version-id",
  "masterId": "master-id",
  "version": "1.1.0",
  "versionStatus": "draft",
  "name": "제품명",
  "parentVersionId": "parent-version-id",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: Draft 버전 생성 성공
- `400 Bad Request`: 잘못된 요청
- `404 Not Found`: 부모 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 버전 Publish

Draft 버전을 active 또는 inactive 상태로 변경합니다.

**요청**

```
PATCH /masters/:masterId/versions/:versionId/publish
Content-Type: application/json
```

**경로 파라미터**

- `masterId`: Master ID
- `versionId`: Version ID

**요청 본문**

```json
{
  "targetStatus": "active"
}
```

**응답**

```json
{
  "message": "Version published successfully"
}
```

**상태 코드**

- `200 OK`: 버전 publish 성공
- `400 Bad Request`: Draft 상태가 아닌 버전은 publish할 수 없음
- `404 Not Found`: 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 버전 비교

두 버전 간의 차이점을 비교합니다.

**요청**

```
GET /masters/:masterId/versions/:versionId/compare/:compareVersionId
```

**경로 파라미터**

- `masterId`: Master ID
- `versionId`: 비교 대상 버전 ID 1
- `compareVersionId`: 비교 대상 버전 ID 2

**응답**

```json
[
  {
    "field": "name",
    "oldValue": "이전 제품명",
    "newValue": "새 제품명"
  },
  {
    "field": "price",
    "oldValue": 10000,
    "newValue": 12000
  }
]
```

**상태 코드**

- `200 OK`: 버전 비교 성공
- `400 Bad Request`: 다른 master의 버전은 비교할 수 없음
- `404 Not Found`: 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### Draft 버전 삭제

Draft 상태의 버전을 삭제합니다. 오직 이 버전만 참조하던 variant도 함께 삭제됩니다.

**요청**

```
DELETE /masters/:masterId/versions/:versionId
```

**경로 파라미터**

- `masterId`: Master ID
- `versionId`: Version ID (삭제할 draft)

**응답**

```json
{
  "success": true,
  "message": "Draft version {versionId} deleted successfully"
}
```

**상태 코드**

- `200 OK`: Draft 버전 삭제 성공
- `400 Bad Request`: Draft가 아닌 버전은 삭제 불가
- `404 Not Found`: 버전을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 카테고리 (Categories)

### 카테고리 생성

새로운 제품 카테고리를 생성합니다.

**요청**

```
POST /categories
Content-Type: application/json
```

**요청 본문**

```json
{
  "name": "카테고리명",
  "parentId": null,
  "description": "카테고리 설명",
  "visible": true
}
```

**응답**

```json
{
  "id": "category-id",
  "name": "카테고리명",
  "parentId": null,
  "description": "카테고리 설명",
  "visible": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 카테고리 생성 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `409 Conflict`: 이미 존재하는 카테고리명
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 수정

기존 카테고리 정보를 수정합니다.

**요청**

```
PUT /categories/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 카테고리 ID

**요청 본문**

```json
{
  "name": "수정된 카테고리명",
  "description": "수정된 설명"
}
```

**응답**

```json
{
  "id": "category-id",
  "name": "수정된 카테고리명",
  "description": "수정된 설명"
}
```

**상태 코드**

- `200 OK`: 카테고리 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 삭제

카테고리를 삭제합니다. 해당 카테고리의 제품들을 다른 카테고리로 이동할 수 있습니다.

**요청**

```
DELETE /categories/:id?moveProductsTo=target-category-id
```

**경로 파라미터**

- `id`: 삭제할 카테고리 ID

**쿼리 파라미터**

- `moveProductsTo` (optional): 제품들을 이동시킬 대상 카테고리 ID

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 카테고리 삭제 성공
- `400 Bad Request`: 하위 카테고리가 존재하여 삭제할 수 없음
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 상세 조회

특정 카테고리의 상세 정보를 조회합니다.

**요청**

```
GET /categories/:id
```

**경로 파라미터**

- `id`: 조회할 카테고리 ID

**응답**

```json
{
  "id": "category-id",
  "name": "카테고리명",
  "parentId": null,
  "description": "카테고리 설명",
  "visible": true,
  "productCount": 10,
  "children": []
}
```

**상태 코드**

- `200 OK`: 카테고리 조회 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 트리 조회

전체 카테고리를 계층구조로 조회합니다.

**요청**

```
GET /categories?maxDepth=3
```

**쿼리 파라미터**

- `maxDepth` (optional): 조회할 최대 깊이 (미지정시 전체)

**응답**

```json
[
  {
    "id": "category-id",
    "name": "카테고리명",
    "parentId": null,
    "children": [
      {
        "id": "child-category-id",
        "name": "하위 카테고리",
        "parentId": "category-id",
        "children": []
      }
    ]
  }
]
```

**상태 코드**

- `200 OK`: 카테고리 트리 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 하위 카테고리 조회

특정 카테고리의 직계 하위 카테고리 목록을 조회합니다.

**요청**

```
GET /categories/:id/children
```

**경로 파라미터**

- `id`: 부모 카테고리 ID

**응답**

```json
[
  {
    "id": "child-category-id",
    "name": "하위 카테고리",
    "parentId": "parent-category-id"
  }
]
```

**상태 코드**

- `200 OK`: 하위 카테고리 조회 성공
- `404 Not Found`: 부모 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 경로 조회

특정 카테고리의 루트부터의 전체 경로를 조회합니다.

**요청**

```
GET /categories/:id/path
```

**경로 파라미터**

- `id`: 카테고리 ID

**응답**

```json
{
  "path": [
    {
      "id": "root-category-id",
      "name": "루트 카테고리"
    },
    {
      "id": "parent-category-id",
      "name": "부모 카테고리"
    },
    {
      "id": "category-id",
      "name": "현재 카테고리"
    }
  ]
}
```

**상태 코드**

- `200 OK`: 카테고리 경로 조회 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 이동

카테고리를 다른 부모 카테고리 하위로 이동시킵니다.

**요청**

```
PUT /categories/:id/move?newParentId=new-parent-id
```

**경로 파라미터**

- `id`: 이동할 카테고리 ID

**쿼리 파라미터**

- `newParentId` (optional): 새로운 부모 카테고리 ID (미지정시 루트로 이동)

**응답**

```json
{
  "id": "category-id",
  "name": "카테고리명",
  "parentId": "new-parent-id"
}
```

**상태 코드**

- `200 OK`: 카테고리 이동 성공
- `400 Bad Request`: 순환 참조 또는 자기 자신으로 이동 시도
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 상품들을 카테고리로 이동

여러 상품을 특정 카테고리로 일괄 이동시킵니다. 기존 카테고리 관계는 삭제되고 새로운 카테고리로 대체됩니다.

**요청**

```
PUT /categories/:id/products
Content-Type: application/json
```

**경로 파라미터**

- `id`: 대상 카테고리 ID

**요청 본문**

```json
{
  "productIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  ]
}
```

**응답**

```json
{
  "message": "Products moved successfully",
  "movedCount": 2
}
```

**상태 코드**

- `200 OK`: 상품 이동 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 카테고리 또는 상품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 상품들을 카테고리에 추가

여러 상품을 특정 카테고리에 추가로 연결합니다. 기존 카테고리 관계는 유지됩니다 (다대다 관계 지원).

**요청**

```
POST /categories/:id/products/add
Content-Type: application/json
```

**경로 파라미터**

- `id`: 대상 카테고리 ID

**요청 본문**

```json
{
  "productIds": [
    "550e8400-e29b-41d4-a716-446655440000",
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
  ]
}
```

**응답**

```json
{
  "message": "Products added successfully",
  "addedCount": 2
}
```

**상태 코드**

- `200 OK`: 상품 추가 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 카테고리 또는 상품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 표시 설정 업데이트

카테고리의 표시 관련 설정을 업데이트합니다.

**요청**

```
PATCH /categories/:id/display-settings
Content-Type: application/json
```

**경로 파라미터**

- `id`: 카테고리 ID

**요청 본문**

```json
{
  "displayOrder": 1,
  "showInMenu": true
}
```

**응답**

```json
{
  "id": "category-id",
  "displayOrder": 1,
  "showInMenu": true
}
```

**상태 코드**

- `200 OK`: 표시 설정 업데이트 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 SEO 설정 업데이트

카테고리의 SEO 관련 설정을 업데이트합니다.

**요청**

```
PATCH /categories/:id/seo
Content-Type: application/json
```

**경로 파라미터**

- `id`: 카테고리 ID

**요청 본문**

```json
{
  "metaTitle": "SEO 제목",
  "metaDescription": "SEO 설명",
  "slug": "category-slug"
}
```

**응답**

```json
{
  "id": "category-id",
  "seo": {
    "metaTitle": "SEO 제목",
    "metaDescription": "SEO 설명",
    "slug": "category-slug"
  }
}
```

**상태 코드**

- `200 OK`: SEO 설정 업데이트 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 템플릿 설정 업데이트

카테고리의 템플릿 관련 설정을 업데이트합니다.

**요청**

```
PATCH /categories/:id/template
Content-Type: application/json
```

**경로 파라미터**

- `id`: 카테고리 ID

**요청 본문**

```json
{
  "templateId": "template-id",
  "templateConfig": {}
}
```

**응답**

```json
{
  "id": "category-id",
  "template": {
    "templateId": "template-id",
    "templateConfig": {}
  }
}
```

**상태 코드**

- `200 OK`: 템플릿 설정 업데이트 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 표시 여부 업데이트

카테고리의 표시 여부를 업데이트합니다.

**요청**

```
PATCH /categories/:id/visibility
Content-Type: application/json
```

**경로 파라미터**

- `id`: 카테고리 ID

**요청 본문**

```json
{
  "visible": true
}
```

**응답**

```json
{
  "id": "category-id",
  "visible": true
}
```

**상태 코드**

- `200 OK`: 표시 여부 업데이트 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 태그 그룹 연결 설정

카테고리에 연결된 태그 그룹을 설정합니다. 기존 연결은 모두 삭제되고 새로운 연결로 교체됩니다.

**요청**

```
PUT /categories/:categoryId/tag-groups
Content-Type: application/json
```

**경로 파라미터**

- `categoryId`: 카테고리 ID (UUID)

**요청 본문**

```json
{
  "links": [
    {
      "tagGroupId": "tag-group-id-1",
      "isRequired": true,
      "displayOrder": 1
    },
    {
      "tagGroupId": "tag-group-id-2",
      "isRequired": false,
      "displayOrder": 2
    }
  ]
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `204 No Content`: 태그 그룹 연결 설정 성공
- `400 Bad Request`: 존재하지 않는 태그 그룹 ID
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 카테고리 태그 그룹 조회

카테고리에 연결된 태그 그룹 및 태그 값을 조회합니다.

**요청**

```
GET /categories/:categoryId/tag-groups
```

**경로 파라미터**

- `categoryId`: 카테고리 ID (UUID)

**응답**

```json
{
  "categoryId": "category-id",
  "tagGroups": [
    {
      "tagGroupId": "tag-group-id",
      "tagGroupName": "태그 그룹명",
      "isRequired": true,
      "displayOrder": 1,
      "tags": [
        {
          "tagId": "tag-id",
          "tagValue": "태그 값"
        }
      ]
    }
  ]
}
```

**상태 코드**

- `200 OK`: 태그 그룹 조회 성공
- `404 Not Found`: 카테고리를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 태그 (Tags)

### 태그 그룹 생성

새로운 태그 그룹을 생성합니다.

**요청**

```
POST /tags/groups
Content-Type: application/json
```

**요청 본문**

```json
{
  "name": "색상",
  "description": "제품 색상 태그",
  "isActive": true
}
```

**응답**

```json
{
  "id": "tag-group-id",
  "name": "색상",
  "description": "제품 색상 태그",
  "isActive": true,
  "tagCount": 0,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 태그 그룹 생성 성공
- `400 Bad Request`: 잘못된 요청
- `500 Internal Server Error`: 서버 오류

---

### 태그 그룹 목록 조회

모든 태그 그룹을 조회합니다. 필터링 옵션을 지원합니다.

**요청**

```
GET /tags/groups?isActive=true
```

**쿼리 파라미터**

- `isActive` (optional): 활성 상태 필터

**응답**

```json
[
  {
    "id": "tag-group-id",
    "name": "색상",
    "description": "제품 색상 태그",
    "isActive": true,
    "tagCount": 5
  }
]
```

**상태 코드**

- `200 OK`: 태그 그룹 목록 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 태그 그룹 단일 조회

특정 태그 그룹의 정보를 조회합니다. 태그 값 개수를 포함합니다.

**요청**

```
GET /tags/groups/:id
```

**경로 파라미터**

- `id`: 태그 그룹 ID (UUID)

**응답**

```json
{
  "id": "tag-group-id",
  "name": "색상",
  "description": "제품 색상 태그",
  "isActive": true,
  "tagCount": 5
}
```

**상태 코드**

- `200 OK`: 태그 그룹 조회 성공
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 그룹 상세 조회 (값 포함)

특정 태그 그룹의 정보와 모든 태그 값을 함께 조회합니다.

**요청**

```
GET /tags/groups/:id/detail
```

**경로 파라미터**

- `id`: 태그 그룹 ID (UUID)

**응답**

```json
{
  "id": "tag-group-id",
  "name": "색상",
  "description": "제품 색상 태그",
  "isActive": true,
  "tags": [
    {
      "id": "tag-id-1",
      "value": "빨강",
      "displayOrder": 1
    },
    {
      "id": "tag-id-2",
      "value": "파랑",
      "displayOrder": 2
    }
  ]
}
```

**상태 코드**

- `200 OK`: 태그 그룹 상세 조회 성공
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 그룹 수정

특정 태그 그룹의 정보를 수정합니다.

**요청**

```
PUT /tags/groups/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 태그 그룹 ID (UUID)

**요청 본문**

```json
{
  "name": "수정된 색상",
  "description": "수정된 설명",
  "isActive": true
}
```

**응답**

```json
{
  "id": "tag-group-id",
  "name": "수정된 색상",
  "description": "수정된 설명",
  "isActive": true
}
```

**상태 코드**

- `200 OK`: 태그 그룹 수정 성공
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 그룹 삭제

특정 태그 그룹을 삭제합니다. 태그 값이 있는 경우 삭제할 수 없습니다.

**요청**

```
DELETE /tags/groups/:id
```

**경로 파라미터**

- `id`: 태그 그룹 ID (UUID)

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `204 No Content`: 태그 그룹 삭제 성공
- `400 Bad Request`: 태그 값이 있어 삭제할 수 없음
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 값 생성

특정 태그 그룹에 새로운 태그 값을 생성합니다.

**요청**

```
POST /tags/groups/:groupId/values
Content-Type: application/json
```

**경로 파라미터**

- `groupId`: 태그 그룹 ID (UUID)

**요청 본문**

```json
{
  "value": "빨강",
  "displayOrder": 1
}
```

**응답**

```json
{
  "id": "tag-value-id",
  "groupId": "tag-group-id",
  "groupName": "색상",
  "value": "빨강",
  "displayOrder": 1,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 태그 값 생성 성공
- `400 Bad Request`: 잘못된 요청 또는 중복된 태그 값
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 값 목록 조회

특정 태그 그룹의 모든 태그 값을 조회합니다.

**요청**

```
GET /tags/groups/:groupId/values
```

**경로 파라미터**

- `groupId`: 태그 그룹 ID (UUID)

**응답**

```json
[
  {
    "id": "tag-value-id",
    "groupId": "tag-group-id",
    "groupName": "색상",
    "value": "빨강",
    "displayOrder": 1
  }
]
```

**상태 코드**

- `200 OK`: 태그 값 목록 조회 성공
- `404 Not Found`: 태그 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 값 단일 조회

특정 태그 값의 정보를 조회합니다. 태그 그룹 이름을 포함합니다.

**요청**

```
GET /tags/values/:id
```

**경로 파라미터**

- `id`: 태그 값 ID (UUID)

**응답**

```json
{
  "id": "tag-value-id",
  "groupId": "tag-group-id",
  "groupName": "색상",
  "value": "빨강",
  "displayOrder": 1
}
```

**상태 코드**

- `200 OK`: 태그 값 조회 성공
- `404 Not Found`: 태그 값을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 값 수정

특정 태그 값의 정보를 수정합니다.

**요청**

```
PUT /tags/values/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 태그 값 ID (UUID)

**요청 본문**

```json
{
  "value": "수정된 빨강",
  "displayOrder": 2
}
```

**응답**

```json
{
  "id": "tag-value-id",
  "value": "수정된 빨강",
  "displayOrder": 2
}
```

**상태 코드**

- `200 OK`: 태그 값 수정 성공
- `400 Bad Request`: 중복된 태그 값
- `404 Not Found`: 태그 값을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 태그 값 삭제

특정 태그 값을 삭제합니다.

**요청**

```
DELETE /tags/values/:id
```

**경로 파라미터**

- `id`: 태그 값 ID (UUID)

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `204 No Content`: 태그 값 삭제 성공
- `404 Not Found`: 태그 값을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 가격 정책 (Pricing)

### 가격 규칙 조회

제품 마스터의 가격 규칙을 조회합니다.

**요청**

```
GET /products/:masterId/pricing/rules
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**응답**

```json
{
  "masterId": "master-id",
  "rules": [
    {
      "id": "rule-id",
      "layer": "base",
      "order": 1,
      "scopeType": "variant",
      "operationType": "set",
      "operationValue": 10000
    }
  ]
}
```

**상태 코드**

- `200 OK`: 가격 규칙 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 가격 규칙 교체

제품 마스터의 모든 가격 규칙을 교체합니다.

**요청**

```
PUT /products/:masterId/pricing/rules
Content-Type: application/json
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**요청 본문**

```json
{
  "rules": [
    {
      "layer": "base",
      "order": 1,
      "scopeType": "variant",
      "scopeId": "variant-id",
      "operationType": "set",
      "operationValue": 10000
    },
    {
      "layer": "membership",
      "order": 1,
      "scopeType": "master",
      "operationType": "discount",
      "operationValue": 10
    }
  ]
}
```

**응답**

```json
{
  "masterId": "master-id",
  "rules": [
    {
      "id": "rule-id",
      "layer": "base",
      "order": 1,
      "scopeType": "variant",
      "operationType": "set",
      "operationValue": 10000
    }
  ]
}
```

**상태 코드**

- `200 OK`: 가격 규칙 교체 성공
- `500 Internal Server Error`: 서버 오류

---

### 가격 규칙 삭제

제품 마스터의 모든 가격 규칙을 삭제합니다.

**요청**

```
DELETE /products/:masterId/pricing/rules
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `204 No Content`: 가격 규칙 삭제 성공
- `500 Internal Server Error`: 서버 오류

---

### 가격 계산

특정 변형의 가격을 계산합니다.

**요청**

```
POST /products/:masterId/pricing/calculate
Content-Type: application/json
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**요청 본문**

```json
{
  "variantId": "variant-id",
  "quantity": 1,
  "customerType": "regular"
}
```

**응답**

```json
{
  "variantId": "variant-id",
  "price": 10000,
  "totalPrice": 10000,
  "appliedRules": [
    {
      "ruleId": "rule-id",
      "layer": "base",
      "order": 1,
      "scopeType": "variant",
      "operationType": "set",
      "operationValue": 10000,
      "priceBeforeRule": 0,
      "priceAfterRule": 10000
    }
  ],
  "priceBreakdown": {
    "initialPrice": 0,
    "afterBasePrice": 10000,
    "afterMembershipPrice": 9000,
    "afterTieredPrice": 9000
  }
}
```

**상태 코드**

- `200 OK`: 가격 계산 성공
- `500 Internal Server Error`: 서버 오류

---

### 가격 세트 조회

변형의 완전한 가격 세트(기본, 멤버십, 티어드)를 조회합니다.

**요청**

```
GET /products/:masterId/pricing/price-set?variantId=variant-id&versionId=version-id
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**쿼리 파라미터**

- `variantId`: 변형 ID
- `versionId` (optional): 버전 ID

**응답**

```json
{
  "variantId": "variant-id",
  "basePrice": 10000,
  "membershipPrice": 9000,
  "tieredPrices": [
    {
      "quantity": 1,
      "price": 10000
    },
    {
      "quantity": 10,
      "price": 9000
    }
  ]
}
```

**상태 코드**

- `200 OK`: 가격 세트 조회 성공
- `500 Internal Server Error`: 서버 오류

---

## 판매 채널 (Sales Channels)

### 판매 채널 생성

새로운 판매 채널(온라인 쇼핑몰, 오프라인 매장 등)을 생성합니다.

**요청**

```
POST /channels
Content-Type: application/json
```

**요청 본문**

```json
{
  "type": "online",
  "name": "온라인 쇼핑몰",
  "description": "메인 온라인 쇼핑몰",
  "config": {
    "url": "https://shop.example.com"
  },
  "isActive": true
}
```

**응답**

```json
{
  "id": "channel-id",
  "type": "online",
  "name": "온라인 쇼핑몰",
  "description": "메인 온라인 쇼핑몰",
  "config": {
    "url": "https://shop.example.com"
  },
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 판매 채널 생성 성공
- `400 Bad Request`: 잘못된 요청 데이터 (type, name 필수)
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 목록 조회

판매 채널 목록을 필터링 및 페이지네이션과 함께 조회합니다.

**요청**

```
GET /channels?isActive=true&type=online&search=xxx&page=1&limit=20
```

**쿼리 파라미터**

- `isActive` (optional): 활성 상태 필터 (true/false)
- `type` (optional): 채널 타입 필터
- `search` (optional): 검색 키워드
- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수

**응답**

```json
{
  "items": [
    {
      "id": "channel-id",
      "type": "online",
      "name": "온라인 쇼핑몰",
      "isActive": true
    }
  ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

**상태 코드**

- `200 OK`: 판매 채널 목록 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 활성 판매 채널 조회

활성 상태인 판매 채널만 조회합니다.

**요청**

```
GET /channels/active
```

**응답**

```json
[
  {
    "id": "channel-id",
    "type": "online",
    "name": "온라인 쇼핑몰",
    "isActive": true
  }
]
```

**상태 코드**

- `200 OK`: 활성 판매 채널 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 상세 조회

특정 판매 채널의 상세 정보를 조회합니다.

**요청**

```
GET /channels/:id
```

**경로 파라미터**

- `id`: 판매 채널 ID

**응답**

```json
{
  "id": "channel-id",
  "type": "online",
  "name": "온라인 쇼핑몰",
  "description": "메인 온라인 쇼핑몰",
  "config": {
    "url": "https://shop.example.com"
  },
  "isActive": true
}
```

**상태 코드**

- `200 OK`: 판매 채널 상세 조회 성공
- `404 Not Found`: 판매 채널을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 수정

기존 판매 채널 정보를 수정합니다.

**요청**

```
PUT /channels/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 판매 채널 ID

**요청 본문**

```json
{
  "name": "수정된 채널명",
  "description": "수정된 설명",
  "config": {
    "url": "https://new-shop.example.com"
  }
}
```

**응답**

```json
{
  "id": "channel-id",
  "name": "수정된 채널명",
  "description": "수정된 설명"
}
```

**상태 코드**

- `200 OK`: 판매 채널 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 판매 채널을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 삭제

판매 채널을 삭제합니다.

**요청**

```
DELETE /channels/:id
```

**경로 파라미터**

- `id`: 삭제할 판매 채널 ID

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 판매 채널 삭제 성공
- `400 Bad Request`: 삭제 요구사항 불충족
- `404 Not Found`: 판매 채널을 찾을 수 없음
- `409 Conflict`: 사용 중인 채널로 삭제할 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 상태 설정

판매 채널의 활성/비활성 상태를 설정합니다.

**요청**

```
PUT /channels/:id/status
Content-Type: application/json
```

**경로 파라미터**

- `id`: 판매 채널 ID

**요청 본문**

```json
{
  "isActive": false
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 판매 채널 상태 설정 성공
- `400 Bad Request`: 잘못된 요청 데이터 (isActive 필수)
- `404 Not Found`: 판매 채널을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 타입별 판매 채널 조회

특정 타입의 판매 채널을 조회합니다.

**요청**

```
GET /channels/type/:type
```

**경로 파라미터**

- `type`: 판매 채널 타입

**응답**

```json
{
  "id": "channel-id",
  "type": "online",
  "name": "온라인 쇼핑몰",
  "isActive": true
}
```

**상태 코드**

- `200 OK`: 타입별 판매 채널 조회 성공
- `404 Not Found`: 해당 타입의 판매 채널을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 판매 채널 설정 검증

판매 채널의 설정 정보가 유효한지 검증합니다.

**요청**

```
POST /channels/validate
Content-Type: application/json
```

**요청 본문**

```json
{
  "type": "online",
  "config": {
    "url": "https://shop.example.com"
  }
}
```

**응답**

```json
{
  "valid": true,
  "errors": []
}
```

**상태 코드**

- `200 OK`: 채널 설정 검증 완료
- `400 Bad Request`: 잘못된 요청 데이터 (type 필수)
- `500 Internal Server Error`: 서버 오류

---

## 채널별 제품 (Channel Products)

### 채널별 제품 생성

특정 판매 채널에서 사용할 제품 정보를 생성합니다.

**요청**

```
POST /channel-products
Content-Type: application/json
```

**요청 본문**

```json
{
  "masterId": "master-id",
  "channelId": "channel-id",
  "isActive": true
}
```

**응답**

```json
{
  "id": "channel-product-id",
  "masterId": "master-id",
  "channelId": "channel-id",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 채널별 제품 생성 성공
- `400 Bad Request`: 잘못된 요청 데이터 (masterId, channelId 필수)
- `404 Not Found`: 제품 마스터 또는 판매 채널을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 마스터별 채널 제품 조회

특정 제품 마스터의 모든 채널별 제품들을 조회합니다.

**요청**

```
GET /channel-products/masters/:masterId
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID

**응답**

```json
[
  {
    "id": "channel-product-id",
    "masterId": "master-id",
    "channelId": "channel-id",
    "channel": {
      "id": "channel-id",
      "name": "온라인 쇼핑몰",
      "type": "online"
    },
    "isActive": true
  }
]
```

**상태 코드**

- `200 OK`: 마스터별 채널 제품 조회 성공
- `400 Bad Request`: 잘못된 요청
- `500 Internal Server Error`: 서버 오류

---

### 채널별 제품 조회

특정 판매 채널의 모든 제품들을 조회합니다.

**요청**

```
GET /channel-products/channels/:channelId?isActive=true&search=xxx&page=1&limit=20
```

**경로 파라미터**

- `channelId`: 판매 채널 ID

**쿼리 파라미터**

- `isActive` (optional): 활성 상태 필터 (true/false)
- `search` (optional): 검색 키워드
- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수

**응답**

```json
{
  "items": [
    {
      "id": "channel-product-id",
      "masterId": "master-id",
      "channelId": "channel-id",
      "isActive": true
    }
  ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

**상태 코드**

- `200 OK`: 채널별 제품 조회 성공
- `400 Bad Request`: 잘못된 요청
- `500 Internal Server Error`: 서버 오류

---

### 채널 제품 상세 조회

특정 채널 제품의 상세 정보를 조회합니다.

**요청**

```
GET /channel-products/:id
```

**경로 파라미터**

- `id`: 채널 제품 ID

**응답**

```json
{
  "id": "channel-product-id",
  "masterId": "master-id",
  "channelId": "channel-id",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `200 OK`: 채널 제품 상세 조회 성공
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 채널 제품 수정

기존 채널 제품 정보를 수정합니다.

**요청**

```
PUT /channel-products/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 채널 제품 ID

**요청 본문**

```json
{
  "isActive": false
}
```

**응답**

```json
{
  "id": "channel-product-id",
  "isActive": false
}
```

**상태 코드**

- `200 OK`: 채널 제품 수정 성공
- `400 Bad Request`: 잘못된 요청 데이터
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 채널 제품 삭제

채널 제품을 삭제합니다.

**요청**

```
DELETE /channel-products/:id
```

**경로 파라미터**

- `id`: 삭제할 채널 제품 ID

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 채널 제품 삭제 성공
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 병합된 채널 제품 조회

제품 마스터와 채널별 설정이 병합된 제품 정보를 조회합니다.

**요청**

```
GET /channel-products/masters/:masterId/channels/:channelId/merged
```

**경로 파라미터**

- `masterId`: 제품 마스터 ID
- `channelId`: 판매 채널 ID

**응답**

```json
{
  "masterId": "master-id",
  "channelId": "channel-id",
  "name": "제품명",
  "description": "제품 설명",
  "price": 10000,
  "isActive": true
}
```

**상태 코드**

- `200 OK`: 병합된 채널 제품 조회 성공
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품명 덮어쓰기

채널별 제품의 이름을 덮어쓰기합니다.

**요청**

```
PUT /channel-products/:id/name
Content-Type: application/json
```

**경로 파라미터**

- `id`: 채널 제품 ID

**요청 본문**

```json
{
  "name": "채널별 제품명"
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 제품명 덮어쓰기 성공
- `400 Bad Request`: 잘못된 요청 데이터 (name 필수)
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 채널 제품 상태 설정

채널 제품의 활성/비활성 상태를 설정합니다.

**요청**

```
PUT /channel-products/:id/status
Content-Type: application/json
```

**경로 파라미터**

- `id`: 채널 제품 ID

**요청 본문**

```json
{
  "isActive": false
}
```

**응답**

```json
{
  "success": true
}
```

**상태 코드**

- `200 OK`: 채널 제품 상태 설정 성공
- `400 Bad Request`: 잘못된 요청 데이터 (isActive 필수)
- `404 Not Found`: 채널 제품을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 배너 (Banners)

### 배너 생성

배너 그룹에 새로운 배너를 추가합니다.

**요청**

```
POST /banners
Content-Type: application/json
```

**요청 본문**

```json
{
  "bannerGroupId": "banner-group-id",
  "title": "배너 제목",
  "imageUrl": "https://example.com/banner.jpg",
  "linkUrl": "https://example.com",
  "displayOrder": 1,
  "isActive": true
}
```

**응답**

```json
{
  "id": "banner-id",
  "bannerGroupId": "banner-group-id",
  "title": "배너 제목",
  "imageUrl": "https://example.com/banner.jpg",
  "linkUrl": "https://example.com",
  "displayOrder": 1,
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 배너 생성 성공
- `400 Bad Request`: 잘못된 요청
- `404 Not Found`: 배너 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹의 배너 목록 조회

특정 배너 그룹에 속한 배너 목록을 조회합니다.

**요청**

```
GET /banners/by-group/:bannerGroupId?includeInactive=false
```

**경로 파라미터**

- `bannerGroupId`: 배너 그룹 ID

**쿼리 파라미터**

- `includeInactive` (optional): 비활성화된 배너도 포함할지 여부 (기본: false)

**응답**

```json
[
  {
    "id": "banner-id",
    "bannerGroupId": "banner-group-id",
    "title": "배너 제목",
    "imageUrl": "https://example.com/banner.jpg",
    "linkUrl": "https://example.com",
    "displayOrder": 1,
    "isActive": true
  }
]
```

**상태 코드**

- `200 OK`: 배너 목록 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 배너 상세 조회

ID로 배너 상세 정보를 조회합니다.

**요청**

```
GET /banners/:id
```

**경로 파라미터**

- `id`: 배너 ID

**응답**

```json
{
  "id": "banner-id",
  "bannerGroupId": "banner-group-id",
  "title": "배너 제목",
  "imageUrl": "https://example.com/banner.jpg",
  "linkUrl": "https://example.com",
  "displayOrder": 1,
  "isActive": true
}
```

**상태 코드**

- `200 OK`: 배너 조회 성공
- `404 Not Found`: 배너를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 수정

배너 정보를 수정합니다.

**요청**

```
PUT /banners/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 배너 ID

**요청 본문**

```json
{
  "title": "수정된 배너 제목",
  "imageUrl": "https://example.com/new-banner.jpg",
  "linkUrl": "https://example.com/new",
  "displayOrder": 2,
  "isActive": false
}
```

**응답**

```json
{
  "id": "banner-id",
  "title": "수정된 배너 제목",
  "imageUrl": "https://example.com/new-banner.jpg",
  "linkUrl": "https://example.com/new",
  "displayOrder": 2,
  "isActive": false
}
```

**상태 코드**

- `200 OK`: 배너 수정 성공
- `404 Not Found`: 배너를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 삭제 (Soft Delete)

배너를 soft delete 합니다.

**요청**

```
DELETE /banners/:id?deletedBy=user-id
```

**경로 파라미터**

- `id`: 배너 ID

**쿼리 파라미터**

- `deletedBy` (optional): 삭제자 ID

**응답**

```json
{
  "message": "Banner deleted successfully"
}
```

**상태 코드**

- `200 OK`: 배너 삭제 성공
- `404 Not Found`: 배너를 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 배너 그룹 (Banner Groups)

### 배너 그룹 생성

새로운 배너 그룹을 생성합니다.

**요청**

```
POST /banner-groups
Content-Type: application/json
```

**요청 본문**

```json
{
  "code": "AY2312",
  "name": "메인 배너",
  "category": "home",
  "description": "홈페이지 메인 배너 그룹"
}
```

**응답**

```json
{
  "id": "banner-group-id",
  "code": "AY2312",
  "name": "메인 배너",
  "category": "home",
  "description": "홈페이지 메인 배너 그룹",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

**상태 코드**

- `201 Created`: 배너 그룹 생성 성공
- `400 Bad Request`: 잘못된 요청 또는 중복된 코드
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹 목록 조회

배너 그룹 목록을 조회합니다. 카테고리로 필터링 가능합니다.

**요청**

```
GET /banner-groups?category=home
```

**쿼리 파라미터**

- `category` (optional): 배너 그룹 카테고리

**응답**

```json
[
  {
    "id": "banner-group-id",
    "code": "AY2312",
    "name": "메인 배너",
    "category": "home",
    "description": "홈페이지 메인 배너 그룹"
  }
]
```

**상태 코드**

- `200 OK`: 배너 그룹 목록 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹 조회 (코드)

코드로 배너 그룹과 활성화된 배너 목록을 조회합니다. 프론트엔드에서 사용됩니다.

**요청**

```
GET /banner-groups/by-code/:code
```

**경로 파라미터**

- `code`: 배너 그룹 코드 (예: AY2312)

**응답**

```json
{
  "id": "banner-group-id",
  "code": "AY2312",
  "name": "메인 배너",
  "category": "home",
  "banners": [
    {
      "id": "banner-id",
      "title": "배너 제목",
      "imageUrl": "https://example.com/banner.jpg",
      "linkUrl": "https://example.com",
      "displayOrder": 1
    }
  ]
}
```

**상태 코드**

- `200 OK`: 배너 그룹 조회 성공
- `404 Not Found`: 배너 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹 상세 조회 (ID)

ID로 배너 그룹을 조회합니다.

**요청**

```
GET /banner-groups/:id
```

**경로 파라미터**

- `id`: 배너 그룹 ID

**응답**

```json
{
  "id": "banner-group-id",
  "code": "AY2312",
  "name": "메인 배너",
  "category": "home",
  "description": "홈페이지 메인 배너 그룹"
}
```

**상태 코드**

- `200 OK`: 배너 그룹 조회 성공
- `404 Not Found`: 배너 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹 수정

배너 그룹 정보를 수정합니다.

**요청**

```
PUT /banner-groups/:id
Content-Type: application/json
```

**경로 파라미터**

- `id`: 배너 그룹 ID

**요청 본문**

```json
{
  "name": "수정된 배너 그룹명",
  "description": "수정된 설명"
}
```

**응답**

```json
{
  "id": "banner-group-id",
  "name": "수정된 배너 그룹명",
  "description": "수정된 설명"
}
```

**상태 코드**

- `200 OK`: 배너 그룹 수정 성공
- `404 Not Found`: 배너 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

### 배너 그룹 삭제 (Soft Delete)

배너 그룹과 포함된 모든 배너를 soft delete 합니다.

**요청**

```
DELETE /banner-groups/:id?deletedBy=user-id
```

**경로 파라미터**

- `id`: 배너 그룹 ID

**쿼리 파라미터**

- `deletedBy` (optional): 삭제자 ID

**응답**

```json
{
  "message": "Banner group deleted successfully"
}
```

**상태 코드**

- `200 OK`: 배너 그룹 삭제 성공
- `404 Not Found`: 배너 그룹을 찾을 수 없음
- `500 Internal Server Error`: 서버 오류

---

## 제품 검색 (Product Search)

### 제품 검색

Elasticsearch를 사용하여 제품을 검색합니다. 키워드, 필터, 태그를 지원하며 퍼지 검색과 중첩 태그 필터링을 지원합니다.

**요청**

```
GET /products/search?q=검색어&tags=태그값&page=1&limit=20
```

**쿼리 파라미터**

- `q` (optional): 검색 키워드
- `tags` (optional): 태그 필터 (여러 개 가능)
- `categoryId` (optional): 카테고리 필터
- `brand` (optional): 브랜드 필터
- `minPrice` (optional): 최소 가격
- `maxPrice` (optional): 최대 가격
- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수

**응답**

```json
{
  "items": [
    {
      "id": "master-id",
      "name": "제품명",
      "description": "제품 설명",
      "brand": "브랜드명",
      "price": 10000,
      "images": {
        "primary": {
          "url": "https://example.com/image.jpg"
        }
      }
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

**상태 코드**

- `200 OK`: 검색 성공
- `400 Bad Request`: 잘못된 요청
- `500 Internal Server Error`: 검색 오류

---

## CSV 작업 (Product CSV)

### CSV 템플릿 다운로드

제품 일괄 등록을 위한 CSV 템플릿 파일을 다운로드합니다.

**요청**

```
GET /api/pim/products/csv/template
```

**응답**

- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename=product-import-template.csv`
- CSV 파일 내용

**상태 코드**

- `200 OK`: CSV 템플릿 다운로드 성공

---

### CSV 파일로 제품 일괄 등록

CSV 파일을 업로드하여 여러 제품을 한 번에 등록합니다.

**요청**

```
POST /api/pim/products/bulk-import
Content-Type: multipart/form-data
```

**요청 본문 (Form Data)**

- `file`: CSV 파일 (product-import-template.csv 형식)
- `userId`: 작업을 수행하는 사용자 ID

**응답**

```json
{
  "success": true,
  "imported": 10,
  "failed": 2,
  "errors": ["Row 5: Invalid SKU format", "Row 8: Missing required field: name"]
}
```

**상태 코드**

- `200 OK`: 제품 일괄 등록 성공
- `400 Bad Request`: 파일이 없거나 userId가 없음
- `500 Internal Server Error`: 서버 오류

---

### 제품 목록 CSV 내보내기

제품 목록을 CSV 파일로 내보냅니다. productIds를 지정하면 해당 제품만, 없으면 전체 제품을 내보냅니다.

**요청**

```
GET /api/pim/products/export?productIds=id1,id2,id3
```

**쿼리 파라미터**

- `productIds` (optional): 내보낼 제품 ID 목록 (쉼표로 구분)

**응답**

- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename=products-export-YYYY-MM-DD.csv`
- CSV 파일 내용

**상태 코드**

- `200 OK`: CSV 파일 다운로드 성공
- `500 Internal Server Error`: 서버 오류

---

## 대시보드 (Dashboard)

### 대시보드 메트릭 조회

제품 통계 정보를 조회합니다. 전체 제품 수, 오늘 등록 제품 수, 상태별/승인상태별 제품 수 등을 포함합니다.

**요청**

```
GET /dashboard/metrics
```

**응답**

```json
{
  "totalProducts": 1000,
  "todayProducts": 10,
  "byStatus": {
    "active": 800,
    "inactive": 150,
    "draft": 50
  },
  "byApprovalStatus": {
    "approved": 900,
    "pending": 80,
    "rejected": 20
  }
}
```

**상태 코드**

- `200 OK`: 메트릭 조회 성공
- `500 Internal Server Error`: 서버 오류

---

### 상위 제품 목록 조회

활성화된 제품 중 상위 N개를 조회합니다. 현재는 최근 등록순이며, 향후 주문 서비스 연동 시 판매량 기준으로 변경됩니다.

**요청**

```
GET /dashboard/top-products?limit=5
```

**쿼리 파라미터**

- `limit` (optional): 조회할 제품 수 (기본값: 5, 최대: 100)

**응답**

```json
[
  {
    "id": "master-id",
    "name": "제품명",
    "brand": "브랜드명",
    "price": 10000,
    "status": "active",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
]
```

**상태 코드**

- `200 OK`: 상위 제품 조회 성공
- `400 Bad Request`: 잘못된 요청 (limit 값이 유효하지 않음)
- `500 Internal Server Error`: 서버 오류

---

### 매출 트렌드 조회

지정된 기간 동안의 매출 트렌드 데이터를 조회합니다. 현재는 주문 서비스 연동 대기중으로 빈 구조를 반환합니다.

**요청**

```
GET /dashboard/sales-trends?days=30
```

**쿼리 파라미터**

- `days` (optional): 조회할 기간 (일 단위, 기본값: 30, 최대: 365)

**응답**

```json
{
  "period": {
    "start": "2024-01-01T00:00:00.000Z",
    "end": "2024-01-31T23:59:59.999Z"
  },
  "data": []
}
```

**상태 코드**

- `200 OK`: 매출 트렌드 조회 성공 (현재는 빈 데이터)
- `400 Bad Request`: 잘못된 요청 (days 값이 유효하지 않음)
- `500 Internal Server Error`: 서버 오류

---

## 에러 응답

모든 API는 표준 HTTP 상태 코드를 사용합니다:

- `200 OK`: 요청 성공
- `201 Created`: 리소스 생성 성공
- `204 No Content`: 요청 성공 (응답 본문 없음)
- `400 Bad Request`: 잘못된 요청 데이터
- `403 Forbidden`: 권한 없음
- `404 Not Found`: 리소스를 찾을 수 없음
- `409 Conflict`: 리소스 충돌 (예: 중복된 이름)
- `500 Internal Server Error`: 서버 오류

에러 응답 형식:

```json
{
  "statusCode": 400,
  "message": "에러 메시지",
  "error": "Bad Request"
}
```

---

## 인증

현재 API는 인증이 구현되어 있지 않습니다. 향후 JWT 기반 인증이 추가될 예정입니다.

---

## 버전 관리

API 버전은 URL에 포함되지 않습니다. 현재 버전은 `1.0.0`입니다.

---

## 추가 정보

- Swagger 문서: `/docs`
- Health Check: `/health`

---

**문서 버전**: 1.0.0  
**최종 업데이트**: 2024-01-01
