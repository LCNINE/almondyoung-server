PIM_MEDUSA_IMPROVEMENTS.md# PIM-Medusa 동기화 개선 사항 (v2)

## 🎯 주요 개선 내용

### 1. ✅ 매핑 테이블 추가 (`pim_medusa_mappings`)

**문제점:**
- 매번 Medusa API에서 `metadata.pimMasterId` 검색 → 비용/지연 발생
- 동기화 이력 추적 어려움
- 재처리 시 느린 조회

**해결:**
```sql
CREATE TABLE pim_medusa_mappings (
  id UUID PRIMARY KEY,
  pim_master_id VARCHAR(255) UNIQUE,
  pim_version_id VARCHAR(255),
  pim_version INTEGER,  -- ⭐ 버전 순서 제어용
  medusa_product_id VARCHAR(255),
  medusa_handle VARCHAR(255),
  sync_status VARCHAR(20),
  last_synced_at TIMESTAMP,
  sync_error_count INTEGER,  -- 연속 실패 추적
  ...
);
```

**효과:**
- Medusa API 호출 1회 절감 (매핑 조회 → DB 조회로)
- 동기화 이력/상태 추적 가능
- 재처리/모니터링 편의성 향상

---

### 2. ✅ 이벤트 순서/중복 처리 (멱등성 강화)

**문제점:**
- Kafka는 at-least-once → 중복/재전달 가능
- 늦게 도착한 이벤트로 롤백되는 사고 위험

**해결:**
```typescript
// PimMedusaMappingRepository.shouldProcess()
async shouldProcess(pimMasterId: string, newVersion: number): Promise<boolean> {
  const existing = await this.findByPimMasterId(pimMasterId);
  
  if (!existing) return true; // 매핑 없으면 처리
  
  if (newVersion <= existing.pimVersion) {
    // 이미 반영된 버전보다 낮으면 skip
    this.logger.warn(`Skipping stale event: v${newVersion} <= v${existing.pimVersion}`);
    return false;
  }
  
  return true;
}
```

**플로우:**
```
1. 이벤트 수신 (masterId, version=3)
2. 매핑 테이블 조회 → 현재 v2
3. 3 > 2 → 처리 진행
4. 동기화 성공 → 매핑 테이블에 v3 기록

[나중에 늦은 이벤트 도착]
5. 늦은 이벤트 수신 (masterId, version=2)
6. 매핑 테이블 조회 → 현재 v3
7. 2 <= 3 → SKIP (로그만 남기고 무시)
```

---

### 3. ⚠️ TODO: 스냅샷 기반 전체 치환 (Variant 삭제 포함)

**현재 상태:**
- 문서: "스냅샷 기반 전체 치환"
- 실제 코드: "새 Variant 추가 시 기존 유지" ← 충돌

**문제점:**
- PIM에서 옵션 삭제 → Medusa에 유령 Variant 남음
- 가격/재고/장바구니 꼬임
- 쇼핑몰 운영 혼란

**해결 방향:**
```typescript
// 진짜 스냅샷 치환 로직 (TODO)
async syncVariants(medusaProductId: string, pimVariants: Variant[]) {
  // 1. Medusa 현재 Variant 목록 조회
  const existingVariants = await medusaClient.getVariants(medusaProductId);
  
  // 2. PIM 스냅샷에 없는 Variant 찾기
  const pimVariantIds = new Set(pimVariants.map(v => v.id));
  const toDelete = existingVariants.filter(
    v => !pimVariantIds.has(v.metadata.pimVariantId)
  );
  
  // 3. 없어진 Variant 삭제 (or 비활성화)
  for (const variant of toDelete) {
    await medusaClient.deleteVariant(variant.id); // or deactivate
  }
  
  // 4. PIM 스냅샷 기준으로 생성/업데이트
  for (const pimVariant of pimVariants) {
    await medusaClient.upsertVariant(medusaProductId, pimVariant);
  }
}
```

**정책 결정 필요:**
- 삭제 vs 비활성화 (재고/주문 이력 고려)
- 장바구니에 담긴 Variant 처리 방법

---

### 4. ⚠️ TODO: Unpublish 정책 확정

**현재 상태:**
- 문서에 TODO로만 표기
- 실제 처리 로직 없음

**시나리오:**
```
PIM: Draft → Active (publish) → Inactive (unpublish)
         ↓             ↓              ↓
Medusa:  ?    →    published   →     ?
```

**정책 옵션:**

| 옵션 | Medusa 상태 | 영향 |
|------|-------------|------|
| A. Draft 처리 | `status='draft'` | 쇼핑몰 검색/목록에서 숨김 |
| B. 삭제 | Soft delete | 완전 제거 (주문 이력 영향) |
| C. 비노출 필드 | `metadata.hidden=true` | 검색은 숨기되 URL 직접 접근 가능 |

