# PIM (Product Information Management) API 문서

> **작성일:** 2025년 12월 8일  
> **최신 업데이트 커밋:** `c99531a` - PIM의 Jest 테스트 제거 및 타입 안정화

---

## 📋 목차

1. [개요](#개요)
2. [커밋 c99531a 변경 사항](#커밋-c99531a-변경-사항)
3. [API 엔드포인트 목록](#api-엔드포인트-목록)
   - [Product Masters API](#1-product-masters-api)
   - [Product Versions API](#2-product-versions-api)
   - [Product Variants API](#3-product-variants-api)
   - [Categories API](#4-categories-api)
   - [Pricing API](#5-pricing-api)
   - [Tags API](#6-tags-api)
   - [Sales Channels API](#7-sales-channels-api)
   - [Channel Categories API](#8-channel-categories-api)
   - [Channel Products API](#9-channel-products-api)
   - [Channel Listings API](#10-channel-listings-api)
   - [Banners API](#11-banners-api)
   - [Banner Groups API](#12-banner-groups-api)
   - [Product Search API](#13-product-search-api)
   - [Product Bulk Operations API](#14-product-bulk-operations-api)
   - [Product CSV API](#15-product-csv-api)
   - [Product Approval API](#16-product-approval-api)
   - [Product Audit API](#17-product-audit-api)
   - [Dashboard API](#18-dashboard-api)
4. [DTO (Data Transfer Objects) 상세](#-dto-data-transfer-objects-상세)
   - [Product Master DTO](#1-product-master-dto)
   - [Product Variant DTO](#2-product-variant-dto)
   - [Product Version DTO](#3-product-version-dto)
   - [Pricing DTO](#4-pricing-dto)
   - [Category DTO](#5-category-dto)
   - [Sales Channel DTO](#6-sales-channel-dto)
   - [Channel Product DTO](#7-channel-product-dto)
   - [Channel Listing DTO](#8-channel-listing-dto)
   - [Tag DTO](#9-tag-dto)
   - [공통 응답 DTO 패턴](#10-공통-응답-dto-패턴)

---

## 개요

PIM(Product Information Management)은 제품 정보를 중앙에서 관리하는 마이크로서비스입니다. 제품 마스터, 버전 관리, 가격 정책, 카테고리, 판매 채널 등을 통합 관리합니다.

### 핵심 개념

| 개념                | 설명                                                               |
| ------------------- | ------------------------------------------------------------------ |
| **Product Master**  | 제품의 기본 단위. 하나의 Master는 여러 Version을 가질 수 있음      |
| **Product Version** | Master의 특정 시점 스냅샷. `draft`, `active`, `inactive` 상태 존재 |
| **Product Variant** | 제품의 옵션 조합 (예: 색상 + 사이즈)                               |
| **Sales Channel**   | 판매처 (온라인 쇼핑몰, 오프라인 매장 등)                           |
| **Channel Product** | 특정 채널에서의 제품 설정 (채널별 가격, 이름 오버라이드 등)        |

### 버전 상태 흐름

```
draft → (publish) → active → (unpublish) → inactive
  ↑                                            ↓
  └────────────── (new draft) ────────────────┘
```

---

## 커밋 c99531a 변경 사항

### 📌 커밋 정보

- **커밋 해시:** `c99531a3812974490fb70a52b24849ac851c0312`
- **작성자:** PauseB
- **날짜:** 2025년 12월 5일
- **제목:** PIM의 Jest 테스트 제거 및 타입 안정화

### 🔄 주요 변경 사항

#### 1. Jest 테스트 파일 제거 (9,669줄 삭제)

다음 테스트 파일들이 삭제되었습니다:

- `apps/pim/test/TEST_SUMMARY.md`
- `apps/pim/test/dashboard.e2e-spec.ts`
- `apps/pim/test/integration/*.spec.ts` (10개 파일)
- `apps/pim/test/unit/*.spec.ts` (5개 파일)
- `apps/pim/test/support/*.ts` (5개 파일)

#### 2. 타입 안정화 (서비스 레이어)

주요 서비스 파일의 타입 정의가 개선되었습니다:

| 파일                            | 변경량  |
| ------------------------------- | ------- |
| `product-masters.service.ts`    | 1,873줄 |
| `product-variants.service.ts`   | 429줄   |
| `product-versions.service.ts`   | 120줄   |
| `pricing.service.ts`            | 78줄    |
| `pricing-calculator.service.ts` | 30줄    |
| `categories.service.ts`         | 28줄    |
| `channel-products.service.ts`   | 17줄    |
| `dashboard.service.ts`          | 12줄    |

#### 3. 스키마 및 타입 정의 변경

- `apps/pim/src/schema.ts` - 107줄 변경
- `apps/pim/src/types.ts` - 13줄 변경

#### 4. DTO 및 컨트롤러 수정

- `product-masters.controller.ts` - 46줄 변경
- `product-variants.controller.ts` - 12줄 변경
- `pricing.controller.ts` - 3줄 변경
- DTO 엔티티 파일 수정

#### 5. Elasticsearch 관련 수정

- `elasticsearch-sync.service.ts` - 20줄 변경
- `index-mappings.ts` - 4줄 변경
- `migrate-to-elasticsearch.ts` - 2줄 변경

### 🎯 변경 목적

- **테스트 코드 정리:** 불필요하거나 오래된 Jest 테스트 제거
- **타입 안정성 강화:** TypeScript 타입 정의 개선으로 컴파일 타임 오류 감소
- **코드 품질 향상:** 서비스 레이어 리팩토링

---

## API 엔드포인트 목록

### 1. Product Masters API

**Base Path:** `/masters`

#### 엔드포인트

| Method   | Path                           | 설명                                                    |
| -------- | ------------------------------ | ------------------------------------------------------- |
| `POST`   | `/masters`                     | 제품 마스터 생성 (Master + Draft v1 + 기본 Variant 1개) |
| `GET`    | `/masters`                     | 제품 마스터 목록 조회 (페이지네이션, 필터링 지원)       |
| `GET`    | `/masters/deleted`             | 삭제된 제품 마스터 목록 조회                            |
| `GET`    | `/masters/:id`                 | 제품 마스터 상세 조회 (Active 버전 기준)                |
| `DELETE` | `/masters/:masterId`           | 제품 마스터 소프트 삭제                                 |
| `POST`   | `/masters/:masterId/restore`   | 삭제된 제품 마스터 복원                                 |
| `PATCH`  | `/masters/:masterId/unpublish` | 제품 마스터 비공개 처리 (Active → Inactive)             |
| `DELETE` | `/masters/:id/permanent`       | 제품 버전 영구 삭제                                     |

#### 목록 조회 쿼리 파라미터

```
?page=1&limit=20&status=active&categoryId=uuid&brand=브랜드명&search=검색어&includeAllVersions=false
```

#### 제품 생성 워크플로우

```
1. POST /masters {} → Master + Draft v1 생성
2. PUT /masters/:masterId/versions/:versionId {...} → Draft 수정
3. PUT /products/:masterId/pricing {...} → 가격 정책 설정
4. PATCH /masters/:masterId/versions/:versionId/publish → Draft → Active
```

---

### 2. Product Versions API

**Base Path:** `/masters/:masterId/versions`

#### 엔드포인트

| Method   | Path                                                               | 설명                |
| -------- | ------------------------------------------------------------------ | ------------------- |
| `GET`    | `/masters/:masterId/versions`                                      | 버전 트리 조회      |
| `GET`    | `/masters/:masterId/versions/active`                               | Active 버전 조회    |
| `GET`    | `/masters/:masterId/versions/:versionId`                           | 특정 버전 조회      |
| `POST`   | `/masters/:masterId/versions`                                      | 새 Draft 버전 생성  |
| `PUT`    | `/masters/:masterId/versions/:versionId`                           | Draft 버전 수정     |
| `PATCH`  | `/masters/:masterId/versions/:versionId/publish`                   | Draft → Active 전환 |
| `GET`    | `/masters/:masterId/versions/:versionId/compare/:compareVersionId` | 두 버전 비교        |
| `DELETE` | `/masters/:masterId/versions/:versionId`                           | Draft 버전 삭제     |

#### 버전 생성 Body 예시

```json
{
  "parentVersionId": "uuid (선택, 없으면 active 버전 기준)",
  "copyMappings": true
}
```

---

### 3. Product Variants API

**Base Path:** `/variants`

#### 엔드포인트

| Method | Path                                              | 설명                                      |
| ------ | ------------------------------------------------- | ----------------------------------------- |
| `GET`  | `/variants/masters/:masterId`                     | 마스터별 Variant 조회                     |
| `GET`  | `/variants/masters/:masterId/versions/:versionId` | 버전별 Variant 조회                       |
| `GET`  | `/variants/:id`                                   | Variant 상세 조회                         |
| `PUT`  | `/variants/:id`                                   | Variant 수정                              |
| `PUT`  | `/variants/bulk`                                  | Variant 일괄 수정                         |
| `GET`  | `/variants/:id/price`                             | ⚠️ **Deprecated** - Pricing API 사용 권장 |
| `PUT`  | `/variants/:id/status`                            | Variant 상태 수정                         |

#### 쿼리 파라미터

```
?status=active&includePrice=true&page=1&limit=20
```

---

### 4. Categories API

**Base Path:** `/categories`

#### 엔드포인트

| Method   | Path                                 | 설명                                    |
| -------- | ------------------------------------ | --------------------------------------- |
| `POST`   | `/categories`                        | 카테고리 생성                           |
| `GET`    | `/categories`                        | 카테고리 트리 조회                      |
| `GET`    | `/categories/:id`                    | 카테고리 상세 조회                      |
| `PUT`    | `/categories/:id`                    | 카테고리 수정                           |
| `DELETE` | `/categories/:id`                    | 카테고리 삭제                           |
| `GET`    | `/categories/:id/children`           | 하위 카테고리 조회                      |
| `GET`    | `/categories/:id/path`               | 카테고리 경로 조회 (루트부터)           |
| `PUT`    | `/categories/:id/move`               | 카테고리 이동                           |
| `PUT`    | `/categories/:id/products`           | 상품을 카테고리로 이동 (기존 관계 삭제) |
| `POST`   | `/categories/:id/products/add`       | 상품을 카테고리에 추가 (기존 관계 유지) |
| `PATCH`  | `/categories/:id/display-settings`   | 표시 설정 업데이트                      |
| `PATCH`  | `/categories/:id/seo`                | SEO 설정 업데이트                       |
| `PATCH`  | `/categories/:id/template`           | 템플릿 설정 업데이트                    |
| `PATCH`  | `/categories/:id/visibility`         | 표시 여부 업데이트                      |
| `PUT`    | `/categories/:categoryId/tag-groups` | 태그 그룹 연결 설정                     |
| `GET`    | `/categories/:categoryId/tag-groups` | 태그 그룹 조회                          |

---

### 5. Pricing API

**Base Path:** `/products/:masterId/pricing`

#### 엔드포인트

| Method   | Path                                    | 설명                        |
| -------- | --------------------------------------- | --------------------------- |
| `GET`    | `/products/:masterId/pricing/rules`     | 가격 정책 조회              |
| `PUT`    | `/products/:masterId/pricing/rules`     | 가격 정책 교체              |
| `DELETE` | `/products/:masterId/pricing/rules`     | 가격 정책 삭제              |
| `POST`   | `/products/:masterId/pricing/calculate` | 가격 계산                   |
| `GET`    | `/products/:masterId/pricing/price-set` | Variant 전체 가격 세트 조회 |

#### 가격 계산 Body 예시

```json
{
  "variantId": "uuid",
  "quantity": 1,
  "customerType": "regular" // regular, member, wholesale
}
```

#### 가격 계산 응답 예시

```json
{
  "variantId": "uuid",
  "price": 10000,
  "totalPrice": 10000,
  "appliedRules": [...],
  "priceBreakdown": {
    "initialPrice": 12000,
    "afterBasePrice": 11000,
    "afterMembershipPrice": 10500,
    "afterTieredPrice": 10000
  }
}
```

---

### 6. Tags API

**Base Path:** `/tags`

#### 태그 그룹 엔드포인트

| Method   | Path                      | 설명                          |
| -------- | ------------------------- | ----------------------------- |
| `POST`   | `/tags/groups`            | 태그 그룹 생성                |
| `GET`    | `/tags/groups`            | 태그 그룹 목록 조회           |
| `GET`    | `/tags/groups/:id`        | 태그 그룹 단일 조회           |
| `GET`    | `/tags/groups/:id/detail` | 태그 그룹 상세 조회 (값 포함) |
| `PUT`    | `/tags/groups/:id`        | 태그 그룹 수정                |
| `DELETE` | `/tags/groups/:id`        | 태그 그룹 삭제                |

#### 태그 값 엔드포인트

| Method   | Path                           | 설명              |
| -------- | ------------------------------ | ----------------- |
| `POST`   | `/tags/groups/:groupId/values` | 태그 값 생성      |
| `GET`    | `/tags/groups/:groupId/values` | 태그 값 목록 조회 |
| `GET`    | `/tags/values/:id`             | 태그 값 단일 조회 |
| `PUT`    | `/tags/values/:id`             | 태그 값 수정      |
| `DELETE` | `/tags/values/:id`             | 태그 값 삭제      |

---

### 7. Sales Channels API

**Base Path:** `/channels`

#### 엔드포인트

| Method   | Path                   | 설명                       |
| -------- | ---------------------- | -------------------------- |
| `POST`   | `/channels`            | 판매 채널 생성             |
| `GET`    | `/channels`            | 판매 채널 목록 조회        |
| `GET`    | `/channels/active`     | 활성 판매 채널 조회        |
| `GET`    | `/channels/:id`        | 판매 채널 상세 조회        |
| `PUT`    | `/channels/:id`        | 판매 채널 수정             |
| `DELETE` | `/channels/:id`        | 판매 채널 삭제             |
| `PUT`    | `/channels/:id/status` | 판매 채널 활성/비활성 설정 |
| `GET`    | `/channels/type/:type` | 타입별 판매 채널 조회      |
| `POST`   | `/channels/validate`   | 채널 설정 검증             |

#### 쿼리 파라미터

```
?isActive=true&type=online&search=쿠팡&page=1&limit=20
```

---

### 8. Channel Categories API

**Base Path:** `/channels/categories`

#### 엔드포인트

| Method   | Path                       | 설명                  |
| -------- | -------------------------- | --------------------- |
| `GET`    | `/channels/categories`     | 판매처 분류 목록 조회 |
| `GET`    | `/channels/categories/:id` | 판매처 분류 상세 조회 |
| `POST`   | `/channels/categories`     | 판매처 분류 생성      |
| `PUT`    | `/channels/categories/:id` | 판매처 분류 수정      |
| `DELETE` | `/channels/categories/:id` | 판매처 분류 삭제      |

---

### 9. Channel Products API

**Base Path:** `/channel-products`

#### 엔드포인트

| Method   | Path                                                             | 설명                       |
| -------- | ---------------------------------------------------------------- | -------------------------- |
| `POST`   | `/channel-products`                                              | 채널별 제품 생성           |
| `GET`    | `/channel-products/masters/:masterId`                            | 마스터별 채널 제품 조회    |
| `GET`    | `/channel-products/channels/:channelId`                          | 채널별 제품 조회           |
| `GET`    | `/channel-products/:id`                                          | 채널 제품 상세 조회        |
| `PUT`    | `/channel-products/:id`                                          | 채널 제품 수정             |
| `DELETE` | `/channel-products/:id`                                          | 채널 제품 삭제             |
| `GET`    | `/channel-products/masters/:masterId/channels/:channelId/merged` | 병합된 채널 제품 조회      |
| `PUT`    | `/channel-products/:id/name`                                     | 제품명 오버라이드          |
| `PUT`    | `/channel-products/:id/status`                                   | 채널 제품 활성/비활성 설정 |

---

### 10. Channel Listings API

**Base Path:** `/channel-listings`

채널(외부 쇼핑몰)과 PIM Variant 간의 매핑을 관리합니다.

#### 엔드포인트

| Method   | Path                                      | 설명                          |
| -------- | ----------------------------------------- | ----------------------------- |
| `GET`    | `/channel-listings/lookup`                | 채널 상품 ID로 Variant 조회   |
| `POST`   | `/channel-listings`                       | 채널 매핑 생성                |
| `GET`    | `/channel-listings/by-variant/:variantId` | Variant의 채널 등록 현황 조회 |
| `GET`    | `/channel-listings/:id`                   | 채널 매핑 상세 조회           |
| `PUT`    | `/channel-listings/:id`                   | 채널 매핑 수정                |
| `PUT`    | `/channel-listings/:id/deactivate`        | 채널 매핑 비활성화            |
| `PUT`    | `/channel-listings/:id/activate`          | 채널 매핑 활성화              |
| `DELETE` | `/channel-listings/:id`                   | 채널 매핑 삭제 (Hard Delete)  |

#### Lookup 쿼리 파라미터

```
?salesChannelId=uuid&channelItemId=외부상품ID
// 또는
?channelCode=coupang&channelItemId=외부상품ID
```

---

### 11. Banners API

**Base Path:** `/banners`

#### 엔드포인트

| Method   | Path                               | 설명                       |
| -------- | ---------------------------------- | -------------------------- |
| `POST`   | `/banners`                         | 배너 생성                  |
| `GET`    | `/banners/by-group/:bannerGroupId` | 배너 그룹별 배너 목록 조회 |
| `GET`    | `/banners/:id`                     | 배너 상세 조회             |
| `PUT`    | `/banners/:id`                     | 배너 수정                  |
| `DELETE` | `/banners/:id`                     | 배너 삭제 (Soft Delete)    |

---

### 12. Banner Groups API

**Base Path:** `/banner-groups`

#### 엔드포인트

| Method   | Path                           | 설명                                 |
| -------- | ------------------------------ | ------------------------------------ |
| `POST`   | `/banner-groups`               | 배너 그룹 생성                       |
| `GET`    | `/banner-groups`               | 배너 그룹 목록 조회                  |
| `GET`    | `/banner-groups/by-code/:code` | 코드로 배너 그룹 조회 (프론트엔드용) |
| `GET`    | `/banner-groups/:id`           | 배너 그룹 상세 조회                  |
| `PUT`    | `/banner-groups/:id`           | 배너 그룹 수정                       |
| `DELETE` | `/banner-groups/:id`           | 배너 그룹 삭제 (Soft Delete)         |

---

### 13. Product Search API

**Base Path:** `/products/search`

Elasticsearch 기반 제품 검색 API입니다.

#### 엔드포인트

| Method | Path               | 설명                      |
| ------ | ------------------ | ------------------------- |
| `GET`  | `/products/search` | 제품 검색 (Elasticsearch) |

#### 쿼리 파라미터

검색 키워드, 필터, 태그를 지원하며 퍼지 검색(fuzzy search)과 중첩 태그 필터링을 지원합니다.

---

### 14. Product Bulk Operations API

**Base Path:** `/masters/bulk`

#### 엔드포인트

| Method | Path                    | 설명                  |
| ------ | ----------------------- | --------------------- |
| `POST` | `/masters/bulk/update`  | 제품 일괄 수정        |
| `POST` | `/masters/bulk/delete`  | 제품 일괄 소프트 삭제 |
| `POST` | `/masters/bulk/restore` | 삭제된 제품 일괄 복원 |

---

### 15. Product CSV API

**Base Path:** `/products/csv`

#### 엔드포인트

| Method | Path                        | 설명                      |
| ------ | --------------------------- | ------------------------- |
| `GET`  | `/products/csv/template`    | CSV 템플릿 다운로드       |
| `POST` | `/products/csv/bulk-import` | CSV 파일로 제품 일괄 등록 |
| `GET`  | `/products/csv/export`      | 제품 목록 CSV 내보내기    |

#### CSV Import Body (multipart/form-data)

```
file: CSV 파일
userId: 작업자 ID
```

---

### 16. Product Approval API

**Base Path:** `/masters`

#### 엔드포인트

| Method | Path                            | 설명                     |
| ------ | ------------------------------- | ------------------------ |
| `POST` | `/masters/:id/submit-approval`  | 제품 승인 요청           |
| `POST` | `/masters/:id/approve`          | 제품 승인                |
| `POST` | `/masters/:id/reject`           | 제품 거부                |
| `GET`  | `/masters/pending-approval`     | 승인 대기 중인 제품 목록 |
| `GET`  | `/masters/:id/approval-history` | 제품 승인 이력           |

---

### 17. Product Audit API

**Base Path:** `/products/audit`

#### 엔드포인트

| Method | Path                                | 설명                    |
| ------ | ----------------------------------- | ----------------------- |
| `GET`  | `/products/audit/:id`               | 제품 감사 이력 조회     |
| `GET`  | `/products/audit/recent`            | 최근 감사 로그 조회     |
| `GET`  | `/products/audit/by-user/:userId`   | 사용자별 감사 로그 조회 |
| `GET`  | `/products/audit/by-action/:action` | 액션별 감사 로그 조회   |

#### 액션 타입

- `CREATE` - 생성
- `UPDATE` - 수정
- `DELETE` - 삭제

---

### 18. Dashboard API

**Base Path:** `/dashboard`

#### 엔드포인트

| Method | Path                      | 설명                 |
| ------ | ------------------------- | -------------------- |
| `GET`  | `/dashboard/metrics`      | 대시보드 메트릭 조회 |
| `GET`  | `/dashboard/top-products` | 상위 제품 목록 조회  |
| `GET`  | `/dashboard/sales-trends` | 매출 트렌드 조회     |

#### 메트릭 응답 예시

```json
{
  "totalProducts": 1234,
  "todayRegistered": 12,
  "byStatus": {
    "active": 800,
    "draft": 200,
    "inactive": 234
  },
  "byApprovalStatus": {...}
}
```

---

## 📦 DTO (Data Transfer Objects) 상세

### 1. Product Master DTO

#### CreateMasterDto (생성)

모든 필드가 선택사항이며, 빈 객체 `{}`로 생성 후 수정 API로 채워나가는 방식입니다.

```typescript
{
  name?: string;               // 제품명 (미입력 시 "새 상품")
  description?: string;        // 제품 설명
  brand?: string;              // 브랜드명
  thumbnailFileId?: string;    // 썸네일 파일 ID (file-service)
  additionalImageFileIds?: string[];  // 부가 이미지 파일 ID (최대 5개)
  tags?: string[];             // 마케팅 태그
  images?: string[];           // 제품 이미지 URL
  attributes?: Record<string, any>;   // 제품 속성 (키-값)
  seoTitle?: string;           // SEO 제목
  seoDescription?: string;     // SEO 설명
  seoKeywords?: string[];      // SEO 키워드
  descriptionHtml?: string;    // 상품 상세설명 HTML
  isWholesaleOnly?: boolean;   // 도매회원 전용 여부
  isMembershipOnly?: boolean;  // 멤버십회원 전용 여부
  categoryIds?: string[];      // 카테고리 ID 배열
  primaryCategoryId?: string;  // 주 카테고리 ID
}
```

#### UpdateProductMasterDto (수정)

```typescript
{
  name?: string;
  description?: string;
  categoryIds?: string[];       // 기존 카테고리를 모두 대체
  primaryCategoryId?: string;
  brand?: string;
  images?: string[];
  attributes?: Record<string, any>;
  status?: 'active' | 'inactive' | 'draft';
  thumbnailFileId?: string;
  additionalImageFileIds?: string[];
  tags?: string[];
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string[];
  descriptionHtml?: string;
  isWholesaleOnly?: boolean;
  isMembershipOnly?: boolean;
  optionDiff?: OptionDiffDto;   // 옵션 변경사항
  tagValueIds?: string[];       // 태그 값 ID (기존 태그 모두 대체)
}
```

#### OptionDiffDto (옵션 변경)

옵션 그룹과 값을 추가/수정/삭제하는 diff 기반 DTO입니다.

```typescript
{
  add?: [{                       // 새 옵션 그룹 추가
    displayName: string;
    description?: string;
    sortOrder?: number;
    values: [{
      displayName: string;
      colorCode?: string;        // 색상 코드 (예: #FF0000)
      imageUrl?: string;
      sortOrder?: number;
    }]
  }];
  modifyDisplay?: [{             // 기존 옵션 그룹 표시 정보 수정
    optionGroupId: string;
    displayName?: string;
    description?: string;
    sortOrder?: number;
    values?: [{
      optionValueId: string;
      displayName?: string;
      colorCode?: string;
      imageUrl?: string;
      sortOrder?: number;
    }]
  }];
  addValues?: [{                 // 기존 옵션 그룹에 새 값 추가
    optionGroupId: string;
    values: [{ displayName, colorCode?, imageUrl?, sortOrder? }]
  }];
  removeValues?: [{              // 기존 옵션 그룹에서 값 제거
    optionGroupId: string;
    optionValueIds: string[];
  }];
  remove?: string[];             // 옵션 그룹 ID 제거
}
```

#### MasterDetailDto (상세 응답)

```typescript
{
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  tags: string[] | null;
  images: any;
  attributes: any;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  status: string | null;
  isWholesaleOnly: boolean | null;
  isMembershipOnly: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  createdBy: string | null;
  updatedBy: string | null;
  optionGroups: OptionGroupDto[];
  variants: VariantDto[];
  channelProducts: ChannelProductDto[];
  tagValues?: ProductTagDto[];
}
```

---

### 2. Product Variant DTO

#### UpdateProductVariantDto (수정)

```typescript
{
  variantName?: string;         // 변형명
  images?: string[];            // 변형별 이미지 URL
  status?: 'active' | 'inactive';
}
```

#### VariantWithPriceDto (응답)

```typescript
{
  id: string;
  masterId: string;
  variantName: string | null;
  images: any;
  displayOrder: number | null;
  status: string | null;
  isDefault: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  price: number;                // 계산된 가격
  optionValues: any[];
}
```

---

### 3. Product Version DTO

#### CreateDraftVersionDto (생성)

```typescript
{
  parentVersionId?: string;     // 선택, 없으면 active 버전 기준
  copyMappings?: boolean;       // 매핑 복사 여부 (기본: true)
}
```

#### VersionTreeResponseDto (버전 트리 응답)

```typescript
{
  id: string;
  masterId: string;
  version: number;
  status: 'draft' | 'active' | 'inactive';
  name: string;
  parentVersionId: string | null;
  children: VersionTreeResponseDto[];
  createdAt: string;
  updatedAt: string;
  draftOwnerId: string | null;
}
```

---

### 4. Pricing DTO

#### PricingRuleDto (가격 규칙)

```typescript
{
  order: number;                        // 규칙 순서 (1부터)
  layer: 'base_price' | 'membership_price' | 'tiered_price';
  scopeType: 'all_variants' | 'with_option' | 'variants';
  scopeTargetIds?: string[];            // 옵션 값 ID 또는 Variant ID
  operationType: 'offset' | 'scale' | 'override';
  operationValue: number;               // 원 단위, scale은 1000배
  minQuantity?: number;                 // tiered_price 전용
}
```

#### ReplacePricingRulesDto (가격 정책 교체)

```typescript
{
  basePriceRules: PricingRuleDto[];
  membershipPriceRules: PricingRuleDto[];
  tieredPriceRules: PricingRuleDto[];
}
```

#### CalculatePriceRequestDto (가격 계산 요청)

```typescript
{
  variantId: string;
  quantity?: number;            // 기본: 1
  customerType?: 'regular' | 'membership';  // 기본: regular
}
```

#### CalculatePriceResponseDto (가격 계산 응답)

```typescript
{
  variantId: string;
  price: number;                // 최종 단가
  totalPrice?: number;          // 총 가격 (price * quantity)
  appliedRules: AppliedRuleDto[];
  priceBreakdown: {
    initialPrice: number;
    afterBasePrice: number;
    afterMembershipPrice?: number;
    afterTieredPrice?: number;
  }
}
```

#### VariantPriceSetDto (가격 세트)

```typescript
{
  basePrice: number;            // 일반 고객 가격
  membershipPrice: number;      // 멤버십 가격
  tieredPrices: [{
    minQuantity: number;
    price: number;
  }]
}
```

---

### 5. Category DTO

#### CreateCategoryDto (생성)

```typescript
{
  name: string;                 // 카테고리 이름 (필수)
  description?: string;
  slug?: string;                // URL 슬러그
  imageUrl?: string;
  parentId?: string;            // 부모 카테고리 ID
  sortOrder?: number;
  tagGroupLinks?: [{
    tagGroupId: string;
    displayOrder?: number;
  }]
}
```

#### CategoryResponseDto (응답)

```typescript
{
  id: string;
  name: string;
  description: string | null;
  slug: string;
  parentId: string | null;
  level: number;                // 깊이
  path: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  childCount?: number;
  productCount?: number;
  thumbnail?: string | null;
}
```

---

### 6. Sales Channel DTO

#### CreateSalesChannelDto (생성)

```typescript
{
  type?: 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';
  site: 'medusa' | 'naver' | 'coupang' | 'phone_order' | 'other';  // 필수
  categoryId?: string;          // 판매처 분류 ID
  name: string;                 // 필수
  description?: string;
  config?: Record<string, any>; // 채널별 설정
  isActive?: boolean;
  apiEndpoint?: string;
  credentials?: Record<string, any>;
}
```

#### SalesChannelDto (응답)

```typescript
{
  id: string;
  type: 'ONLINE' | 'OFFLINE' | 'MARKETPLACE' | 'MOBILE_APP' | 'SOCIAL_COMMERCE';
  site: string;
  categoryId: string | null;
  category?: ChannelCategoryDto | null;
  name: string;
  description: string | null;
  config: Record<string, any>;  // sender 정보 등
  isActive: boolean;
  apiEndpoint: string | null;
  credentials: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}
```

---

### 7. Channel Product DTO

#### CreateChannelProductDto (생성)

```typescript
{
  masterId: string;             // 필수
  channelId: string;            // 필수
  name?: string;                // 채널별 제품명 (미지정시 마스터명)
  description?: string;
  images?: string[];
  isActive?: boolean;
  channelSpecificData?: Record<string, any>;
}
```

---

### 8. Channel Listing DTO

#### CreateChannelListingDto (생성)

```typescript
{
  variantId: string;            // PIM Variant ID
  salesChannelId: string;       // 판매 채널 ID
  channelItemId: string;        // 채널에서의 상품 ID (예: vendorItemId)
  channelItemName?: string;     // 채널에서의 상품명
  channelOptionName?: string;   // 채널에서의 옵션명 (예: "블랙 / M")
  channelPrice?: number;        // 채널에서의 판매가
  channelProductUrl?: string;   // 채널 상품 URL
}
```

#### LookupChannelListingResponseDto (조회 응답)

```typescript
{
  variantId: string
  variantCode: string | null
  variantName: string | null
  isActive: boolean
}
```

---

### 9. Tag DTO

#### CreateTagGroupDto (태그 그룹 생성)

```typescript
{
  name: string;                 // 필수
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}
```

#### TagGroupResponseDto (태그 그룹 응답)

```typescript
{
  id: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  valuesCount?: number;
}
```

#### CreateTagValueDto (태그 값 생성)

```typescript
{
  groupId: string;              // 태그 그룹 ID (필수)
  value: string;                // 태그 값 (필수)
  description?: string;
  displayOrder?: number;
}
```

---

### 10. 공통 응답 DTO 패턴

#### 목록 응답

```typescript
{
  data: T[];                    // 항목 배열
  total: number;                // 전체 개수
  page: number;                 // 현재 페이지
  limit: number;                // 페이지당 개수
}
```

#### 수정 응답

```typescript
{
  success: boolean
  data: T // 수정된 객체
}
```

#### 에러 응답

```typescript
{
  statusCode: number;
  message: string;
  error?: string;               // 에러 타입
}
```

---

## 📝 참고 사항

### 공통 응답 코드

| 코드  | 설명                         |
| ----- | ---------------------------- |
| `200` | 성공                         |
| `201` | 생성 성공                    |
| `204` | 성공 (응답 본문 없음)        |
| `400` | 잘못된 요청                  |
| `403` | 권한 없음                    |
| `404` | 리소스를 찾을 수 없음        |
| `409` | 충돌 (중복 등)               |
| `410` | Gone (Deprecated 엔드포인트) |
| `500` | 서버 오류                    |

### UUID 형식

모든 ID는 UUID v4 형식을 사용합니다.

```
550e8400-e29b-41d4-a716-446655440000
```

### 페이지네이션

목록 조회 API는 공통적으로 다음 파라미터를 지원합니다:

- `page`: 페이지 번호 (1부터 시작)
- `limit`: 페이지당 항목 수

### 인증

현재 인증 미구현 상태이며, userId는 요청 Body에서 전달합니다.
향후 JWT 기반 인증이 구현될 예정입니다.

---

## 🔗 관련 문서

- 스키마 정의: `apps/pim/src/schema.ts`
- 타입 정의: `apps/pim/src/types.ts`
- WMS 핵심 쿼리 규칙: `.cursor/rules/wms-core-query-and-tx.mdc`
