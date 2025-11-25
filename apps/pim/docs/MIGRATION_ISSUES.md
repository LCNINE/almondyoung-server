# PIM 버전 관리 마이그레이션 이슈 보고서

**작성일:** 2025-11-24  
**대상:** PIM 마이크로서비스 `apps/pim/src/core`  
**목적:** 판매상품 버전 관리 도입 후 불완전한 마이그레이션 문제 파악 및 해결 방안 제시

---

## 📋 목차

1. [개요](#개요)
2. [아키텍처 변경 사항](#아키텍처-변경-사항)
3. [발견된 이슈](#발견된-이슈)
4. [영향 범위](#영향-범위)
5. [수정 우선순위](#수정-우선순위)
6. [상세 이슈 분석](#상세-이슈-분석)
7. [권장 수정 사항](#권장-수정-사항)

---

## 개요

### 배경
PIM에서 판매상품에 버전 관리 기능이 요구사항으로 추가되면서, 기존 아키텍처를 다음과 같이 변경:

- **변경 전:** `product_masters` 테이블이 판매상품의 모든 정보 포함
- **변경 후:** 
  - `product_masters`: 버전들을 묶는 메타데이터만 포함
  - `product_master_versions`: 실제 판매상품 정보 포함 (이름, 설명, 가격 등)

### 문제점
버전 관리 개념은 관리자만 필요하고 일반 사용자는 알 필요 없기 때문에, active 상태인 버전과 자동으로 JOIN하여 응답하도록 설계되었으나, **마이그레이션이 불완전하여 여러 곳에서 Master ID와 Version ID가 혼용**되고 있음.

---

## 아키텍처 변경 사항

### 데이터베이스 스키마

```sql
-- 변경 전
CREATE TABLE product_masters (
  id UUID PRIMARY KEY,
  name VARCHAR(255),
  description TEXT,
  brand VARCHAR(100),
  -- ... 모든 상품 정보
);

-- 변경 후
CREATE TABLE product_masters (
  id UUID PRIMARY KEY,
  -- 메타데이터만 (생성자, 삭제 정보 등)
  created_at TIMESTAMP,
  created_by UUID,
  deleted_at TIMESTAMP,
  deleted_by UUID
);

CREATE TABLE product_master_versions (
  id UUID PRIMARY KEY,
  master_id UUID REFERENCES product_masters(id),
  version INTEGER,
  version_status VARCHAR(20), -- 'draft' | 'inactive' | 'active'
  parent_version_id UUID,
  
  -- 실제 상품 정보
  name VARCHAR(255),
  description TEXT,
  brand VARCHAR(100),
  -- ... 모든 상품 필드
  
  UNIQUE (master_id, version),
  UNIQUE (master_id) WHERE version_status = 'active'
);
```

### 개념적 관계

```
ProductMaster (메타데이터)
  ├── Version 1 (draft)
  ├── Version 2 (active)   ← 일반 사용자에게 보이는 버전
  └── Version 3 (inactive)
```

---

## 발견된 이슈

### 🔴 Critical - 즉시 수정 필요

#### 1. Categories Service의 Master ID / Version ID 혼동

**파일:** `apps/pim/src/core/categories/categories.service.ts`  
**위치:** Line 668-815

**문제:**
```typescript
// ❌ 잘못된 구현
const existingProducts = await txn
  .select({ id: pimSchema.productMasterVersions.id })
  .from(pimSchema.productMasterVersions)
  .where(
    and(
      inArray(pimSchema.productMasterVersions.id, productIds),  // Version ID로 검색
      eq(pimSchema.productMasterVersions.versionStatus, 'active')
    )
  );

await txn
  .delete(pimSchema.productMasterCategories)
  .where(inArray(pimSchema.productMasterCategories.masterId, productIds));  // Version ID를 Master ID로 사용!
```

**영향:**
- 카테고리 연결이 완전히 깨짐
- Foreign Key 제약 조건 위반 가능
- 버전 변경 시 카테고리 매핑 손실

**관련 메서드:**
- `moveProductsToCategory()` - Line 668
- `addProductsToCategory()` - Line 735

---

### ⚠️ High - 높은 우선순위

#### 2. API 파라미터 명칭의 혼란

**파일:** `apps/pim/src/core/products/controllers/product-masters.controller.ts`

**문제:**
```typescript
// ❌ 혼란스러운 명칭
@Put(':id')
@ApiParam({ name: 'id', description: '제품 마스터 ID (버전 ID)' })
async updateMaster(@Param('id') id: string, @Body() updateData) {
  // 실제로는 version ID를 기대
}
```

**서비스 코드:**
```typescript
// Line 819
// 0. 기존 마스터 조회 (masterId는 versionId임)
const existingMaster = await this.getVersionById(masterId, txClient);
```

**영향:**
- API 문서 오류
- 프론트엔드 개발자 혼란
- 잘못된 ID 전달 가능성

#### 3. 이벤트 페이로드의 `productId` 모호성

**파일:** `packages/event-contracts/streams/product.stream.ts`

**문제:**
```typescript
// ❌ 모호한 명칭
export interface ProductVariantCreatedPayload {
  productId: string;  // 실제로는 version ID
  productName: string;
  variantId: string;
  // masterId 없음!
  // version 번호 없음!
}
```

**발행 코드:**
```typescript
// apps/pim/src/core/products/services/product-masters.service.ts:76
await this.productPublisher.publishEvent({
  eventType: 'ProductVariantCreated',
  aggregateId: version.id,
  payload: {
    productId: version.id,  // ❌ version.id는 버전 ID
    productName: version.name,
    variantId: variant.id,
  },
});
```

**영향:**
- WMS가 마스터 ID를 알 수 없음
- 다른 버전과의 관계 파악 불가
- 이벤트 간 일관성 부족

---

### ⚠️ Medium - 중간 우선순위

#### 4. 상품 조회 API의 제한된 유연성

**파일:** `apps/pim/src/core/products/controllers/product-masters.controller.ts`

**문제:**
```typescript
// 현재: Master ID만 가능
@Get(':id')
async getMasterDetail(@Param('id') id: string) {
  // Master ID로만 조회 가능, Version ID는 불가
}
```

**영향:**
- 특정 버전 조회 불가 (active만 가능)
- 버전 비교 UI 구현 어려움
- API 유연성 부족

#### 5. Service 메서드 파라미터 이름 불일치

**파일:** `apps/pim/src/core/products/services/product-masters.service.ts`

**문제:**
```typescript
// 파라미터 이름은 masterId인데 실제로는 versionId
async updateMaster(
  masterId: string,  // ❌ 실제로는 versionId
  data: UpdateProductMasterVersion,
) {
  const existingMaster = await this.getVersionById(masterId, txClient);
}
```

---

### ✅ 올바르게 구현된 부분

다음 서비스들은 버전 관리 개념을 올바르게 적용:

1. **Pricing Service** (`pricing.service.ts`)
   - Master ID 사용
   - Active 버전 자동 조회
   - 올바른 JOIN

2. **Channel Products Service** (`channel-products.service.ts`)
   - Master ID 참조
   - Active 버전과 JOIN

3. **Product Search Service** (`product-search.service.ts`)
   - Active 버전 필터 적용

4. **Product Variants Service** (`product-variants.service.ts`)
   - Version 파라미터 명시적 처리

---

## 영향 범위

### 영향받는 컴포넌트

| 컴포넌트 | 상태 | 문제 유형 | 우선순위 |
|---------|------|----------|---------|
| Categories Service | 🔴 오류 | masterId/versionId 혼동 | Critical |
| Product Masters Controller | ⚠️ 혼란 | API 파라미터 명칭 | High |
| Product Masters Service | ⚠️ 혼란 | 파라미터 명칭 | High |
| Event Contracts | ⚠️ 혼란 | productId 모호성 | High |
| Pricing Service | ✅ 정상 | - | - |
| Channel Products Service | ✅ 정상 | - | - |
| Product Search Service | ✅ 정상 | - | - |
| Product Variants Service | ✅ 정상 | - | - |
| Tags Service | ✅ 정상 | - | - |
| Banners Service | ⚠️ 확인 필요 | linkedProductMasterIds 검증 필요 | Medium |

### 하위 시스템 영향

- **WMS:** 이벤트 페이로드 변경 필요
- **Frontend:** API 파라미터 변경 필요
- **Database:** 데이터 정합성 검증 필요

---

## 수정 우선순위

### Phase 1: 긴급 수정 (1-2일)

1. **Categories Service 수정** (Critical)
   - `moveProductsToCategory()` 수정
   - `addProductsToCategory()` 수정
   - 데이터베이스 정합성 검증 쿼리 실행

### Phase 2: API 재설계 (3-5일)

2. **API 엔드포인트 재설계** (High)
   - 명확한 라우팅 구조 도입
   - 파라미터 명칭 통일
   - Swagger 문서 업데이트

3. **Service 메서드 리팩토링** (High)
   - 파라미터 이름 수정
   - 메서드 명칭 명확화

### Phase 3: 이벤트 재설계 (5-7일)

4. **이벤트 페이로드 재설계** (High, Breaking Change)
   - `productId` → `versionId`
   - `masterId`, `version` 필드 추가
   - WMS 이벤트 핸들러 수정
   - 마이그레이션 전략 수립

### Phase 4: 개선 사항 (7-10일)

5. **API 유연성 개선** (Medium)
   - Master ID와 Version ID 모두 지원
   - 버전 조회 API 추가

---

## 상세 이슈 분석

### Issue #1: Categories Service Master ID 혼동

#### 현재 코드
```typescript
// apps/pim/src/core/categories/categories.service.ts:690-723
async moveProductsToCategory(
  productIds: string[],
  categoryId: string,
  tx?: DbTransaction,
): Promise<void> {
  const executeMove = async (txn: any) => {
    // ❌ 문제 1: Version ID로 검색
    const existingProducts = await txn
      .select({ id: pimSchema.productMasterVersions.id })
      .from(pimSchema.productMasterVersions)
      .where(
        and(
          inArray(pimSchema.productMasterVersions.id, productIds),
          eq(pimSchema.productMasterVersions.versionStatus, 'active')
        )
      );

    // ❌ 문제 2: Version ID를 Master ID로 사용
    await txn
      .delete(pimSchema.productMasterCategories)
      .where(inArray(pimSchema.productMasterCategories.masterId, productIds));

    // ❌ 문제 3: Version ID를 Master ID로 저장
    const newRelations = productIds.map((productId) => ({
      masterId: productId,  // 잘못된 ID!
      categoryId: categoryId,
      isPrimary: true,
      createdAt: new Date(),
    }));
  };
}
```

#### 수정 코드
```typescript
async moveProductsToCategory(
  versionIds: string[],  // ✅ 파라미터 이름 명확화
  categoryId: string,
  tx?: DbTransaction,
): Promise<void> {
  const executeMove = async (txn: any) => {
    // ✅ 수정 1: Version ID로 Master ID와 Version 조회
    const productVersions = await txn
      .select({
        versionId: pimSchema.productMasterVersions.id,
        masterId: pimSchema.productMasterVersions.masterId,
        version: pimSchema.productMasterVersions.version
      })
      .from(pimSchema.productMasterVersions)
      .where(
        and(
          inArray(pimSchema.productMasterVersions.id, versionIds),
          eq(pimSchema.productMasterVersions.versionStatus, 'active')
        )
      );

    if (productVersions.length === 0) {
      throw new Error('No active versions found');
    }

    const masterIds = productVersions.map(p => p.masterId);
    const versions = productVersions.map(p => p.version);

    // ✅ 수정 2: Master ID와 Version으로 삭제
    await txn
      .delete(pimSchema.productMasterCategories)
      .where(
        and(
          inArray(pimSchema.productMasterCategories.masterId, masterIds),
          inArray(pimSchema.productMasterCategories.version, versions)
        )
      );

    // ✅ 수정 3: 올바른 Master ID와 Version 사용
    const newRelations = productVersions.map((pv) => ({
      masterId: pv.masterId,  // ✅ 올바른 Master ID
      version: pv.version,    // ✅ 버전 번호
      categoryId: categoryId,
      isPrimary: true,
      createdAt: new Date(),
    }));

    await txn.insert(pimSchema.productMasterCategories).values(newRelations);
  };
  
  if (tx) {
    await executeMove(tx);
  } else {
    await this.db.db.transaction(executeMove);
  }
}
```

#### 데이터 검증 쿼리
```sql
-- 잘못된 데이터 확인
SELECT pmc.*, pm.id as actual_master_id
FROM product_master_categories pmc
LEFT JOIN product_masters pm ON pmc.master_id = pm.id
WHERE pm.id IS NULL;

-- 이 쿼리 결과가 있다면 데이터 정합성이 깨진 것
```

---

### Issue #2: API 파라미터 명칭 혼란

#### 현재 API 구조
```
POST   /masters                    # 새 마스터 + 버전 생성
GET    /masters                    # 마스터 목록 (active 버전)
GET    /masters/:id                # 마스터 상세 (Master ID, active 버전)
PUT    /masters/:id                # 마스터 수정 (❌ Version ID 필요!)
DELETE /masters/:id                # 마스터 삭제 (Version ID?)
```

**문제:** `PUT /masters/:id`는 Version ID를 기대하지만 라우팅상 Master ID를 받는 것처럼 보임

#### 권장 API 구조
```
# Master 관련 (일반 사용자용 - active 버전만)
POST   /masters                              # 새 마스터 + 첫 버전 생성
GET    /masters                              # 마스터 목록 (active 버전)
GET    /masters/:masterId                    # 마스터 상세 (active 버전)
DELETE /masters/:masterId                    # 마스터 소프트 삭제

# Version 관련 (관리자용 - 모든 버전 관리)
GET    /masters/:masterId/versions           # 버전 목록
GET    /masters/:masterId/versions/active    # active 버전 조회
GET    /masters/:masterId/versions/:version  # 특정 버전 조회
POST   /masters/:masterId/versions           # 새 draft 버전 생성
PUT    /masters/:masterId/versions/:version  # draft 버전 수정
PATCH  /masters/:masterId/versions/:version/publish  # 버전 publish
DELETE /masters/:masterId/versions/:version  # draft 버전 삭제
```

**장점:**
- ✅ Master ID와 Version 명확히 구분
- ✅ RESTful 원칙 준수
- ✅ 일반 사용자와 관리자 API 분리
- ✅ Swagger 문서 자동 생성 정확

---

### Issue #3: 이벤트 페이로드 productId

#### 현재 이벤트
```typescript
// ProductVariantCreated
{
  productId: "version-id-here",  // ❌ 버전 ID인데 이름이 모호
  productName: "상품명",
  variantId: "variant-id",
  // masterId 없음!
  // version 번호 없음!
}

// ProductMasterActiveVersionChanged (비교용 - 올바른 예)
{
  masterId: "master-id",          // ✅ 명확
  productId: "version-id",        // ✅ 명확 (버전 ID임을 알 수 있음)
  version: 2,                     // ✅ 버전 번호
  previousActiveVersionId: "...",
}
```

#### 권장 이벤트 구조
```typescript
export interface ProductVariantCreatedPayload {
  masterId: string;        // ✅ 추가: 마스터 메타데이터 ID
  versionId: string;       // ✅ 이름 변경: 기존 productId
  version: number;         // ✅ 추가: 버전 번호
  productName: string;
  variantId: string;
  variantName: string | null;
  isDefault: boolean;
  status: 'active' | 'draft' | 'archived';
  inventoryManagement: boolean;
  preStockSellable?: boolean;
  alwaysSellableZeroStock?: boolean;
  optionCombination?: Array<{ name: string; value: string }>;
  createdAt: string;
}
```

#### 마이그레이션 전략

**옵션 1: 점진적 마이그레이션 (하위 호환성 유지)**
```typescript
export interface ProductVariantCreatedPayload {
  /** @deprecated Use versionId instead */
  productId: string;
  versionId?: string;      // 새 필드 (productId와 동일 값)
  masterId?: string;       // 새 필드
  version?: number;        // 새 필드
  // ...
}
```

**옵션 2: Breaking Change (권장)**
```typescript
// v2 이벤트 생성
export interface ProductVariantCreatedPayloadV2 {
  masterId: string;
  versionId: string;
  version: number;
  // ...
}

// 발행 시
eventType: 'ProductVariantCreated.v2'
```

---

## 권장 수정 사항

### 1. 명칭 규칙 확립

```typescript
// ✅ 올바른 명칭 사용
masterId: string;    // productMasters.id
versionId: string;   // productMasterVersions.id
version: number;     // productMasterVersions.version

// ❌ 피해야 할 패턴
productId: string;                    // 모호함
masterId가 실제로는 versionId          // 혼란
"마스터 ID (버전 ID)"                 // 혼란스러운 설명
```

### 2. 공통 유틸리티 함수

```typescript
// apps/pim/src/core/products/utils/id-resolver.ts
export class ProductIdResolver {
  /**
   * ID가 Master ID인지 Version ID인지 자동 감지
   */
  static async resolveId(
    id: string,
    db: DbTransaction
  ): Promise<{ masterId: string; versionId: string; version: number }> {
    // 1. Version ID로 시도
    const byVersionId = await db
      .select({
        masterId: productMasterVersions.masterId,
        versionId: productMasterVersions.id,
        version: productMasterVersions.version
      })
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, id))
      .limit(1);
    
    if (byVersionId.length > 0) {
      return byVersionId[0];
    }
    
    // 2. Master ID로 시도 (active 버전)
    const byMasterId = await db
      .select({
        masterId: productMasterVersions.masterId,
        versionId: productMasterVersions.id,
        version: productMasterVersions.version
      })
      .from(productMasterVersions)
      .where(
        and(
          eq(productMasterVersions.masterId, id),
          eq(productMasterVersions.versionStatus, 'active')
        )
      )
      .limit(1);
    
    if (byMasterId.length > 0) {
      return byMasterId[0];
    }
    
    throw new NotFoundException(`Product not found: ${id}`);
  }
}
```

### 3. 타입 안전성 강화

```typescript
// apps/pim/src/types/ids.ts
export type MasterId = string & { __brand: 'MasterId' };
export type VersionId = string & { __brand: 'VersionId' };
export type VariantId = string & { __brand: 'VariantId' };

// 사용 예
async getMasterById(masterId: MasterId): Promise<ProductMaster> {
  // 타입 시스템이 잘못된 ID 사용 방지
}
```

---

## 체크리스트

### Phase 1 수정 완료 체크리스트
- [ ] Categories Service `moveProductsToCategory()` 수정
- [ ] Categories Service `addProductsToCategory()` 수정
- [ ] 데이터베이스 정합성 검증 쿼리 실행
- [ ] 잘못된 데이터 수정 스크립트 작성 및 실행
- [ ] 단위 테스트 작성 및 통과
- [ ] 통합 테스트 작성 및 통과

### Phase 2 수정 완료 체크리스트
- [ ] API 라우팅 재설계 문서 작성
- [ ] Product Masters Controller 라우팅 변경
- [ ] Product Versions Controller 분리
- [ ] Service 메서드 파라미터 이름 수정
- [ ] Swagger 문서 검증
- [ ] API 테스트 작성
- [ ] 프론트엔드 API 호출 코드 업데이트

### Phase 3 수정 완료 체크리스트
- [ ] 이벤트 페이로드 재설계 문서 작성
- [ ] Event Contracts 업데이트
- [ ] WMS 이벤트 핸들러 수정
- [ ] 이벤트 발행 코드 수정
- [ ] 이벤트 버저닝 전략 수립
- [ ] 마이그레이션 스크립트 작성
- [ ] 이벤트 테스트 작성

### Phase 4 수정 완료 체크리스트
- [ ] ID 자동 감지 유틸리티 작성
- [ ] API 유연성 개선
- [ ] 타입 안전성 강화
- [ ] 공통 헬퍼 함수 작성
- [ ] 문서 업데이트

---

## 참고 자료

- [Master-Version 설계 철학](./MASTER_VERSION_DESIGN.md)
- [API 설계 가이드](./API_DESIGN_GUIDE.md)
- 데이터베이스 스키마: `apps/pim/src/schema.ts`
- 이벤트 컨트랙트: `packages/event-contracts/streams/product.stream.ts`

---

**최종 업데이트:** 2025-11-24  
**작성자:** AI Development Assistant  
**검토 필요:** CTO, Backend Team Lead

