# PIM 상품 관리 기능 리뷰 및 문제점 분석

> **작성일**: 2026-03-22
> **목적**: 관리자 페이지(admin-web)에서 상품 열람/편집 기능 구현 전, PIM 백엔드의 현재 상태를 정리하고 수정이 필요한 문제들을 식별한다.

---

## 1. 데이터 모델 개요

### 1.1 Master + Version 패턴

상품은 2계층으로 관리된다.

| 테이블 | 역할 | 주요 필드 |
|--------|------|-----------|
| `product_masters` | 상품 메타 컨테이너 | `id`, `createdAt`, `createdBy`, `deletedAt`, `deletedBy` |
| `product_master_versions` | 실제 상품 데이터 (버전별) | 이름, 설명, 브랜드, SEO, 가격 관련, 승인 상태 등 모든 필드 |

- **Master당 active 버전은 최대 1개**
- 버전 상태: `draft` → `inactive` / `active`
- Draft를 publish하면 기존 active는 inactive로 전환됨
- 버전 간 트리 구조 (`parentVersionId`)로 이력 추적
- 스키마 정의: `apps/pim/src/schema.ts`
- 타입 정의: `apps/pim/src/types.ts`

### 1.2 상품과 직접 관계를 갖는 엔티티

| 엔티티 | 테이블 | 관계 | 버전별 관리 |
|--------|--------|------|-------------|
| 카테고리 | `product_master_categories` | M:N (junction) | O (`versionId`) |
| 옵션 그룹 | `product_option_groups` + `product_master_option_groups` | M:N | O (`versionId`) |
| 옵션 그룹 Display | `product_option_group_displays` | 1:N (locale별) | O (`masterId`, `versionId`, `locale`) |
| 옵션 값 | `product_option_values` + `variant_option_values` | M:N | 옵션 그룹에 종속 |
| 옵션 값 Display | `product_option_value_displays` | 1:N (locale별) | O (`masterId`, `versionId`, `locale`) |
| Variant | `product_variants` + `product_master_variants` | M:N (junction) | O (`versionId`) |
| 이미지 | `product_images` | 1:N | O (`versionId`) |
| 가격 규칙 | `pricing_rules` + `product_master_pricing_rules` | M:N (junction) | O (`versionId`) |
| 태그 값 | `product_tag_values` | M:N | O (`masterId`, `versionId`) |
| 채널 상품 | `channel_products` | M:N | X (master 수준) |
| 채널 리스팅 | `channel_variant_listings` | 1:N | X (variant 수준) |

핵심: **채널 관련을 제외한 거의 모든 관계가 버전별로 관리**된다.

### 1.3 부가 엔티티

| 엔티티 | 테이블 | 설명 |
|--------|--------|------|
| 카테고리 | `product_categories` | 계층형 (self-referencing `parentId`) |
| 태그 그룹/값 | `tag_groups`, `tag_values` | 카테고리에 연결 가능 (`category_tag_groups`) |
| 판매 채널 | `sales_channels` | 네이버, 쿠팡 등 |
| 채널 카테고리 | `channel_categories` | 채널 그룹핑 |
| 승인 이력 | `product_approval_history` | 승인/반려 기록 |
| 감사 로그 | `product_audit_log` | 모든 변경 추적 |
| 가격 캐시 | `product_variant_price_cache` | 버전+variant별 계산된 가격 |
| 배너 | `banner_groups`, `banners` | 마케팅 배너 |
| 프로모션 | `promotions`, `promotion_products` | 타임세일 (미구현) |

---

## 2. API 엔드포인트 전체 목록

### 2.1 Product Masters (`/masters`)

