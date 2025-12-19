# PIM ↔ Medusa 동기화 전략 (최종 확정)

## 📌 핵심 원칙

### 1. **Medusa는 PIM의 Active 버전만 관리**
- PIM에 `active` 상태 버전이 있으면 → Medusa에 존재 (`published`)
- PIM에 `active` 상태 버전이 없으면 → Medusa에서 삭제
- **상태 관리는 PIM이 전담, Medusa는 단순 복제**

### 2. **PIM 버전 관리 구조**

```
product_masters (메타데이터)
  ├── id (masterId)
  ├── createdAt, deletedAt
  └── versions[] (product_master_versions)
      ├── id (versionId)
      ├── version (번호)
      ├── status: 'draft' | 'active' | 'inactive'
      ├── name, description, images, ...
      └── variants[]
```

**상태별 의미:**
- `draft`: 수정 중, 비공개 (수정 가능)
- `active`: **공개 상품** (Master당 최대 1개, 수정 불가)
- `inactive`: 과거 버전 (비공개, 수정 불가)

### 3. **PIM 이벤트 종류**

#### `ProductMasterActiveVersionChanged`
```json
{
  "eventType": "ProductMasterActiveVersionChanged",
  "payload": {
    "masterId": "uuid",
    "productId": "versionId (active인 경우) or null",
    "version": 1 | null,
    "name": "상품명" | null,
    "previousActiveVersionId": "uuid" | null,
    "changeReason": "published" | "rollback" | "unpublished",
    "changedAt": "2025-01-01T00:00:00Z"
  }
}
```

**changeReason 별 처리:**

| changeReason | productId | Medusa 동작 |
|-------------|-----------|------------|
| `published` | ✅ (있음) | Create/Update (Upsert) |
| `rollback` | ✅ (있음) | Update (이전 버전으로 롤백) |
| `unpublished` | ❌ (null) | **Delete** (Active 없음) |

#### `ProductMasterDeleted`
```json
{
  "eventType": "ProductMasterDeleted",
  "payload": {
    "masterId": "uuid",
    "deletedAt": "2025-01-01T00:00:00Z"
  }
}
```
→ Medusa에서 Product 삭제

---

## 🔄 동기화 플로우

### 1. **Published / Rollback** (Active 버전 생성/변경)

```
PIM Event (published)
  ↓
Channel Adapter Consumer
  ↓
1. PimClient.getActiveVersion(masterId)  ← PIM API 호출
  ↓
2. transformPimToMedusa(snapshot)        ← 데이터 변환
  ↓
3. MedusaClient.upsertProduct(payload)   ← Medusa Admin API
  ↓
4. MappingRepository.recordSuccess()     ← 매핑 테이블 업데이트
```

### 2. **Unpublished** (Active 버전 제거)

```
PIM Event (unpublished, productId=null)
  ↓
Channel Adapter Consumer
  ↓
MedusaClient.deleteProduct(pimMasterId)
  ↓
  1. findProductByPimMasterId(pimMasterId)
  2. DELETE /admin/products/:medusaProductId
  ↓
MappingRepository.delete(pimMasterId)
```

### 3. **Master Deleted** (상품 삭제)

```
PIM Event (ProductMasterDeleted)
  ↓
Channel Adapter Consumer
  ↓
MedusaClient.deleteProduct(pimMasterId)
  ↓
MappingRepository.delete(pimMasterId)
```

---

## 🗂️ 매핑 테이블 (`pim_medusa_product_mappings`)

### 목적
1. **빠른 조회**: `pimMasterId` → `medusaProductId` (O(1))
2. **순서 제어**: `pimVersion` 기반 중복/순서 이벤트 필터링
3. **에러 추적**: `syncErrorCount`, `lastSyncError`