**추천:** A (Draft 처리) - 재publish 시 복구 용이

---

### 5. ✅ 재시도/에러 처리 강화

**개선 사항:**
```typescript
// PimMedusaSyncService.syncMaster()
try {
  // 1. 순서 체크
  const shouldProcess = await this.mappingRepo.shouldProcess(masterId, snapshot.version);
  if (!shouldProcess) {
    return { success: true, action: 'skipped', reason: 'stale_version' };
  }
  
  // 2. 동기화 실행
  const { product, action } = await this.medusaClient.upsertProduct(payload);
  
  // 3. 성공 기록
  await this.mappingRepo.recordSuccess(masterId, {
    pimVersionId: snapshot.versionId,
    pimVersion: snapshot.version,
    medusaProductId: product.id,
    medusaHandle: product.handle,
    action,
  });
  
  return { success: true, action };
  
} catch (error) {
  // 4. 실패 기록 (에러 카운트 증가)
  await this.mappingRepo.recordFailure(masterId, {
    pimVersionId: snapshot.versionId,
    pimVersion: snapshot.version,
    error: error.message,
  });
  
  // 5. 연속 실패 알람 (TODO)
  const mapping = await this.mappingRepo.findByPimMasterId(masterId);
  if (mapping && mapping.syncErrorCount >= 5) {
    await this.alertService.send({
      title: 'PIM-Medusa 동기화 연속 실패',
      message: `${masterId} 5회 연속 실패`,
    });
  }
  
  throw error;
}
```

---

### 6. ✅ 쇼핑몰 프론트 전환 가이드

**현재 문제:**
- 쇼핑몰이 PIM API 직접 조회 → 장기적으로 지속 불가
- 가격정책/재고/카트가 Medusa 기반이어야 함

**전환 로드맵:**

#### Phase 1: PIM → Medusa 동기화 안정화 (지금)
- 이벤트 기반 동기화 완료
- 백필 스크립트 완료
- 매핑 테이블 완료

#### Phase 2: 쇼핑몰 API 이중화 (2주 내)
```typescript
// 임시: PIM과 Medusa 둘 다 호출 (fallback)
const products = await Promise.allSettled([
  pimApi.getProducts(),
  medusaApi.getProducts(),
]);

// Medusa 우선, 실패 시 PIM
return products[1].status === 'fulfilled' 
  ? products[1].value 
  : products[0].value;
```

#### Phase 3: Medusa SDK 전환 (1개월 내)
```typescript
// storefront/lib/sdk.ts
import Medusa from '@medusajs/js-sdk';

export const sdk = new Medusa({
  baseUrl: process.env.NEXT_PUBLIC_MEDUSA_URL,
  publishableKey: process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY,
});

// pages/products/[id].tsx
const { product } = await sdk.store.product.retrieve(id);
```

**중요:** 
- Publishable API Key 발급 필요 (Medusa Admin)
- Store API는 인증 방식이 다름 (session/bearer vs publishable key)

---

## 📊 Before & After

### Before (v1)
```
PIM Publish
  ↓ Kafka
[Consumer]
  ↓ PIM API 조회
[Transformer]
  ↓ Medusa metadata 검색 (느림)
[MedusaClient.upsertProduct()]
  ✅ 성공 → 로그만
  ❌ 실패 → 로그만 (재시도 없음)
```

**문제:**
- 중복/늦은 이벤트 롤백 위험
- Medusa 검색 비용
- 에러 추적 어려움

### After (v2)
```
PIM Publish (v3)
  ↓ Kafka
[Consumer]
  ↓ 매핑 DB 조회 (v2)
  ✅ v3 > v2 → 처리
  ❌ v2 <= v2 → SKIP
  ↓ PIM API 조회
[Transformer]
  ↓ 매핑 DB에서 medusaProductId 조회 (빠름)
[MedusaClient.upsertProduct()]
  ✅ 성공 → 매핑 DB 업데이트 (v3 기록)
  ❌ 실패 → 매핑 DB에 실패 기록 (에러 카운트+1)
```

**개선:**
- 순서 제어 (늦은 이벤트 무시)
- Medusa API 호출 1회 절감
- 에러 추적/알람 가능

---

## 🚀 다음 단계 우선순위

| 순위 | 항목 | 중요도 | 난이도 |
|------|------|--------|--------|
| 1 | **스냅샷 치환 (Variant 삭제)** | 🔴 High | Medium |
| 2 | **Unpublish 정책 확정** | 🔴 High | Low |
| 3 | 연속 실패 알람 | 🟡 Medium | Low |
| 4 | 쇼핑몰 API 이중화 | 🔴 High | Medium |
| 5 | Medusa SDK 전환 | 🟡 Medium | High |
| 6 | 재고 동기화 (WMS→Medusa) | 🟢 Low | High |

---