| Method | Path | 설명 | 파일 |
|--------|------|------|------|
| `POST` | `/masters` | Master + Draft v1 생성 | `product-masters.controller.ts:73` |
| `GET` | `/masters` | 상품 목록 (pagination, filter) | `product-masters.controller.ts:151` |
| `GET` | `/masters/deleted` | 삭제된 상품 목록 | `product-masters.controller.ts:190` |
| `GET` | `/masters/:id` | Active 버전 상세 조회 | `product-masters.controller.ts:217` |
| `DELETE` | `/masters/:masterId` | Soft delete | `product-masters.controller.ts:248` |
| `POST` | `/masters/:masterId/restore` | 삭제 복원 | `product-masters.controller.ts:280` |
| `PATCH` | `/masters/:masterId/unpublish` | Active → Inactive | `product-masters.controller.ts:313` |
| `DELETE` | `/masters/:id/permanent` | 영구 삭제 | `product-masters.controller.ts:339` |

### 2.2 Product Versions (`/masters/:masterId/versions`)

| Method | Path | 설명 | 파일 |
|--------|------|------|------|
| `GET` | `/masters/:masterId/versions` | 버전 트리 조회 | `product-master-versions.controller.ts:47` |
| `GET` | `/masters/:masterId/versions/active` | Active 버전 조회 | `product-master-versions.controller.ts:65` |
| `GET` | `/masters/:masterId/versions/:versionId` | 특정 버전 상세 | `product-master-versions.controller.ts:86` |
| `POST` | `/masters/:masterId/versions` | 새 Draft 생성 | `product-master-versions.controller.ts:117` |
| `PUT` | `/masters/:masterId/versions/:versionId` | Draft 수정 | `product-master-versions.controller.ts:167` |
| `PATCH` | `/masters/:masterId/versions/:versionId/publish` | Publish (Active 전환) | `product-master-versions.controller.ts:231` |
| `GET` | `/masters/:masterId/versions/:versionId/compare/:compareVersionId` | 버전 비교 | `product-master-versions.controller.ts:268` |
| `DELETE` | `/masters/:masterId/versions/:versionId` | Draft 삭제 | `product-master-versions.controller.ts:300` |

### 2.3 Variants (`/variants`)

| Method | Path | 설명 | 파일 |
|--------|------|------|------|
| `GET` | `/variants/masters/:masterId` | Master의 variant 목록 (pagination) | `product-variants.controller.ts` |
| `GET` | `/variants/masters/:masterId/versions/:versionId` | 특정 버전의 variant 목록 | `product-variants.controller.ts` |

### 2.4 Pricing — Master 레벨 (`/masters/:masterId/pricing`)

| Method | Path | 설명 | 파일 |
|--------|------|------|------|
| `GET` | `/masters/:masterId/pricing/rules` | Active 버전의 가격 규칙 조회 | `master-pricing.controller.ts:72` |
| `POST` | `/masters/:masterId/pricing/calculate` | 가격 계산 | `master-pricing.controller.ts:101` |
| `GET` | `/masters/:masterId/pricing/price-set` | 가격 세트 조회 | `master-pricing.controller.ts:161` |

### 2.5 Pricing — Version 레벨 (`/versions/:versionId/pricing`)

| Method | Path | 설명 | 파일 |
|--------|------|------|------|
| `GET` | `/versions/:versionId/pricing/rules` | 버전별 가격 규칙 조회 | `version-pricing.controller.ts:48` |
| `PUT` | `/versions/:versionId/pricing/rules` | 가격 규칙 전체 교체 (draft만) | `version-pricing.controller.ts:68` |
| `DELETE` | `/versions/:versionId/pricing/rules` | 가격 규칙 전체 삭제 (draft만) | `version-pricing.controller.ts:98` |
| `POST` | `/versions/:versionId/pricing/calculate` | 가격 계산 | `version-pricing.controller.ts:127` |
| `GET` | `/versions/:versionId/pricing/price-set` | 가격 세트 조회 | `version-pricing.controller.ts:178` |

