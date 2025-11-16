# PIM 판매상품 버전 관리 구현 완료 보고서

## 구현 일자
2025-11-16

## 개요
PIM (Product Information Management) 시스템에 판매상품의 버전 관리 기능을 성공적으로 구현했습니다. 이를 통해 상품의 여러 버전을 관리하고, draft → publish 워크플로우를 지원하며, 버전 간 전환이 가능해졌습니다.

## 핵심 설계 원칙

### 1. 버전 구조
- **masterId**: 여러 버전을 묶는 논리적 ID (모든 버전이 공유)
- **id**: 각 버전의 물리적 고유 ID
- **version**: 자동 증가 정수 (1, 2, 3, ...)
- **parentVersionId**: 부모 버전 참조 (트리 구조)
- **versionStatus**: 'draft' | 'inactive' | 'active'
- **draftOwnerId**: draft 상태일 때 수정 가능한 관리자 ID

### 2. 매핑 테이블 패턴
옵션/품목/가격정책을 버전 간 재사용할 수 있도록 매핑 테이블 도입:
- `productMasterOptionGroups` (masterId, optionGroupId, version)
- `productMasterVariants` (masterId, variantId, version)
- `productMasterPricingRules` (masterId, pricingRuleId, version)

### 3. 외부 시스템 호환성
- `channelProducts`, WMS 등은 masterId 참조
- Variants는 절대 삭제되지 않으므로 WMS 연동 안정성 보장
- Active 버전의 데이터를 자동으로 사용

## 구현된 기능

### 1. 스키마 변경 (`schema.ts`)
✅ **완료**

**변경 사항:**
- `productMasters` 테이블에 버전 관리 필드 추가:
  - `masterId`: 논리적 마스터 ID
  - `version`: 버전 번호
  - `parentVersionId`: 부모 버전
  - `versionStatus`: 버전 상태
  - `draftOwnerId`: Draft 소유자
- 새로운 매핑 테이블 생성:
  - `productMasterOptionGroups`
  - `productMasterVariants`
  - `productMasterPricingRules`
- 기존 테이블 FK 조정:
  - `productOptionGroups.masterId`: nullable
  - `productVariants.masterId`: nullable
  - `pricingRules.masterId`: nullable

**인덱스 추가:**
```typescript
index('idx_masters_master_id').on(table.masterId)
index('idx_masters_version_status').on(table.versionStatus)
index('idx_masters_master_id_version').on(table.masterId, table.version)
uniqueIndex('unique_master_active_version') // masterId 당 하나의 active 버전만
uniqueIndex('unique_master_version') // masterId + version 조합 유니크
```

### 2. 타입 정의 (`types.ts`)
✅ **완료**

**추가된 타입:**
```typescript
// 버전 상태
export type VersionStatus = 'draft' | 'inactive' | 'active';

// 매핑 테이블 타입
export type ProductMasterOptionGroup
export type ProductMasterVariant
export type ProductMasterPricingRule

// DTO 타입
export interface VersionTreeNode
export interface VersionDiffDto
export interface CreateDraftVersionDto
export interface PublishVersionDto
```

### 3. 버전 관리 서비스 (`product-versions.service.ts`)
✅ **완료**

**핵심 메소드:**

#### 버전 조회
- `getVersionTree(masterId)`: 버전 트리 구조로 조회
- `getActiveVersion(masterId)`: 현재 active 버전 조회
- `getVersionById(versionId)`: 특정 버전 조회

#### 버전 생성 및 관리
- `createDraftVersion(parentVersionId, userId, copyMappings)`: 
  - 부모 버전을 기반으로 새 draft 버전 생성
  - 매핑 정보 자동 복사
  - 버전 번호 자동 증가
- `publishVersion(versionId, targetStatus)`:
  - Draft 버전을 active 또는 inactive로 변경
  - Active 전환 시 기존 active 버전 자동 inactive 처리

#### 버전 비교
- `compareVersions(versionId1, versionId2)`:
  - 두 버전 간 필드별 차이 반환
  - 25개 필드 비교 지원

#### 권한 관리
- `canUserModifyVersion(versionId, userId)`:
  - Draft 상태 확인
  - 소유자 권한 확인

#### 매핑 관리
- `linkOptionGroupToVersion()` / `unlinkOptionGroupFromVersion()`
- `linkVariantToVersion()` / `unlinkVariantFromVersion()`
- `linkPricingRuleToVersion()` / `unlinkPricingRuleFromVersion()`
- `getVersionOptionGroups()` / `getVersionVariants()` / `getVersionPricingRules()`

### 4. 버전 API 엔드포인트 (`product-versions.controller.ts`)
✅ **완료**

**제공되는 API:**

#### GET `/masters/:masterId/versions`
- 버전 트리 조회
- 응답: `VersionTreeResponseDto[]`

#### GET `/masters/:masterId/versions/active`
- Active 버전 조회
- 응답: `ProductMaster`

