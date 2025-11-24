# Master-Version 설계 철학 및 원칙

**작성일:** 2025-11-24  
**대상:** PIM 개발팀  
**목적:** 판매상품의 Master-Version 구조에 대한 설계 철학, 원칙, 사용 패턴 정의

---

## 📋 목차

1. [개요](#개요)
2. [설계 철학](#설계-철학)
3. [핵심 개념](#핵심-개념)
4. [아키텍처 패턴](#아키텍처-패턴)
5. [명칭 규칙](#명칭-규칙)
6. [사용 패턴](#사용-패턴)
7. [모범 사례](#모범-사례)
8. [안티 패턴](#안티-패턴)

---

## 개요

### 배경
PIM(Product Information Management) 시스템에서 판매상품 정보는 시간에 따라 변경됩니다. 가격, 설명, 이미지 등이 수정되지만, 과거 버전을 유지하고 필요시 롤백할 수 있어야 합니다.

### 목표
- ✅ 상품 정보 변경 이력 추적
- ✅ 버전 간 비교 가능
- ✅ 이전 버전으로 롤백 가능
- ✅ 일반 사용자는 버전 개념 인식 불필요 (active 버전만 표시)
- ✅ 관리자는 모든 버전 관리 가능

---

## 설계 철학

### 1. 관심사의 분리 (Separation of Concerns)

**Master (메타데이터)**
- 역할: 버전들을 묶는 컨테이너
- 책임: 생성/삭제 정보만 관리
- 수명: 상품이 완전히 삭제될 때까지 유지

**Version (실제 데이터)**
- 역할: 특정 시점의 상품 정보
- 책임: 모든 상품 속성 관리
- 수명: Draft 상태에서만 수정 가능, Active/Inactive는 읽기 전용

```
┌─────────────────────────────────────────┐
│ ProductMaster (메타데이터)              │
│  - id: UUID                             │
│  - createdAt                            │
│  - createdBy                            │
│  - deletedAt                            │
│  - deletedBy                            │
└─────────────────────────────────────────┘
                   │
                   │ 1:N
                   ▼
┌─────────────────────────────────────────┐
│ ProductMasterVersion (실제 데이터)      │
│  - id: UUID                             │
│  - masterId (FK)                        │
│  - version: Integer                     │
│  - versionStatus: 'draft'|'active'|...  │
│  - name, description, price, ...        │
└─────────────────────────────────────────┘
```

### 2. 단일 Active 버전 (Single Active Version)

**원칙:** 하나의 Master는 최대 1개의 Active 버전만 가질 수 있습니다.

**이유:**
- 일반 사용자에게 혼란 방지
- 채널별 동기화 간소화
- 재고 관리 일관성 보장

**구현:**
```sql
-- 데이터베이스 제약 조건
UNIQUE (master_id) WHERE version_status = 'active'
```

### 3. 투명성 원칙 (Transparency Principle)

**원칙:** 일반 사용자는 버전의 존재를 인식할 필요가 없습니다.

**구현 방법:**
- API는 기본적으로 Active 버전만 반환
- 버전 관리 기능은 별도 관리자 API로 분리
- 이벤트는 Master ID와 Version ID를 함께 전달

```typescript
// ✅ 일반 사용자 API
GET /masters/:masterId
→ Active 버전 자동 반환

// ✅ 관리자 API
GET /masters/:masterId/versions
→ 모든 버전 목록 반환
```

### 4. 불변성 원칙 (Immutability Principle)

**원칙:** Active/Inactive 버전은 수정할 수 없습니다.

**이유:**
- 이력 무결성 보장
- 감사 추적(audit trail) 신뢰성
- 롤백 정확성

**변경 방법:**
1. 기존 버전을 부모로 하는 새 Draft 버전 생성
2. Draft 버전 수정
3. Draft를 Active로 Publish (기존 Active는 자동으로 Inactive)

```
Version 1 (active)
    │
    │ Create Draft
    ▼
Version 2 (draft) ──┐
                    │ Modify
                    ▼
                 Version 2 (draft) ──┐
                                     │ Publish
                                     ▼
Version 1 (inactive)   Version 2 (active)
```

---

## 핵심 개념

### Version Status

```typescript
type VersionStatus = 'draft' | 'active' | 'inactive';
```

| Status | 설명 | 수정 가능 | 표시 대상 |
|--------|------|-----------|----------|
| `draft` | 작성 중인 버전 | ✅ Yes | 관리자 (작성자만) |
| `active` | 현재 활성 버전 | ❌ No | 일반 사용자 + 관리자 |
| `inactive` | 과거 버전 | ❌ No | 관리자 (이력 조회) |

### Version Tree

버전들은 트리 구조를 형성합니다:

```
v1 (inactive)
├─ v2 (active)
│  └─ v3 (draft)
└─ v4 (inactive)   ← 롤백 후 비활성화
```

**parentVersionId:** 이 버전이 어떤 버전을 기반으로 생성되었는지 추적

**용도:**
- 변경 이력 시각화
- 버전 간 diff 계산
- 브랜치 관리 (필요시)

### Cascade Behavior

Master가 삭제되면 모든 Version도 삭제됩니다:

```sql
FOREIGN KEY (master_id) REFERENCES product_masters(id) ON DELETE CASCADE
```

**이유:** Master는 Version의 컨테이너일 뿐이므로, Master 없이 Version만 존재할 수 없음

---

## 아키텍처 패턴

### 1. Mapping Tables 패턴

Version과 다른 엔티티의 관계는 Mapping Table을 통해 관리합니다.

```
┌─────────────────┐
│ ProductMaster   │
├─────────────────┤
│ id              │
└─────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────────────────┐
│ ProductMasterVersion            │
├─────────────────────────────────┤
│ id                              │
│ masterId                        │
│ version                         │
└─────────────────────────────────┘
         │                     │
         │ N:M                 │ N:M
         ▼                     ▼
┌─────────────────────┐  ┌──────────────────┐
│ ProductMasterVariants│  │ProductMasterCategories│
├─────────────────────┤  ├──────────────────┤
│ masterId            │  │ masterId         │
│ version             │  │ version          │
│ variantId           │  │ categoryId       │
└─────────────────────┘  └──────────────────┘
```

**장점:**
- ✅ Version별로 다른 관계 설정 가능
- ✅ Version 변경 시 관계 독립적 관리
- ✅ 이력 추적 용이

**예시: Variants 매핑**
```typescript
// Version 2는 3개의 variant
productMasterVariants:
  { masterId: 'abc', version: 2, variantId: 'v1' }
  { masterId: 'abc', version: 2, variantId: 'v2' }
  { masterId: 'abc', version: 2, variantId: 'v3' }

// Version 3는 2개의 variant (옵션 변경)
productMasterVariants:
  { masterId: 'abc', version: 3, variantId: 'v1' }
  { masterId: 'abc', version: 3, variantId: 'v4' }
```

### 2. Version Resolution 패턴

코드에서 Version을 해결하는 표준 패턴:

```typescript
async function resolveVersion(
  masterId: string,
  version?: number,
  tx?: DbTransaction
): Promise<ProductMasterVersion> {
  // version이 지정되지 않으면 active 버전 사용
  let actualVersion = version;
  
  if (actualVersion === undefined) {
    const [activeVersion] = await tx
      .select({ version: productMasterVersions.version })
      .from(productMasterVersions)
      .where(
        and(
          eq(productMasterVersions.masterId, masterId),
          eq(productMasterVersions.versionStatus, 'active')
        )
      )
      .limit(1);
    
    if (!activeVersion) {
      throw new NotFoundException(`No active version for master ${masterId}`);
    }
    
    actualVersion = activeVersion.version;
  }
  
  // actualVersion으로 데이터 조회
  // ...
}
```

**사용 예:**
```typescript
// Active 버전
await getMasterDetail(masterId);

// 특정 버전
await getMasterDetail(masterId, 3);
```

### 3. Transaction Propagation 패턴

Version 변경은 여러 테이블에 영향을 주므로 트랜잭션이 필수입니다:

```typescript
async publishVersion(versionId: string, tx?: DbTransaction) {
  return this.inTx(async (trx) => {
    // 1. 기존 active 버전을 inactive로
    await trx.update(versions)
      .set({ versionStatus: 'inactive' })
      .where(and(
        eq(versions.masterId, masterId),
        eq(versions.versionStatus, 'active')
      ));
    
    // 2. 새 버전을 active로
    await trx.update(versions)
      .set({ versionStatus: 'active' })
      .where(eq(versions.id, versionId));
    
    // 3. 이벤트 발행
    await this.publishEvent(trx);
  }, tx);
}

private async inTx<T>(
  fn: (tx: DbTransaction) => Promise<T>,
  tx?: DbTransaction
): Promise<T> {
  return tx ? fn(tx) : this.db.transaction(fn);
}
```

---

## 명칭 규칙

### 용어 정의

| 용어 | 의미 | 데이터베이스 | 타입 |
|------|------|--------------|------|
| **Master** | 버전들의 컨테이너 | `product_masters` 테이블 | 메타데이터 |
| **Version** | 특정 시점의 상품 정보 | `product_master_versions` 테이블 | 실제 데이터 |
| **Master ID** | Master의 고유 식별자 | `product_masters.id` | `UUID` |
| **Version ID** | Version의 고유 식별자 | `product_master_versions.id` | `UUID` |
| **Version Number** | Master 내 버전 순번 | `product_master_versions.version` | `Integer` |

### 코드 네이밍 컨벤션

```typescript
// ✅ 올바른 네이밍
masterId: string;              // product_masters.id
versionId: string;             // product_master_versions.id
version: number;               // product_master_versions.version
versionStatus: VersionStatus;  // 'draft' | 'active' | 'inactive'

// ❌ 피해야 할 네이밍
productId: string;             // 너무 모호함
id: string;                    // 맥락 없이는 의미 불명확
masterOrVersionId: string;     // 둘 중 하나면 명확히 구분
```

### API 라우팅 네이밍

```typescript
// ✅ 명확한 라우팅
GET  /masters/:masterId
GET  /masters/:masterId/versions
GET  /masters/:masterId/versions/:version
POST /masters/:masterId/versions

// ❌ 모호한 라우팅
GET  /masters/:id              // masterId인지 versionId인지 불명확
PUT  /masters/:id              // 실제로는 versionId가 필요한데 혼란
GET  /products/:productId      // product가 무엇을 의미하는지 불명확
```

### 파라미터 네이밍

```typescript
// ✅ 함수 파라미터
async getMasterDetail(
  masterId: string,
  version?: number,
  tx?: DbTransaction
): Promise<MasterDetail>

async updateVersion(
  versionId: string,
  data: UpdateVersionDto,
  tx?: DbTransaction
): Promise<ProductMasterVersion>

// ❌ 혼란스러운 파라미터
async updateMaster(
  masterId: string,  // 실제로는 versionId를 기대
  // ...
)
```

---

## 사용 패턴

### Pattern 1: 새 상품 생성

```typescript
async createProduct(data: CreateProductDto): Promise<ProductMasterVersion> {
  return this.db.transaction(async (tx) => {
    // 1. Master 생성
    const [master] = await tx
      .insert(productMasters)
      .values({ createdBy: userId })
      .returning();
    
    // 2. 첫 번째 버전 생성 (draft)
    const [version] = await tx
      .insert(productMasterVersions)
      .values({
        masterId: master.id,
        version: 1,
        versionStatus: 'draft',
        name: data.name,
        description: data.description,
        // ...
      })
      .returning();
    
    // 3. 기본 variant 생성
    const [variant] = await tx
      .insert(productVariants)
      .values({ isDefault: true })
      .returning();
    
    // 4. Variant 매핑
    await tx
      .insert(productMasterVariants)
      .values({
        masterId: master.id,
        version: 1,
        variantId: variant.id,
      });
    
    return version;
  });
}
```

### Pattern 2: 버전 수정 (Draft만 가능)

```typescript
async updateVersion(
  versionId: string,
  data: UpdateVersionDto
): Promise<ProductMasterVersion> {
  return this.db.transaction(async (tx) => {
    // 1. 현재 버전 조회 및 상태 확인
    const [currentVersion] = await tx
      .select()
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, versionId));
    
    if (!currentVersion) {
      throw new NotFoundException('Version not found');
    }
    
    if (currentVersion.versionStatus !== 'draft') {
      throw new ForbiddenException('Only draft versions can be modified');
    }
    
    // 2. 버전 업데이트
    const [updated] = await tx
      .update(productMasterVersions)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(productMasterVersions.id, versionId))
      .returning();
    
    return updated;
  });
}
```

### Pattern 3: 새 Draft 버전 생성

```typescript
async createDraftVersion(
  parentVersionId: string,
  userId: string
): Promise<ProductMasterVersion> {
  return this.db.transaction(async (tx) => {
    // 1. 부모 버전 조회
    const [parentVersion] = await tx
      .select()
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, parentVersionId));
    
    if (!parentVersion) {
      throw new NotFoundException('Parent version not found');
    }
    
    // 2. 다음 버전 번호 계산
    const [maxVersion] = await tx
      .select({ max: sql<number>`MAX(version)` })
      .from(productMasterVersions)
      .where(eq(productMasterVersions.masterId, parentVersion.masterId));
    
    const nextVersion = (maxVersion?.max ?? 0) + 1;
    
    // 3. 새 Draft 버전 생성 (부모 데이터 복사)
    const [newVersion] = await tx
      .insert(productMasterVersions)
      .values({
        masterId: parentVersion.masterId,
        version: nextVersion,
        versionStatus: 'draft',
        parentVersionId: parentVersionId,
        draftOwnerId: userId,
        
        // 부모 데이터 복사
        name: parentVersion.name,
        description: parentVersion.description,
        // ... 모든 필드 복사
      })
      .returning();
    
    // 4. 매핑 테이블 복사 (variants, categories, etc.)
    await this.copyMappings(
      parentVersion.masterId,
      parentVersion.version,
      nextVersion,
      tx
    );
    
    return newVersion;
  });
}
```

### Pattern 4: 버전 Publish (Draft → Active)

```typescript
async publishVersion(
  versionId: string,
  targetStatus: 'active' | 'inactive'
): Promise<void> {
  return this.db.transaction(async (tx) => {
    // 1. 대상 버전 조회
    const [version] = await tx
      .select()
      .from(productMasterVersions)
      .where(eq(productMasterVersions.id, versionId));
    
    if (!version) {
      throw new NotFoundException('Version not found');
    }
    
    if (version.versionStatus !== 'draft') {
      throw new ForbiddenException('Only draft versions can be published');
    }
    
    // 2. Active로 전환하는 경우: 기존 active를 inactive로
    if (targetStatus === 'active') {
      const [previousActive] = await tx
        .update(productMasterVersions)
        .set({ versionStatus: 'inactive' })
        .where(
          and(
            eq(productMasterVersions.masterId, version.masterId),
            eq(productMasterVersions.versionStatus, 'active')
          )
        )
        .returning();
      
      // 3. 대상 버전을 active로
      await tx
        .update(productMasterVersions)
        .set({ versionStatus: 'active', draftOwnerId: null })
        .where(eq(productMasterVersions.id, versionId));
      
      // 4. 이벤트 발행
      await this.publishActiveVersionChangedEvent(
        version.masterId,
        version.id,
        previousActive?.id ?? null,
        tx
      );
    } else {
      // Inactive로 전환
      await tx
        .update(productMasterVersions)
        .set({ versionStatus: 'inactive', draftOwnerId: null })
        .where(eq(productMasterVersions.id, versionId));
    }
  });
}
```

### Pattern 5: 일반 사용자 상품 조회 (Active 버전만)

```typescript
async getProductForCustomer(
  masterId: string
): Promise<ProductResponse> {
  // Active 버전만 조회
  const [version] = await this.db
    .select()
    .from(productMasterVersions)
    .where(
      and(
        eq(productMasterVersions.masterId, masterId),
        eq(productMasterVersions.versionStatus, 'active'),
        isNull(productMasterVersions.deletedAt)
      )
    )
    .limit(1);
  
  if (!version) {
    throw new NotFoundException('Product not found');
  }
  
  // 버전 개념을 숨기고 반환
  return {
    id: version.masterId,  // Master ID를 상품 ID로 표시
    name: version.name,
    description: version.description,
    // ... version의 모든 필드
  };
}
```

### Pattern 6: 관리자 버전 목록 조회

```typescript
async getVersionHistory(
  masterId: string
): Promise<VersionTreeNode[]> {
  // 모든 버전 조회
  const versions = await this.db
    .select()
    .from(productMasterVersions)
    .where(eq(productMasterVersions.masterId, masterId))
    .orderBy(productMasterVersions.version);
  
  // 트리 구조 구성
  const versionMap = new Map<string, VersionTreeNode>();
  const rootNodes: VersionTreeNode[] = [];
  
  for (const version of versions) {
    const node = {
      id: version.id,
      version: version.version,
      versionStatus: version.versionStatus,
      parentVersionId: version.parentVersionId,
      children: [],
    };
    versionMap.set(version.id, node);
  }
  
  for (const node of versionMap.values()) {
    if (node.parentVersionId) {
      const parent = versionMap.get(node.parentVersionId);
      if (parent) {
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    } else {
      rootNodes.push(node);
    }
  }
  
  return rootNodes;
}
```

---

## 모범 사례

### 1. 항상 Active 버전 기본값 사용

```typescript
// ✅ Good: Active 버전이 기본값
async getMasterDetail(
  masterId: string,
  version?: number  // Optional: 특정 버전 지정 가능
): Promise<MasterDetail> {
  const actualVersion = version ?? await this.getActiveVersion(masterId);
  // ...
}

// ❌ Bad: 버전을 항상 명시해야 함
async getMasterDetail(
  masterId: string,
  version: number  // Required
): Promise<MasterDetail>
```

### 2. Master ID와 Version ID 명확히 구분

```typescript
// ✅ Good: 타입으로 구분
type MasterId = string & { __brand: 'MasterId' };
type VersionId = string & { __brand: 'VersionId' };

async updateVersion(versionId: VersionId, data: UpdateDto)
async getMaster(masterId: MasterId): Promise<Master>

// ✅ Good: 파라미터 이름으로 구분
async updateVersion(versionId: string, data: UpdateDto)
async getMaster(masterId: string): Promise<Master>

// ❌ Bad: 구분 불가능
async update(id: string, data: UpdateDto)
async get(id: string): Promise<Product>
```

### 3. Version Status 검증

```typescript
// ✅ Good: 상태 검증
async updateVersion(versionId: string, data: UpdateDto) {
  const version = await this.getVersion(versionId);
  
  if (version.versionStatus !== 'draft') {
    throw new ForbiddenException(
      'Only draft versions can be modified. ' +
      'Create a new draft to make changes.'
    );
  }
  
  // Update logic
}

// ❌ Bad: 검증 없음 (active 버전 수정 가능)
async updateVersion(versionId: string, data: UpdateDto) {
  await this.db.update(versions)
    .set(data)
    .where(eq(versions.id, versionId));
}
```

### 4. 트랜잭션 전파

```typescript
// ✅ Good: 트랜잭션 전파
async publishVersion(versionId: string, tx?: DbTransaction) {
  return this.inTx(async (trx) => {
    await this.updateStatus(versionId, 'active', trx);
    await this.notifyChannels(versionId, trx);
    await this.publishEvent(versionId, trx);
  }, tx);
}

// ❌ Bad: 트랜잭션 전파 안 됨
async publishVersion(versionId: string) {
  await this.updateStatus(versionId, 'active');
  await this.notifyChannels(versionId);
  await this.publishEvent(versionId);
}
```

### 5. 이벤트에 Master ID와 Version ID 모두 포함

```typescript
// ✅ Good: 완전한 정보
await this.eventPublisher.publish({
  eventType: 'ProductVariantCreated',
  aggregateId: version.masterId,  // Master ID
  payload: {
    masterId: version.masterId,    // ✅ Master ID
    versionId: version.id,          // ✅ Version ID
    version: version.version,       // ✅ Version Number
    variantId: variant.id,
    // ...
  },
});

// ❌ Bad: 불완전한 정보
await this.eventPublisher.publish({
  eventType: 'ProductVariantCreated',
  aggregateId: version.id,  // Version ID를 aggregate로 사용 (잘못됨)
  payload: {
    productId: version.id,  // ❌ 모호함
    variantId: variant.id,
    // masterId 없음!
  },
});
```

---

## 안티 패턴

### 1. Master ID와 Version ID 혼용

```typescript
// ❌ Anti-pattern
async updateMaster(
  masterId: string,  // 파라미터 이름은 masterId
  data: UpdateDto
) {
  // 실제로는 versionId로 사용
  const version = await this.getVersionById(masterId);  // 혼란!
}

// ✅ Correct
async updateVersion(
  versionId: string,  // 명확한 파라미터 이름
  data: UpdateDto
) {
  const version = await this.getVersionById(versionId);
}
```

### 2. Active 버전 하드코딩

```typescript
// ❌ Anti-pattern: Active 상태 하드코딩
const activeVersion = await db
  .select()
  .from(versions)
  .where(eq(versions.versionStatus, 'active'))  // 문자열 하드코딩
  .limit(1);

// ✅ Correct: 상수 사용
const ACTIVE_STATUS: VersionStatus = 'active';
const activeVersion = await db
  .select()
  .from(versions)
  .where(eq(versions.versionStatus, ACTIVE_STATUS))
  .limit(1);
```

### 3. Active 버전 수정 허용

```typescript
// ❌ Anti-pattern: Active 버전 직접 수정
async updateProduct(masterId: string, data: UpdateDto) {
  const activeVersion = await this.getActiveVersion(masterId);
  await this.db.update(versions)
    .set(data)
    .where(eq(versions.id, activeVersion.id));  // 위험!
}

// ✅ Correct: 새 Draft 생성 후 수정
async updateProduct(masterId: string, data: UpdateDto) {
  const activeVersion = await this.getActiveVersion(masterId);
  const draftVersion = await this.createDraft(activeVersion.id);
  await this.updateDraft(draftVersion.id, data);
  return draftVersion;
}
```

### 4. 버전 없이 Mapping 테이블 사용

```typescript
// ❌ Anti-pattern: Version 번호 누락
await db.insert(productMasterCategories).values({
  masterId: master.id,
  categoryId: category.id,
  // version 누락!
});

// ✅ Correct: Version 번호 포함
await db.insert(productMasterCategories).values({
  masterId: master.id,
  version: currentVersion,
  categoryId: category.id,
});
```

### 5. Version ID를 외부에 노출

```typescript
// ❌ Anti-pattern: Version ID를 사용자에게 노출
{
  "id": "version-uuid-12345",  // Version ID
  "name": "상품명",
  // ...
}

// ✅ Correct: Master ID를 상품 ID로 노출
{
  "id": "master-uuid-67890",  // Master ID
  "name": "상품명",
  // ...
}
```

---

## 체크리스트

### 새 기능 개발 시

- [ ] Master ID와 Version ID를 명확히 구분했는가?
- [ ] Active 버전을 기본값으로 사용하는가?
- [ ] Draft 상태에서만 수정 가능하도록 검증하는가?
- [ ] 트랜잭션을 올바르게 전파하는가?
- [ ] Mapping 테이블에 version 필드를 포함했는가?
- [ ] 이벤트에 masterId와 versionId를 모두 포함했는가?
- [ ] 일반 사용자에게 버전 개념을 숨겼는가?

### 코드 리뷰 시

- [ ] 파라미터 이름이 masterId/versionId로 명확한가?
- [ ] Version status 검증이 있는가?
- [ ] Active 버전을 직접 수정하지 않는가?
- [ ] 트랜잭션 경계가 올바른가?
- [ ] Foreign Key 제약 조건이 올바른가?
- [ ] API 문서가 정확한가?

---

## 참고 자료

- [마이그레이션 이슈 보고서](./MIGRATION_ISSUES.md)
- [API 설계 가이드](./API_DESIGN_GUIDE.md)
- 데이터베이스 스키마: `apps/pim/src/schema.ts`
- 타입 정의: `apps/pim/src/types.ts`

---

**최종 업데이트:** 2025-11-24  
**작성자:** AI Development Assistant  
**검토 필요:** CTO, Backend Team Lead