### 2.6 Categories (`/categories`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/categories` | 카테고리 생성 |
| `GET` | `/categories` | 카테고리 트리 |
| `GET` | `/categories/:id` | 카테고리 상세 |
| `PUT` | `/categories/:id` | 카테고리 수정 |
| `DELETE` | `/categories/:id` | 카테고리 삭제 |
| `GET` | `/categories/:id/path` | Root까지 경로 |
| `PATCH` | `/categories/:id/display-settings` | 표시 설정 |
| `PATCH` | `/categories/:id/seo-config` | SEO 설정 |
| `PATCH` | `/categories/:id/template-config` | 템플릿 설정 |
| `GET` | `/categories/:id/tag-groups` | 연결된 태그 그룹 |
| `POST` | `/categories/:id/tag-groups` | 태그 그룹 연결 |
| `POST` | `/categories/:id/products/move` | 상품 이동 |
| `POST` | `/categories/:id/products/add` | 상품 추가 |

### 2.7 Tags (`/tags`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/tags/groups` | 태그 그룹 생성 |
| `GET` | `/tags/groups` | 태그 그룹 목록 |
| `GET` | `/tags/groups/:id` | 태그 그룹 상세 (값 포함) |
| `PUT` | `/tags/groups/:id` | 태그 그룹 수정 |
| `DELETE` | `/tags/groups/:id` | 태그 그룹 삭제 |
| `POST` | `/tags/groups/:id/values` | 태그 값 생성 |
| `GET` | `/tags/groups/:id/values` | 태그 값 목록 |
| `PUT` | `/tags/values/:id` | 태그 값 수정 |
| `DELETE` | `/tags/values/:id` | 태그 값 삭제 |

### 2.8 Sales Channels (`/channels`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/channels` | 채널 생성 |
| `GET` | `/channels` | 채널 목록 |
| `GET` | `/channels/:id` | 채널 상세 |
| `PUT` | `/channels/:id` | 채널 수정 |
| `DELETE` | `/channels/:id` | 채널 삭제 |
| `POST` | `/channels/:id/set-active` | 활성/비활성 |
| `POST` | `/channels/validate` | 설정 검증 |

### 2.9 Channel Products (`/channel-products`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/channel-products` | 채널-상품 연결 |
| `GET` | `/channel-products/masters/:masterId` | Master의 채널 상품 |
| `GET` | `/channel-products/channels/:channelId` | 채널별 상품 |
| `GET` | `/channel-products/:id` | 상세 |
| `PUT` | `/channel-products/:id` | 수정 |
| `DELETE` | `/channel-products/:id` | 연결 해제 |
| `PATCH` | `/channel-products/:id/override-name` | 채널별 이름 오버라이드 |
| `PATCH` | `/channel-products/:id/set-active` | 활성/비활성 |

### 2.10 Channel Listings (`/channel-listings`)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/channel-listings/lookup` | 채널 아이템 ID로 variant 조회 |
| `POST` | `/channel-listings` | 리스팅 생성 |
| `GET` | `/channel-listings` | 전체 목록 |
| `GET` | `/channel-listings/variants/:variantId` | Variant별 리스팅 |
| `GET` | `/channel-listings/channels/:channelId` | 채널별 리스팅 |
| `GET` | `/channel-listings/:id` | 상세 |
| `PUT` | `/channel-listings/:id` | 수정 |
| `DELETE` | `/channel-listings/:id` | 삭제 |
| `PATCH` | `/channel-listings/:id/set-active` | 활성/비활성 |

### 2.11 Approval (`/masters`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/masters/:id/submit-approval` | 승인 요청 (draft → pending) |
| `POST` | `/masters/:id/approve` | 승인 (pending → approved+active) |
| `POST` | `/masters/:id/reject` | 반려 |
| `GET` | `/masters/pending-approval` | 승인 대기 목록 |
| `GET` | `/masters/:id/approval-history` | 승인 이력 |

### 2.12 Bulk Operations (`/masters/bulk`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/masters/bulk/update` | 일괄 수정 |
| `POST` | `/masters/bulk/delete` | 일괄 삭제 |
| `POST` | `/masters/bulk/restore` | 일괄 복원 |

### 2.13 CSV Import (`/products/csv`)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/products/csv/template` | CSV 템플릿 다운로드 |
| `POST` | `/products/csv/bulk-import` | CSV 일괄 등록 |