#### POST `/masters/:masterId/versions`
- 새 Draft 버전 생성
- 요청: `CreateDraftVersionDto`
- 응답: `ProductMaster`

#### PATCH `/masters/:masterId/versions/:versionId/publish`
- 버전 Publish
- 요청: `PublishVersionDto { targetStatus: 'active' | 'inactive' }`
- 응답: `{ message: string }`

#### GET `/masters/:masterId/versions/:versionId/compare/:compareVersionId`
- 버전 비교
- 응답: `VersionDiffItemDto[]`

### 5. 판매상품 서비스 수정 (`product-masters.service.ts`)
✅ **완료**

**변경 사항:**
- 새 상품 생성 시 버전 필드 자동 설정:
  ```typescript
  {
    id: newId,
    masterId: newId,  // 첫 버전은 자기 자신을 masterId로
    version: 1,
    versionStatus: 'draft',
    parentVersionId: null,
    draftOwnerId: null
  }
  ```
- `ProductVersionsService` 의존성 주입
- 기존 코드와의 하위 호환성 유지

### 6. 판매상품 컨트롤러 수정 (`product-masters.controller.ts`)
✅ **완료**

**추가된 쿼리 파라미터:**
- `versionStatus`: 'draft' | 'inactive' | 'active' (기본값: 'active')
- `includeAllVersions`: boolean (기본값: false)

**동작:**
- 기본적으로 active 버전만 조회
- `includeAllVersions=true`면 모든 버전 조회
- `versionStatus`로 특정 상태 필터링 가능

### 7. 채널 연동 수정 (`channel-products.service.ts`)
✅ **완료**

**변경 사항:**
- JOIN 조건 변경:
  ```typescript
  // 변경 전
  eq(channelProducts.masterId, productMasters.id)
  
  // 변경 후
  and(
    eq(channelProducts.masterId, productMasters.masterId),
    eq(productMasters.versionStatus, 'active')
  )
  ```
- 외부에서 볼 때는 항상 active 버전의 데이터만 표시
- 버전 정보도 함께 반환 (masterId, version, versionStatus)

## 워크플로우 예시

### 1. 새 상품 생성
```
1. POST /masters
   → masterId=A, version=1, versionStatus='draft' 생성
```

### 2. 첫 버전 Publish
```
2. PATCH /masters/A/versions/{versionId}/publish
   { targetStatus: 'active' }
   → version=1을 'active'로 변경
```

### 3. 수정사항 반영을 위한 새 버전 생성
```
3. POST /masters/A/versions
   { parentVersionId: "{version1-id}", copyMappings: true }
   → masterId=A, version=2, versionStatus='draft' 생성
   → version=1의 옵션/품목/가격정책 매핑 자동 복사
```

### 4. 새 버전 수정 후 Publish
```
4. PUT /masters/{version2-id}
   { name: "수정된 상품명", ... }
   → version=2 데이터 수정

5. PATCH /masters/A/versions/{version2-id}/publish
   { targetStatus: 'active' }
   → version=2를 'active'로 변경
   → version=1 자동으로 'inactive'로 변경
```

### 5. 이전 버전으로 되돌리기
```
6. POST /masters/A/versions
   { parentVersionId: "{version1-id}", copyMappings: true }
   → masterId=A, version=3, versionStatus='draft' 생성
   → version=1의 데이터/매핑 복사

7. PATCH /masters/A/versions/{version3-id}/publish
   { targetStatus: 'active' }
   → version=3를 'active'로 변경
   → version=2 자동으로 'inactive'로 변경
```

## 버전 트리 구조 예시

```
masterId: A
└── version 1 (inactive) [root]
    ├── version 2 (active)
    │   └── version 4 (draft)
    └── version 3 (inactive)
        └── version 5 (draft)
```

## 데이터베이스 마이그레이션

### 필요한 작업
1. Drizzle 마이그레이션 생성:
   ```bash
   npm run db:generate:pim
   ```

2. 기존 데이터 마이그레이션:
   ```sql
   -- 1. 새 컬럼 추가 (nullable)
   -- 2. 기존 데이터에 대해 masterId = id, version = 1, versionStatus = 'active' 설정
   UPDATE product_masters
   SET master_id = id,
       version = 1,
       version_status = 'active',
       parent_version_id = NULL,
       draft_owner_id = NULL
   WHERE master_id IS NULL;
   
   -- 3. NOT NULL 제약조건 추가
   -- 4. 인덱스 및 유니크 제약조건 추가
   ```

3. 매핑 테이블에 기존 관계 복사:
   ```sql
   -- 기존 옵션 그룹 관계를 매핑 테이블로 복사
   INSERT INTO product_master_option_groups (id, master_id, option_group_id, version, created_at)
   SELECT gen_random_uuid(), og.master_id, og.id, 1, NOW()
   FROM product_option_groups og
   WHERE og.master_id IS NOT NULL;
   
   -- 기존 품목 관계를 매핑 테이블로 복사
   INSERT INTO product_master_variants (id, master_id, variant_id, version, created_at)
   SELECT gen_random_uuid(), v.master_id, v.id, 1, NOW()
   FROM product_variants v
   WHERE v.master_id IS NOT NULL;
   
   -- 기존 가격정책 관계를 매핑 테이블로 복사
   INSERT INTO product_master_pricing_rules (id, master_id, pricing_rule_id, version, created_at)
   SELECT gen_random_uuid(), pr.master_id, pr.id, 1, NOW()
   FROM pricing_rules pr
   WHERE pr.master_id IS NOT NULL;
   ```