### 스키마
```sql
CREATE TABLE pim_medusa_product_mappings (
  id UUID PRIMARY KEY,
  pim_master_id UUID NOT NULL UNIQUE,
  pim_version_id UUID NOT NULL,
  pim_version INTEGER NOT NULL,
  medusa_product_id VARCHAR(255) NOT NULL,
  medusa_handle VARCHAR(255) NOT NULL,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'synced',
  last_synced_at TIMESTAMP NOT NULL,
  last_sync_action VARCHAR(20),  -- 'created' | 'updated' | 'deleted'
  sync_error_count INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### 순서 제어 (Idempotency)

```typescript
// 이미 반영된 버전보다 낮은 이벤트는 skip
async shouldProcess(pimMasterId: string, newVersion: number): Promise<boolean> {
  const existing = await findByPimMasterId(pimMasterId);
  
  if (!existing) return true; // 매핑 없음 → 처리
  
  if (newVersion <= existing.pimVersion) {
    logger.warn(`Skipping stale event: ${pimMasterId} (v${newVersion} <= v${existing.pimVersion})`);
    return false;
  }
  
  return true; // 새 버전 → 처리
}
```

---

## 📊 Medusa 데이터 구조

### Product Payload (변환 결과)

```typescript
{
  title: "상품명",
  handle: "pim-{masterId}",  // ← 고정 (중복 방지)
  status: "published",
  description: "상품 설명",
  thumbnail: "https://...",
  images: [{ url: "..." }],
  
  options: [
    { title: "색상", values: ["빨강", "파랑"] },
    { title: "사이즈", values: ["S", "M", "L"] }
  ],
  
  variants: [
    {
      title: "빨강 × S",
      sku: "PROD-001-R-S",
      options: { "색상": "빨강", "사이즈": "S" },
      prices: [
        { amount: 10000, currency_code: "krw" }
      ],
      metadata: {
        pimVariantId: "variant-uuid"
      }
    }
  ],
  
  metadata: {
    pimMasterId: "master-uuid",    // ← 핵심 키
    pimVersionId: "version-uuid",
    pimVersion: 1,
    syncedAt: "2025-01-01T00:00:00Z"
  }
}
```

---

## 🚨 에러 처리 전략

### 1. **재시도 (Retry)**
- PIM API 일시 장애 → 지수 백오프 재시도
- Medusa API 429 (Rate Limit) → 지연 후 재시도

### 2. **DLQ (Dead Letter Queue)**
- 3회 재시도 실패 → DLQ로 전송
- 관리자 알림 (Google Chat 웹훅)

### 3. **백필 (Backfill)**
- 장애 복구 후 백필 스크립트 실행
```bash
# 전체 동기화
pnpm exec tsx apps/channel-adapter/sync-pim-to-medusa.ts --all

# 단건 재동기화
pnpm exec tsx apps/channel-adapter/sync-pim-to-medusa.ts --master=uuid
```

---

## ✅ 트레이드오프 분석

### Q: Medusa에서 상태 관리를 하지 않는 이유?

**AS-IS (복잡):**
```
PIM (draft/active/inactive) ⇄ Medusa (draft/published/proposed/rejected)
→ 상태 불일치 가능성 ↑
→ 양방향 동기화 필요
```

**TO-BE (단순):**
```
PIM Active 있음 → Medusa 존재 (published)
PIM Active 없음 → Medusa 삭제
→ 단방향 동기화 (PIM이 Source of Truth)
```

**장점:**
- ✅ 상태 관리 책임 단일화 (PIM만 관리)
- ✅ 동기화 로직 단순화 (추가/삭제만)
- ✅ 버그 가능성 감소

**단점:**
- ❌ Medusa에서 임시 비활성화 불가 (PIM에서 unpublish 필요)
- ❌ Medusa 독립적 상태 변경 불가

**결론:**  
쇼핑몰 특성상 **상품 정보는 PIM이 관리**해야 하므로 TO-BE 방식이 적합.

---

## 📝 운영 체크리스트

### 배포 전
- [ ] PIM Active Version 목록 추출
- [ ] 백필 스크립트 테스트 (`--dry-run`)
- [ ] Medusa API Key 및 권한 확인

### 배포 중
- [ ] Kafka Consumer 정상 실행 확인
- [ ] 첫 이벤트 처리 확인 (로그)

### 배포 후
- [ ] 전체 백필 실행 (`--all`)
- [ ] 매핑 테이블 레코드 수 확인
- [ ] Medusa 제품 수 vs PIM Active Master 수 일치 확인
- [ ] 에러 로그 모니터링 (첫 24시간)

---