### 2.14 Audit (`/`)

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/masters/:id/audit-history` | 상품별 감사 로그 |
| `GET` | `/audit-logs` | 전체 감사 로그 |

### 2.15 Banners (`/banners`, `/banner-groups`)

| Method | Path | 설명 |
|--------|------|------|
| `POST` | `/banner-groups` | 배너 그룹 생성 |
| `GET` | `/banner-groups` | 배너 그룹 목록 |
| `GET` | `/banner-groups/:id` | 배너 그룹 상세 |
| `PUT` | `/banner-groups/:id` | 배너 그룹 수정 |
| `DELETE` | `/banner-groups/:id` | 배너 그룹 삭제 |
| `POST` | `/banners` | 배너 생성 |
| `GET` | `/banners/by-group/:bannerGroupId` | 그룹별 배너 목록 |
| `GET` | `/banners/:id` | 배너 상세 |
| `PUT` | `/banners/:id` | 배너 수정 |
| `DELETE` | `/banners/:id` | 배너 삭제 |

---

## 3. 버전 관리 시스템

### 3.1 워크플로우

```
1. POST /masters                    → Master + Draft v1 생성 (name: "새 상품", 기본 variant 1개)
2. PUT  /masters/:mid/versions/:vid → Draft 수정 (이름, 설명, 옵션, 이미지, 태그 등)
3. PUT  /versions/:vid/pricing/rules → 가격 규칙 설정 (draft만 가능)
4. PATCH /masters/:mid/versions/:vid/publish → Draft → Active
```

### 3.2 버전 상태 전이

```
         ┌─── createDraftVersion() ────┐
         │                              │
    ┌────▼───┐    publishVersion()    ┌─┴──────┐
    │ DRAFT  │ ─────────────────────> │ ACTIVE │ ← 최대 1개/master
    └────────┘                        └────┬───┘
         ▲                                 │ publishVersion() (새 버전)
         │                            ┌────▼────┐
         └── createDraftVersion() ─── │INACTIVE │
                                      └─────────┘
```

- `publishVersion()`: 기존 active → inactive, 대상 → active
- `unpublishMaster()`: active → inactive (active가 0개인 상태)
- `deleteDraftVersion()`: draft 버전만 삭제 가능

### 3.3 Draft 수정 시 OptionDiff 패턴

옵션 변경은 diff 방식으로 전달된다 (`types.ts:108-155`):

```typescript
interface OptionDiff {
  add?: AddOptionDto[];           // 새 옵션 그룹 추가 (값 포함)
  modifyDisplay?: ModifyOptionDisplayDto[];  // 기존 옵션 Display 수정
  addValues?: AddOptionValuesDto[];          // 기존 그룹에 값 추가
  removeValues?: RemoveOptionValuesDto[];    // 옵션 값 제거
  remove?: string[];                         // 옵션 그룹 전체 제거
}
```

### 3.4 승인 워크플로우

```
Draft ──submit──> Pending ──approve──> Approved (+ Active)
                          ──reject───> Rejected (status는 draft 유지)