## 주요 구현 파일

### 신규 생성
- `apps/pim/src/core/products/services/product-versions.service.ts` (461 lines)
- `apps/pim/src/core/products/controllers/product-versions.controller.ts` (220 lines)
- `apps/pim/src/core/products/dto/versions/create-draft-version.dto.ts`
- `apps/pim/src/core/products/dto/versions/publish-version.dto.ts`
- `apps/pim/src/core/products/dto/versions/version-tree-response.dto.ts`
- `apps/pim/src/core/products/dto/versions/version-diff.dto.ts`
- `apps/pim/src/core/products/dto/versions/index.ts`

### 수정
- `apps/pim/src/schema.ts`
  - productMasters 테이블에 버전 필드 추가
  - 3개 매핑 테이블 생성
  - FK 제약조건 변경
- `apps/pim/src/types.ts`
  - 버전 관리 타입 추가
- `apps/pim/src/core/products/services/product-masters.service.ts`
  - 버전 필드 설정
  - ProductVersionsService 의존성 주입
- `apps/pim/src/core/products/controllers/product-masters.controller.ts`
  - 버전 필터링 쿼리 파라미터 추가
- `apps/pim/src/core/products/products.module.ts`
  - ProductVersionsService 및 Controller 등록
- `apps/pim/src/core/channels/channel-products.service.ts`
  - Active 버전만 조회하도록 JOIN 조건 변경

## 테스트 권장사항

### 단위 테스트
- `product-versions.service.spec.ts`:
  - 버전 생성 테스트
  - Publish 로직 테스트
  - 버전 비교 테스트
  - 매핑 복사 테스트
  - 권한 확인 테스트

### E2E 테스트
- `product-versions.e2e-spec.ts`:
  1. 상품 생성 (v1 draft)
  2. v1 publish (active)
  3. v2 draft 생성 (v1 복사)
  4. v2 수정
  5. v2 publish (active) → v1 자동 inactive
  6. v1으로 되돌리기 (v3 draft 생성 → publish)
  7. 버전 트리 조회 검증
  8. 버전 비교 검증
  9. 채널 연동 확인 (active 버전만 표시)

## 향후 개선 사항

### 1. 감사 로그
- 버전 생성/수정/publish 이력을 `productAuditLog`에 자동 기록
- 누가, 언제, 어떤 변경을 했는지 추적

### 2. 이벤트 발행
- 버전 생성/publish 시 Kafka 이벤트 발행
- `ProductVersionCreated`, `ProductVersionPublished` 이벤트 정의
- 외부 시스템 알림

### 3. Draft 자동 정리
- 일정 기간 동안 수정되지 않은 draft 버전 자동 삭제
- 또는 inactive로 변경

### 4. 버전 복원 UI
- 관리자 대시보드에서 버전 트리 시각화
- 버전 간 diff 표시
- 클릭으로 버전 전환

### 5. 매핑 테이블 완전 전환
- 기존 FK 참조를 점진적으로 매핑 테이블로 전환
- 레거시 코드 제거

## 주의사항

### 1. 데이터베이스 마이그레이션
- **중요**: 프로덕션 환경에 배포하기 전에 반드시 마이그레이션 스크립트를 테스트 환경에서 검증해야 합니다.
- 기존 데이터가 있는 경우, 데이터 손실 없이 마이그레이션되는지 확인 필요

### 2. 성능 고려사항
- 버전이 많아지면 쿼리 성능에 영향을 줄 수 있습니다
- 인덱스가 제대로 설정되어 있는지 확인
- 필요시 오래된 inactive 버전 아카이빙 고려

### 3. 외부 시스템 연동
- WMS, 주문 시스템 등이 masterId를 올바르게 참조하는지 확인
- API 문서 업데이트 필요

## 결론

PIM 판매상품 버전 관리 기능이 성공적으로 구현되었습니다. 

**주요 성과:**
- ✅ 완전한 버전 관리 시스템 (draft → publish 워크플로우)
- ✅ 버전 간 데이터 재사용을 위한 매핑 테이블
- ✅ 트리 구조 버전 관리
- ✅ RESTful API 제공
- ✅ 외부 시스템 호환성 유지
- ✅ 하위 호환성 보장

이제 관리자는 상품 정보를 수정할 때 draft 버전을 만들어 안전하게 작업하고, 준비가 되면 publish하여 고객에게 보이도록 할 수 있습니다. 또한 언제든지 이전 버전으로 되돌릴 수 있어 운영의 유연성이 크게 향상되었습니다.

