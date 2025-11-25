# PIM API 설계 가이드

**작성일:** 2025-11-24  
**대상:** PIM Backend 개발팀  
**목적:** Master-Version 구조를 반영한 일관된 API 설계 원칙 및 엔드포인트 구조 정의

---

## 📋 목차

1. [개요](#개요)
2. [설계 원칙](#설계-원칙)
3. [API 구조](#api-구조)
4. [엔드포인트 명세](#엔드포인트-명세)
5. [요청/응답 형식](#요청응답-형식)
6. [에러 처리](#에러-처리)
7. [버전 관리 API](#버전-관리-api)
8. [마이그레이션 가이드](#마이그레이션-가이드)

---

## 개요

### 목표
- ✅ 일반 사용자와 관리자 API를 명확히 분리
- ✅ Master ID와 Version ID를 혼동하지 않는 명확한 라우팅
- ✅ RESTful 원칙 준수
- ✅ 자기 설명적(self-descriptive) API

### 대상 사용자

**일반 사용자 (고객, 앱 사용자)**
- Active 버전만 필요
- 버전 개념 인식 불필요
- 간단하고 직관적인 API

**관리자 (상품 관리자, CMS 사용자)**
- 모든 버전 접근 필요
- 버전 생성, 수정, 발행 권한
- 상세한 버전 관리 기능

---

## 설계 원칙

### 1. 관심사 분리 (Separation of Concerns)

```
┌─────────────────────────────────────┐
│  Public API (일반 사용자)            │
│  - Active 버전만 반환               │
│  - 버전 개념 숨김                   │
│  - /masters 경로                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Admin API (관리자)                 │
│  - 모든 버전 접근                   │
│  - 버전 관리 기능                   │
│  - /masters/:id/versions 경로       │
└─────────────────────────────────────┘
```

### 2. 명확한 리소스 계층 구조

```
/masters                              # Master 컬렉션
  /:masterId                          # 특정 Master (Active 버전)
    /versions                         # 해당 Master의 Version 컬렉션
      /active                         # Active 버전
      /:version                       # 특정 버전 (번호)
        /publish                      # 버전 발행
        /compare/:compareVersion      # 버전 비교
```

### 3. RESTful 동사 사용

| HTTP Method | 용도 | 멱등성 | 예시 |
|-------------|------|--------|------|
| GET | 리소스 조회 | ✅ Yes | `GET /masters/:id` |
| POST | 리소스 생성 | ❌ No | `POST /masters` |
| PUT | 리소스 전체 교체 | ✅ Yes | `PUT /masters/:id/versions/:version` |
| PATCH | 리소스 일부 수정 | ❌ No | `PATCH /masters/:id/versions/:version/publish` |
| DELETE | 리소스 삭제 | ✅ Yes | `DELETE /masters/:id` |

### 4. 일관된 네이밍

```typescript
// ✅ 경로 파라미터
:masterId        // Master의 UUID
:versionId       // Version의 UUID (드물게 사용)
:version         // Version 번호 (integer)
:variantId       // Variant의 UUID

// ❌ 피해야 할 네이밍
:id              // 무엇의 ID인지 불명확
:productId       // Master인지 Version인지 모호
```

---

## API 구조

### 전체 엔드포인트 맵

```
[Public API - 일반 사용자]
GET    /api/v1/masters                    # 상품 목록 (active only)
GET    /api/v1/masters/:masterId          # 상품 상세 (active only)

[Admin API - Master 관리]
POST   /api/v1/masters                    # 새 상품 생성
DELETE /api/v1/masters/:masterId          # 상품 삭제 (soft delete)
POST   /api/v1/masters/:masterId/restore  # 상품 복원

[Admin API - Version 관리]
GET    /api/v1/masters/:masterId/versions                      # 버전 목록
GET    /api/v1/masters/:masterId/versions/active               # Active 버전
GET    /api/v1/masters/:masterId/versions/:version             # 특정 버전
POST   /api/v1/masters/:masterId/versions                      # 새 Draft 생성
PUT    /api/v1/masters/:masterId/versions/:version             # Draft 수정
PATCH  /api/v1/masters/:masterId/versions/:version/publish     # 버전 발행
DELETE /api/v1/masters/:masterId/versions/:version             # Draft 삭제
GET    /api/v1/masters/:masterId/versions/:version/compare/:compareVersion  # 버전 비교

[Admin API - Variant 관리]
GET    /api/v1/masters/:masterId/variants                # Variant 목록 (active version)
GET    /api/v1/masters/:masterId/variants/:variantId    # Variant 상세
PUT    /api/v1/masters/:masterId/variants/:variantId    # Variant 수정
PUT    /api/v1/masters/:masterId/variants/bulk          # Variant 일괄 수정

[Admin API - Pricing]
GET    /api/v1/products/:masterId/pricing/rules         # 가격 규칙 조회
PUT    /api/v1/products/:masterId/pricing/rules         # 가격 규칙 설정
POST   /api/v1/products/:masterId/pricing/calculate     # 가격 계산
GET    /api/v1/products/:masterId/pricing/price-set     # 가격 세트 조회
```

---

## 엔드포인트 명세

### Public API - 상품 목록 조회

```http
GET /api/v1/masters?page=1&limit=20&search=키워드&categoryId=uuid
```

**설명:** Active 버전만 반환, 일반 사용자용

**Query Parameters:**
- `page` (optional): 페이지 번호 (default: 1)
- `limit` (optional): 페이지 당 아이템 수 (default: 20, max: 100)
- `search` (optional): 검색 키워드 (상품명 기준)
- `categoryId` (optional): 카테고리 필터
- `brand` (optional): 브랜드 필터
- `status` (optional): 상태 필터 (active, inactive)

**Response:**
```json
{
  "data": [
    {
      "id": "master-uuid",
      "name": "상품명",
      "thumbnail": "https://...",
      "brand": "브랜드",
      "status": "active",
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

**특징:**
- ✅ `id`는 Master ID (버전 개념 숨김)
- ✅ Active 버전의 데이터만 반환
- ✅ 삭제된 상품 제외

---

### Public API - 상품 상세 조회

```http
GET /api/v1/masters/:masterId
```

**설명:** Active 버전의 상세 정보 반환

**Path Parameters:**
- `masterId` (required): Master의 UUID

**Response:**
```json
{
  "id": "master-uuid",
  "name": "상품명",
  "description": "상품 설명",
  "brand": "브랜드",
  "thumbnail": "https://...",
  "images": [
    {
      "id": "image-uuid",
      "url": "https://...",
      "isPrimary": true,
      "sortOrder": 0
    }
  ],
  "attributes": {
    "color": "블루",
    "size": "L"
  },
  "tags": ["신상품", "베스트"],
  "variants": [
    {
      "id": "variant-uuid",
      "name": "블루/L",
      "isDefault": false,
      "status": "active"
    }
  ],
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

**특징:**
- ✅ Master ID 사용
- ✅ 버전 정보 숨김 (일반 사용자는 버전 개념 불필요)
- ✅ Active 버전의 데이터

**Error Responses:**
```json
// 404 Not Found
{
  "statusCode": 404,
  "message": "Product not found",
  "error": "Not Found"
}
```

---

### Admin API - 상품 생성

```http
POST /api/v1/masters
```

**설명:** 새 상품 생성 (Master + 첫 Draft 버전)

**Request Body:**
```json
{
  "name": "새 상품",
  "description": "상품 설명",
  "brand": "브랜드",
  "attributes": {
    "color": "블루"
  },
  "tags": ["신상품"]
}
```

**Response:**
```json
{
  "masterId": "master-uuid",
  "versionId": "version-uuid",
  "version": 1,
  "versionStatus": "draft",
  "name": "새 상품",
  "description": "상품 설명",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

**특징:**
- ✅ Master와 첫 번째 Draft 버전 동시 생성
- ✅ 기본 Variant 1개 자동 생성
- ✅ 응답에 `masterId`와 `versionId` 모두 포함

**워크플로우:**
```
1. POST /masters
   → Master + Version 1 (draft) 생성

2. PUT /masters/:masterId/versions/1
   → Draft 버전 수정

3. PATCH /masters/:masterId/versions/1/publish
   → Draft → Active로 변경 (사용자에게 노출)
```

---

### Admin API - 버전 목록 조회

```http
GET /api/v1/masters/:masterId/versions
```

**설명:** 특정 Master의 모든 버전 목록 (관리자용)

**Path Parameters:**
- `masterId` (required): Master의 UUID

**Response:**
```json
[
  {
    "id": "version-uuid-1",
    "masterId": "master-uuid",
    "version": 1,
    "versionStatus": "inactive",
    "name": "상품명 v1",
    "parentVersionId": null,
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z",
    "children": [
      {
        "id": "version-uuid-2",
        "version": 2,
        "versionStatus": "active",
        "name": "상품명 v2",
        "parentVersionId": "version-uuid-1"
      }
    ]
  }
]
```

**특징:**
- ✅ 트리 구조로 반환 (parentVersionId 기반)
- ✅ 모든 상태(draft, active, inactive) 포함
- ✅ 버전 이력 추적 가능

---

### Admin API - Active 버전 조회

```http
GET /api/v1/masters/:masterId/versions/active
```

**설명:** 현재 Active 상태인 버전 조회

**Path Parameters:**
- `masterId` (required): Master의 UUID

**Response:**
```json
{
  "id": "version-uuid",
  "masterId": "master-uuid",
  "version": 2,
  "versionStatus": "active",
  "name": "상품명",
  "description": "상품 설명",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

**Error:**
```json
// 404 - Active 버전 없음
{
  "statusCode": 404,
  "message": "No active version found for master {masterId}",
  "error": "Not Found"
}
```

---

### Admin API - 특정 버전 조회

```http
GET /api/v1/masters/:masterId/versions/:version
```

**설명:** 버전 번호로 특정 버전 조회

**Path Parameters:**
- `masterId` (required): Master의 UUID
- `version` (required): 버전 번호 (integer)

**Response:**
```json
{
  "id": "version-uuid",
  "masterId": "master-uuid",
  "version": 3,
  "versionStatus": "draft",
  "name": "상품명 v3",
  "description": "상품 설명",
  "parentVersionId": "version-uuid-2",
  "draftOwnerId": "user-uuid",
  "createdAt": "2025-01-20T00:00:00Z",
  "updatedAt": "2025-01-20T15:00:00Z"
}
```

**특징:**
- ✅ 모든 상태의 버전 조회 가능
- ✅ Draft 버전의 경우 `draftOwnerId` 포함

---

### Admin API - 새 Draft 버전 생성

```http
POST /api/v1/masters/:masterId/versions
```

**설명:** 기존 버전을 복사하여 새 Draft 버전 생성

**Path Parameters:**
- `masterId` (required): Master의 UUID

**Request Body:**
```json
{
  "parentVersionId": "version-uuid-2",
  "copyMappings": true
}
```

**Request Fields:**
- `parentVersionId` (required): 복사할 부모 버전의 ID
- `copyMappings` (optional): Variant, Category 등 매핑 복사 여부 (default: true)

**Response:**
```json
{
  "id": "new-version-uuid",
  "masterId": "master-uuid",
  "version": 3,
  "versionStatus": "draft",
  "parentVersionId": "version-uuid-2",
  "draftOwnerId": "user-uuid",
  "name": "상품명 v2",
  "description": "상품 설명",
  "createdAt": "2025-01-20T00:00:00Z"
}
```

**특징:**
- ✅ 부모 버전의 모든 필드 복사
- ✅ `copyMappings: true`인 경우 Variants, Categories, Pricing Rules도 복사
- ✅ 자동으로 다음 버전 번호 할당

---

### Admin API - Draft 버전 수정

```http
PUT /api/v1/masters/:masterId/versions/:version
```

**설명:** Draft 상태의 버전만 수정 가능

**Path Parameters:**
- `masterId` (required): Master의 UUID
- `version` (required): 버전 번호

**Request Body:**
```json
{
  "name": "수정된 상품명",
  "description": "수정된 설명",
  "brand": "브랜드",
  "attributes": {
    "color": "레드"
  },
  "tags": ["신상품", "세일"]
}
```

**Response:**
```json
{
  "id": "version-uuid",
  "masterId": "master-uuid",
  "version": 3,
  "versionStatus": "draft",
  "name": "수정된 상품명",
  "description": "수정된 설명",
  "updatedAt": "2025-01-20T16:00:00Z"
}
```

**Error:**
```json
// 403 - Draft가 아닌 버전 수정 시도
{
  "statusCode": 403,
  "message": "Only draft versions can be modified. Create a new draft version to make changes.",
  "error": "Forbidden"
}
```

**특징:**
- ✅ Draft 상태 검증 필수
- ✅ Active/Inactive 버전은 수정 불가 (불변성 원칙)

---

### Admin API - 버전 발행

```http
PATCH /api/v1/masters/:masterId/versions/:version/publish
```

**설명:** Draft 버전을 Active 또는 Inactive로 변경

**Path Parameters:**
- `masterId` (required): Master의 UUID
- `version` (required): 버전 번호

**Request Body:**
```json
{
  "targetStatus": "active"
}
```

**Request Fields:**
- `targetStatus` (required): `"active"` 또는 `"inactive"`

**Response:**
```json
{
  "message": "Version published successfully",
  "masterId": "master-uuid",
  "versionId": "version-uuid",
  "version": 3,
  "oldStatus": "draft",
  "newStatus": "active",
  "previousActiveVersionId": "version-uuid-2"
}
```

**부수 효과:**
- Active로 변경 시: 기존 Active 버전이 자동으로 Inactive로 변경
- `ProductMasterActiveVersionChanged` 이벤트 발행
- 채널 동기화 트리거

**Error:**
```json
// 400 - Draft가 아닌 버전 발행 시도
{
  "statusCode": 400,
  "message": "Only draft versions can be published",
  "error": "Bad Request"
}
```

---

### Admin API - Draft 버전 삭제

```http
DELETE /api/v1/masters/:masterId/versions/:version
```

**설명:** Draft 상태의 버전만 삭제 가능

**Path Parameters:**
- `masterId` (required): Master의 UUID
- `version` (required): 버전 번호

**Response:**
```json
{
  "success": true,
  "message": "Draft version 3 deleted successfully"
}
```

**특징:**
- ✅ Draft만 삭제 가능 (Active/Inactive는 불가)
- ✅ 이 버전만 참조하던 Variant도 함께 삭제
- ✅ 영구 삭제 (복원 불가)

**Error:**
```json
// 400 - Draft가 아닌 버전 삭제 시도
{
  "statusCode": 400,
  "message": "Only draft versions can be deleted",
  "error": "Bad Request"
}
```

---

### Admin API - 버전 비교

```http
GET /api/v1/masters/:masterId/versions/:version/compare/:compareVersion
```

**설명:** 두 버전 간의 차이점 비교

**Path Parameters:**
- `masterId` (required): Master의 UUID
- `version` (required): 비교 대상 버전 1
- `compareVersion` (required): 비교 대상 버전 2

**Response:**
```json
{
  "differences": [
    {
      "field": "name",
      "oldValue": "상품명 v2",
      "newValue": "상품명 v3",
      "changeType": "modified"
    },
    {
      "field": "price",
      "oldValue": 10000,
      "newValue": 12000,
      "changeType": "modified"
    },
    {
      "field": "tags",
      "oldValue": ["신상품"],
      "newValue": ["신상품", "세일"],
      "changeType": "modified"
    }
  ],
  "summary": {
    "totalChanges": 3,
    "fieldsModified": 3,
    "fieldsAdded": 0,
    "fieldsRemoved": 0
  }
}
```

**특징:**
- ✅ 모든 필드 비교
- ✅ 중첩 객체 지원 (attributes, tags 등)
- ✅ 변경 요약 제공

---

### Admin API - Variant 목록 조회

```http
GET /api/v1/masters/:masterId/variants?version=2&status=active
```

**설명:** 특정 버전의 Variant 목록 (default: active 버전)

**Path Parameters:**
- `masterId` (required): Master의 UUID

**Query Parameters:**
- `version` (optional): 특정 버전 번호 (default: active 버전)
- `status` (optional): Variant 상태 필터
- `page` (optional): 페이지 번호
- `limit` (optional): 페이지 당 아이템 수

**Response:**
```json
{
  "data": [
    {
      "id": "variant-uuid-1",
      "variantName": "블루/L",
      "isDefault": false,
      "status": "active",
      "optionValues": [
        { "groupName": "색상", "valueName": "블루" },
        { "groupName": "사이즈", "valueName": "L" }
      ]
    }
  ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

---

## 요청/응답 형식

### 공통 응답 형식

#### 성공 응답 (단일 리소스)
```json
{
  "id": "resource-uuid",
  "name": "리소스명",
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-15T10:30:00Z"
}
```

#### 성공 응답 (목록 + 페이징)
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### 성공 응답 (작업 결과)
```json
{
  "success": true,
  "message": "Operation completed successfully"
}
```

### 에러 응답 형식

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request",
  "details": [
    {
      "field": "name",
      "message": "Name is required"
    }
  ]
}
```

#### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Only draft versions can be modified",
  "error": "Forbidden"
}
```

#### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Product not found",
  "error": "Not Found"
}
```

#### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## 에러 처리

### 에러 메시지 패턴

서비스 레이어에서는 명확한 에러 메시지를 던지고, 컨트롤러에서 HTTP 상태 코드로 변환합니다.

```typescript
// Service Layer
throw new Error('Master not found');
throw new Error('Only draft versions can be modified');
throw new Error('No active version found');

// Controller Layer
if (error.message.includes('not found')) {
  throw new HttpException(error.message, HttpStatus.NOT_FOUND);
}
if (error.message.includes('Only draft')) {
  throw new HttpException(error.message, HttpStatus.FORBIDDEN);
}
```

### 상태 코드 매핑

| 에러 유형 | HTTP 상태 | 메시지 패턴 |
|----------|-----------|------------|
| 리소스 없음 | 404 | `"not found"` |
| 권한 없음 | 403 | `"Only draft"`, `"Cannot modify"` |
| 유효성 검증 실패 | 400 | `"required"`, `"invalid"`, `"already exists"` |
| 서버 오류 | 500 | 기타 모든 오류 |

---

## 버전 관리 API

### 워크플로우 예시

#### 1. 상품 생성 → 수정 → 발행

```bash
# 1. 상품 생성 (Master + Draft v1)
POST /api/v1/masters
{
  "name": "새 상품"
}

Response:
{
  "masterId": "m1",
  "versionId": "v1",
  "version": 1,
  "versionStatus": "draft"
}

# 2. Draft 수정
PUT /api/v1/masters/m1/versions/1
{
  "name": "수정된 상품명",
  "description": "상품 설명"
}

# 3. Draft 발행 (Active로)
PATCH /api/v1/masters/m1/versions/1/publish
{
  "targetStatus": "active"
}
```

#### 2. 기존 상품 수정 (새 Draft 생성)

```bash
# 1. 현재 Active 버전 확인
GET /api/v1/masters/m1/versions/active

Response:
{
  "id": "v2",
  "version": 2,
  "versionStatus": "active"
}

# 2. 새 Draft 생성 (v2 복사)
POST /api/v1/masters/m1/versions
{
  "parentVersionId": "v2",
  "copyMappings": true
}

Response:
{
  "id": "v3",
  "version": 3,
  "versionStatus": "draft",
  "parentVersionId": "v2"
}

# 3. Draft 수정
PUT /api/v1/masters/m1/versions/3
{
  "name": "업데이트된 상품명"
}

# 4. Draft 발행
PATCH /api/v1/masters/m1/versions/3/publish
{
  "targetStatus": "active"
}

# v2는 자동으로 inactive로 변경됨
```

#### 3. 롤백 (이전 버전으로 되돌리기)

```bash
# 1. 롤백할 버전으로 새 Draft 생성
POST /api/v1/masters/m1/versions
{
  "parentVersionId": "v2",  # 이전 버전
  "copyMappings": true
}

Response:
{
  "id": "v4",
  "version": 4,
  "versionStatus": "draft"
}

# 2. 즉시 발행 (수정 없이)
PATCH /api/v1/masters/m1/versions/4/publish
{
  "targetStatus": "active"
}

# v3는 자동으로 inactive로 변경됨
```

---

## 마이그레이션 가이드

### 현재 API → 새 API 매핑

| 현재 API | 새 API | 비고 |
|---------|--------|------|
| `GET /masters` | `GET /masters` | 동일 (Active 버전) |
| `GET /masters/:id` | `GET /masters/:masterId` | 파라미터 명칭 명확화 |
| `POST /masters` | `POST /masters` | 동일 |
| `PUT /masters/:id` | `PUT /masters/:masterId/versions/:version` | ⚠️ 경로 변경! |
| `DELETE /masters/:id` | `DELETE /masters/:masterId` | 파라미터 명칭 명확화 |
| - | `GET /masters/:masterId/versions` | 🆕 신규 (버전 목록) |
| - | `POST /masters/:masterId/versions` | 🆕 신규 (Draft 생성) |
| - | `PATCH /masters/:masterId/versions/:version/publish` | 🆕 신규 (발행) |

### Breaking Changes

**1. PUT /masters/:id 엔드포인트**
```diff
- PUT /masters/:id
+ PUT /masters/:masterId/versions/:version
```

**변경 이유:** 
- 기존: `:id`가 실제로는 version ID였으나 혼란스러움
- 신규: Master ID와 Version을 명확히 구분

**마이그레이션:**
```typescript
// Before
PUT /masters/version-uuid-123
{
  "name": "수정"
}

// After
PUT /masters/master-uuid-456/versions/2
{
  "name": "수정"
}
```

**2. Response 구조**
```diff
// Before (모호함)
{
  "id": "version-uuid"  // Version ID인지 Master ID인지 불명확
}

// After (명확함)
{
  "masterId": "master-uuid",
  "versionId": "version-uuid",
  "version": 2
}
```

---

## 체크리스트

### API 개발 시
- [ ] Master ID와 Version ID를 명확히 구분했는가?
- [ ] 경로 파라미터 이름이 명확한가? (`:masterId`, `:version`)
- [ ] Public API는 Active 버전만 반환하는가?
- [ ] Admin API는 버전 상태를 검증하는가?
- [ ] 응답에 `masterId`와 `versionId`를 모두 포함했는가?
- [ ] Swagger 문서가 정확한가?
- [ ] 에러 메시지가 명확한가?

### 코드 리뷰 시
- [ ] 엔드포인트가 RESTful 원칙을 따르는가?
- [ ] 리소스 계층 구조가 논리적인가?
- [ ] 에러 처리가 일관된가?
- [ ] API 문서가 자기 설명적인가?
- [ ] Breaking Change가 있다면 문서화되었는가?

---

## 참고 자료

- [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md)
- [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md)
- [NestJS 공식 문서](https://docs.nestjs.com/)
- [RESTful API 설계 가이드](https://restfulapi.net/)

---

**최종 업데이트:** 2025-11-24  
**작성자:** AI Development Assistant  
**검토 필요:** CTO, Backend Team Lead, Frontend Team Lead