```

- `approvalStatus`: `draft` | `pending` | `approved` | `rejected`
- 승인 이력: `product_approval_history` 테이블에 기록

---

## 4. 가격 체계

### 4.1 규칙 기반 3계층 가격 시스템

가격은 `pricing_rules` 테이블에 정의된 규칙들이 순서대로 적용되어 결정된다.

| 계층 (`layer`) | 용도 | 적용 순서 |
|----------------|------|-----------|
| `base_price` | 기본 가격 설정 | 1순위 |
| `membership_price` | 멤버십 할인 | 2순위 (base 위에 적용) |
| `tiered_price` | 수량별 단가 (도매) | 3순위 |

### 4.2 규칙 구성

| 필드 | 값 | 설명 |
|------|-----|------|
| `scopeType` | `all_variants` / `with_option` / `variants` | 적용 범위 |
| `scopeTargetIds` | `string[]` | `with_option`이면 옵션값 ID, `variants`면 variant ID |
| `operationType` | `offset` / `scale` / `override` | offset: 고정값 가감, scale: 배율(1000=1x), override: 대체 |
| `operationValue` | `number` | 연산에 사용할 값 |
| `minQuantity` | `number \| null` | `tiered_price` 계층에서만 사용 |

### 4.3 가격 캐시

- `product_variant_price_cache`: 버전+variant별로 계산된 `basePrice`, `membershipPrice`, `tieredPrices` 저장
- `VariantPriceCacheService`가 관리
- 상품 상세 조회 시 캐시에서 가격 읽음

### 4.4 수정 방식

- 가격 규칙은 **draft 버전에서만 수정 가능**
- `PUT /versions/:versionId/pricing/rules`: 전체 규칙 세트를 교체 (개별 규칙 수정 API 없음)
- `DELETE /versions/:versionId/pricing/rules`: 전체 삭제

---

## 5. 응답 DTO 구조

### 5.1 상품 목록 (`ProductSummaryDto`)

```typescript
{
  masterId: string;
  versionId: string;
  name: string;
  thumbnail: string | null;
  brand: string | null;
  isMembershipOnly: boolean;
  status: 'draft' | 'inactive' | 'active';
  createdAt: string;           // ISO 8601
  optionGroupNames: string[];  // ["색상", "사이즈"]
  variantCount: number;
  priceSummary: {
    minBasePrice: number;
    maxBasePrice: number;
    minMembershipPrice: number;
    maxMembershipPrice: number;
    hasTieredPrices: boolean;
  } | null;
}
```

### 5.2 상품 상세 — Version Detail (`ProductVersionDetailResponseDto`)

`GET /masters/:masterId/versions/:versionId` 응답 (매퍼 적용됨):

```typescript
{
  id: string;                   // version ID
  masterId: string;
  version: number;
  status: string;
  name: string;
  description: string | null;
  brand: string | null;
  thumbnail: string | null;     // primary image의 fileId
  seoTitle/seoDescription/seoKeywords: ...;
  descriptionHtml: string | null;
  isWholesaleOnly: boolean;
  isMembershipOnly: boolean;
  productType: string | null;   // 'regular_sale' | 'limited_edition'
  productCode: string | null;
  alternativeName/material/salesClassification/purchaseClassification: ...;
  shippingMethodId: string | null;
  marketPrice/supplyPrice: number | null;
  supplierId: string | null;
  ageRestriction/minQuantity/maxQuantity: number | null;
  salesStartDate/salesEndDate: Date | null;
  parentVersionId: string | null;
  draftOwnerId: string | null;
  createdAt: string;            // ISO 8601
  updatedAt: string;
  images: ProductImageDto[];
  optionGroups: OptionGroupReadModel[];
  variants: VariantReadModel[];
  channelProducts: any[];       // ⚠️ 항상 빈 배열
  tagValues: TagReadModel[];
  priceSummary: PriceSummary | null;
}
```

### 5.3 상품 상세 — Master Detail

`GET /masters/:id` 응답 (**매퍼 미적용**, 내부 DTO 그대로 반환):

`ProductDetailDto` 타입 (`types.ts:318-327`):
```typescript
interface ProductDetailDto extends ProductMasterVersion {
  images: ProductImage[];
  optionGroups: OptionGroupReadModel[];
  variants: VariantReadModel[];
  channelProducts: (ChannelProduct & { channel: SalesChannel })[];
  tagValues?: TagReadModel[];
  priceSummary?: PriceSummary | null;
}
```

---

## 6. 발견된 문제점

### P0 — 데이터 정합성 / 기능 장애

#### ~~ISSUE-01: Variant 가격이 항상 0으로 반환됨~~ ✅ 해결됨 (2026-03-22)

**위치**: `apps/pim/src/core/products/services/product-variants.service.ts`

**원인**: `getVariantsByMaster()` 내부에서 `this.calculateVariantPrice()`를 호출하는데, 이 메서드는 `GoneException`을 throw한다 (PricingCalculatorService로 이전됨). catch 블록에서 `price = 0`으로 fallback 처리되어 관리자가 보는 모든 variant 가격이 0원으로 표시됐다.

**수정 내용**: `VariantPriceCacheService`를 생성자에 주입하고, 루프 전에 `getCachedPriceSetsByVersion(actualVersionId)`로 버전 전체 캐시를 단일 쿼리로 조회한 뒤 Map 룩업으로 가격을 할당하도록 변경. `ProductReadAssembler`의 기존 패턴과 동일하게 통일됨.

---

#### ~~ISSUE-02: 승인(approve) 시 기존 active 버전 비활성화 없음 → active 중복 가능~~ ✅ 해결됨 (2026-03-22)

**위치**: `apps/pim/src/operations/approval/product-approval.service.ts`

**원인**: `approve()`가 대상 버전의 `status`를 `'active'`로 변경할 때 같은 master의 기존 active 버전을 먼저 `'inactive'`로 전환하는 로직이 없었다. 스키마에 `unique_master_active_version` 부분 유니크 인덱스가 있어 데이터 중복은 방지되지만, 기존 active 버전이 있을 경우 DB 제약 위반 에러로 승인 자체가 실패하는 기능 장애가 발생했다.

**수정 내용**: `inTx` 헬퍼를 추가하고 `approve()` 전체를 트랜잭션으로 감쌌다. 대상 버전 activate 직전에 동일 `masterId`의 기존 active 버전을 `'inactive'`로 전환하는 UPDATE를 추가했다. `ProductVersionsService.publishVersion()`과 동일한 패턴으로 통일됨.

---

#### ~~ISSUE-03: 모든 쓰기 API에서 userId 하드코딩~~ ✅ 해결됨 (2026-03-23)

**위치** (전수 목록):
- `product-master-versions.controller.ts:135` — `createDraftVersion()`
- `product-master-versions.controller.ts:174` — `updateVersion()`
- `product-masters.controller.ts:252` — `deleteMaster()`
- `product-masters.controller.ts:284` — `restore()`
- `product-masters.controller.ts:344` — `hardDelete()`
- `product-bulk.controller.ts:25, 49, 73` — bulk 작업 전체

**현상**: JWT에서 사용자 ID를 추출하는 Guard/Decorator가 연결되지 않아서 모든 변경 API가 `'00000000-0000-0000-0000-000000000000'`을 사용한다.

```typescript
// product-master-versions.controller.ts:135
const userId = '00000000-0000-0000-0000-000000000000';

// product-masters.controller.ts:252
const userIdToUse = userId || '00000000-0000-0000-0000-000000000000';

// product-bulk.controller.ts:25 — Body에서 userId를 받는 보안 문제
@Body('userId') userId: string,
```

**영향**:
1. 감사 로그(`product_audit_log`)의 `userId`가 전부 더미 값
2. `draftOwnerId`가 의미 없어서 draft 소유자 확인 불가
3. Bulk API는 Body에서 userId를 받아 위조 가능

**수정 내용**: `pim.module.ts`에 `AuthorizationModule.forRoot({ microserviceName: 'pim', scopes: [] })` 추가. 위 컨트롤러 전체에 `@UseGuards(JwtAuthGuard)` 적용하고 `@app/authorization`의 `@User()` 데코레이터로 `user.userId`(JWT `sub` 클레임) 주입. `@Body('userId')` 파라미터 및 하드코딩 fallback 전면 제거. `product-approval.controller.ts`도 동일 패턴으로 함께 수정하고 관련 DTO에서 `userId` 필드 제거.

---

#### ISSUE-04: 승인 API의 ID 파라미터 혼동 (Master ID vs Version ID)

**위치**: `apps/pim/src/operations/approval/product-approval.controller.ts:11-26`

**현상**: Controller는 `@ApiParam`에 "제품 마스터 ID"라고 문서화했지만, Service는 `productMasterVersions.id`(= Version ID)로 조회한다.

```typescript
// Controller — Swagger에 "제품 마스터 ID"로 기술
@ApiParam({ name: 'id', description: '제품 마스터 ID' })
async submitForApproval(@Param('id') productId: string, ...) {
  return await this.approvalService.submitForApproval(productId, body.userId);
}

// Service — Version ID로 조회
const [product] = await client
  .select().from(productMasterVersions)
  .where(eq(productMasterVersions.id, productId));  // versionId를 기대
```

**영향**: Master ID를 넘기면 해당 version을 찾지 못해 "Product not found" 에러. API 문서를 보고 호출하면 무조건 실패.

**수정 방향**: 두 가지 중 택일:
1. Controller 문서를 "Version ID"로 수정
2. Service에서 Master ID를 받아 active/latest draft 버전을 찾아서 처리하도록 변경 (관리자 UX 관점에서 이 쪽이 더 자연스러움)

---

### P1 — 기능 제약 / 응답 비일관성

#### ISSUE-05: `getMasterDetail()` 응답에 매퍼 미적용

**위치**: `apps/pim/src/core/products/controllers/product-masters.controller.ts:217-226`

**현상**: `GET /masters/:id`는 `ProductReadAssembler`가 반환하는 내부 `ProductDetailDto`를 그대로 응답한다. 반면 `GET /masters/:masterId/versions/:versionId`는 `ProductVersionMapper.toDetailResponseDto()`로 변환한 후 응답한다.

```typescript
// product-masters.controller.ts:225 — 매퍼 없음
return masterDetail

// product-master-versions.controller.ts:99 — 매퍼 적용
return ProductVersionMapper.toDetailResponseDto(versionDetail);
```

**영향**: 같은 상품 데이터인데 두 엔드포인트의 응답 형태가 다름. Date 객체가 ISO 문자열로 변환되지 않아 프론트엔드에서 파싱 오류 가능.

**수정 방향**: `getMasterDetail()`에도 `ProductVersionMapper.toDetailResponseDto()` 적용.

---

#### ISSUE-06: 상품 목록에 정렬 옵션 없음

**위치**: `apps/pim/src/core/products/controllers/product-masters.controller.ts:151-181`

**현상**: `GET /masters` 쿼리 파라미터에 `sortBy`, `orderBy`가 없음. 지원하는 필터는 `page`, `limit`, `categoryId`, `brand`, `name`, `mode`, `deleted`뿐.

**영향**: 관리자 페이지에서 이름순, 생성일순, 브랜드순 등의 정렬이 불가능.

**수정 방향**: `sortBy` (name, createdAt, brand, status 등) + `order` (asc, desc) 쿼리 파라미터 추가.

---

#### ISSUE-07: channelProducts가 항상 빈 배열

**위치**: `apps/pim/src/core/products/assemblers/product-read.assembler.ts:148`

**현상**: `ProductReadAssembler.getVersionDetail()`에서 `channelProducts`를 DB에서 로드하지 않고 빈 배열을 하드코딩으로 반환한다.

```typescript
const channelProducts: ProductDetailDto['channelProducts'] = [];

return {
  ...version,
  channelProducts,  // 항상 []
  ...
};
```

**영향**: 상품 상세 페이지에서 연결된 채널 정보를 확인할 수 없음. `channel_products` + `sales_channels` 테이블 join이 필요.

---

#### ISSUE-08: Variant 목록의 옵션 Display 미완성 (TODO)

**위치**: `apps/pim/src/core/products/services/product-variants.service.ts:154-155`

**현상**: `getVariantsByMaster()`에서 옵션 값의 Display 이름(displayName)을 로드하지 않는다. 기본 ID와 createdAt만 반환.

```typescript
// TODO: Update to use Display tables with masterId and version
// For now, returning basic info without Display data
optionValues = await client
  .select({
    id: productOptionValues.id,
    optionGroupId: productOptionValues.optionGroupId,
    createdAt: productOptionValues.createdAt,  // displayName 없음
  })
  ...
```

**대비**: `getVariantDetail()` (:220-258)에서는 Display 테이블을 제대로 join하여 `displayName`, `sortOrder`를 가져옴. 목록 API에도 동일 패턴 적용 필요.

**참고**: `ProductReadAssembler`는 `OptionReadLoader.getVariantOptionValues()`를 사용해서 올바르게 처리함.

---

#### ISSUE-09: `hardDelete` 엔드포인트의 ID 파라미터 혼동

**위치**: `apps/pim/src/core/products/controllers/product-masters.controller.ts:322-346`

**현상**: 경로는 `DELETE /masters/:id/permanent`이지만, Swagger 설명에는 "Version ID (현재 구현에서는 Master ID가 아님)"이라고 적혀 있다.

```typescript
@ApiParam({
  name: 'id',
  description: 'Version ID (현재 구현에서는 Master ID가 아님)',
})
async hardDelete(@Param('id') id: string, ...) {
  return await this.productMastersService.hardDelete(id, userIdToUse);
}
```

**영향**: URL 경로상 `/masters/:id`로 Master ID처럼 보이지만 실제로는 Version ID를 기대. API 소비자가 혼동.

---

### P2 — 개선 사항

#### ISSUE-10: Bulk 작업이 active 버전만 대상

**위치**: `apps/pim/src/operations/bulk/product-bulk.service.ts:38-42`

**현상**: `bulkUpdate`, `bulkSoftDelete`, `bulkRestore` 모두 `eq(productMasterVersions.status, 'active')` 조건이 hardcoded.

```typescript
.where(
  and(
    inArray(productMasterVersions.id, dto.productIds),
    eq(productMasterVersions.status, 'active')  // draft, inactive 대상 불가
  )
)
```

**영향**: draft 상태의 상품을 일괄 삭제/수정할 수 없음.

---

#### ISSUE-11: Bulk 작업의 updateData에 `any` 타입 사용

**위치**: `apps/pim/src/operations/bulk/product-bulk.service.ts:25`

**현상**: `const updateData: any = { ... }` — 타입 안전성 없음.

---

#### ISSUE-12: 태그 그룹 목록에 페이지네이션 없음

**위치**: `apps/pim/src/core/tags/tags.service.ts`

**현상**: `listTagGroups()`가 필터만 지원하고 전체 결과를 반환. 태그가 많아지면 성능 문제.

---

#### ISSUE-13: 가격 규칙 개별 수정 불가

**위치**: `apps/pim/src/core/pricing/version-pricing.controller.ts:54-83`

**현상**: `PUT /versions/:versionId/pricing/rules`는 전체 규칙 세트를 교체하는 방식. 개별 규칙 수정/삭제 API가 없어서 프론트엔드에서 항상 전체 규칙을 보내야 함.

**참고**: 현재 구조에서도 프론트엔드가 전체 규칙 세트를 관리하면 동작은 하지만, 대량 규칙이 있을 경우 실수로 규칙을 누락할 위험.

---

## 7. 문제 수정 우선순위 요약

| 순위 | Issue | 설명 | 난이도 |
|------|-------|------|--------|
| **P0** | ISSUE-01 | Variant 가격 항상 0 | 낮음 |
| **P0** | ISSUE-02 | 승인 시 active 중복 | 중간 |
| **P0** | ISSUE-03 | userId 하드코딩 | 중간 |
| **P0** | ISSUE-04 | 승인 API ID 혼동 | 낮음 |
| **P1** | ISSUE-05 | Master Detail 매퍼 미적용 | 낮음 |
| **P1** | ISSUE-06 | 목록 정렬 옵션 없음 | 낮음 |
| **P1** | ISSUE-07 | channelProducts 빈 배열 | 중간 |
| **P1** | ISSUE-08 | Variant 옵션 Display TODO | 중간 |
| **P1** | ISSUE-09 | hardDelete ID 혼동 | 낮음 |
| **P2** | ISSUE-10 | Bulk가 active만 대상 | 낮음 |
| **P2** | ISSUE-11 | Bulk updateData any 타입 | 낮음 |
| **P2** | ISSUE-12 | 태그 페이지네이션 없음 | 낮음 |
| **P2** | ISSUE-13 | 가격 규칙 개별 수정 불가 | 낮음 |
