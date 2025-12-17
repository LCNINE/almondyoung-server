# ⚠️ 백엔드 팀 확인 필요: PIM API 가격 정보

## 🔍 현재 문제

### 1. `/masters` API 응답에 가격 정보 없음

**현재 응답**:
```json
{
  "versionId": "...",
  "masterId": "...",
  "name": "세팅 스프레이 (메이크업)",
  "thumbnail": null,
  "brand": "맥",
  "isMembershipOnly": false,
  "status": "active",
  "createdAt": "2025-12-17T06:27:59.544Z",
  "optionGroupNames": [],
  "variantCount": 1
  // ❌ 가격 정보가 없음!
}
```

**프론트엔드 결과**:
- 모든 상품이 **0원**으로 표시됨
- 사용자 경험 저하

---

## ✅ 해결 방법 (3가지 옵션)

### 옵션 1: `/masters` API에 가격 범위 추가 ⭐⭐⭐ (권장)

**장점**:
- 성능 최고 (단일 쿼리)
- 프론트엔드 로직 단순
- 사용자 경험 최상

**구현 방법**:
```json
{
  "versionId": "...",
  "name": "상품명",
  "brand": "브랜드",
  // ... 기존 필드 ...
  "priceRange": {
    "min": 15000,
    "max": 25000
  },
  "membershipPriceRange": {
    "min": 13500,
    "max": 22500
  }
}
```

**백엔드 쿼리 예시** (PostgreSQL + Drizzle):
```sql
-- 각 Master의 Active 버전 기준으로 가격 계산
SELECT 
  pm.id as master_id,
  pmv.id as version_id,
  pmv.name,
  -- 기본가 범위 계산 (base_price 레이어 규칙 적용)
  MIN(calculated_base_price) as min_price,
  MAX(calculated_base_price) as max_price,
  -- 멤버십가 범위 계산 (membership_price 레이어 규칙 적용)
  MIN(calculated_membership_price) as min_membership_price,
  MAX(calculated_membership_price) as max_membership_price
FROM product_masters pm
JOIN product_master_versions pmv ON pm.id = pmv.master_id
JOIN product_master_variants pmv ON pm.id = pmv.master_id AND pmv.version_id = pmv.id
JOIN product_variants pv ON pmv.variant_id = pv.id
-- 가격 규칙 적용 로직 (pricing_rules 테이블 조인)
WHERE pmv.status = 'active'
GROUP BY pm.id, pmv.id, pmv.name;
```

**예상 작업 시간**: 2-3시간
- 가격 계산 로직 추가 (~1.5시간)
- 테스트 (~1시간)

---

### 옵션 2: Bulk Pricing API 추가 ⭐⭐

**장점**:
- 유연성 높음
- 기존 API 구조 유지
- 다른 서비스에서도 활용 가능

**단점**:
- 추가 API 호출 필요 (N+1 문제 발생 가능)
- 프론트엔드 복잡도 증가

**구현 방법**:
```typescript
// POST /pim/masters/pricing/bulk
{
  "masterIds": ["master1", "master2", ...],
  "customerType": "regular" | "membership"
}

// Response
{
  "prices": {
    "master1": { "min": 15000, "max": 25000 },
    "master2": { "min": 10000, "max": 15000 }
  }
}
```

**예상 작업 시간**: 3-4시간
- 새 엔드포인트 추가 (~2시간)
- 가격 계산 로직 (~1시간)
- 테스트 (~1시간)

---

### 옵션 3: 프론트엔드에서 개별 조회 ⭐ (비권장)

**장점**:
- 백엔드 작업 불필요

**단점**:
- 성능 최악 (302개 상품 = 302번 API 호출)
- 페이지 로딩 매우 느림
- 사용자 경험 최악

**예상 문제**:
- 초기 로딩 시간 15-30초
- 서버 부하 증가
- Rate limiting 문제 가능성

---

## 🎯 프론트엔드 팀 권장사항

**우선순위 1**: 옵션 1 (권장) ⭐⭐⭐
- 최소한의 노력으로 최고의 성능
- `/masters` API 응답에 `priceRange` 필드만 추가

**우선순위 2**: 옵션 2
- 유연성이 필요한 경우
- 다른 서비스에서도 활용 가능

**우선순위 3**: 옵션 3 (비권장)
- 백엔드 리소스가 부족한 경우만
- 임시 방편으로만 사용

---

## 📝 현재 상태

- ✅ Seed 스크립트에서 가격 규칙 생성 완료
- ✅ `/masters/:id/pricing/calculate` API 동작 확인
- ❌ `/masters` 목록 API에 가격 정보 없음

---

## 🚀 즉시 작업 가능한 항목

### 백엔드 팀

1. **가격 계산 로직 확인**
   ```bash
   # 테스트: 특정 Master의 가격 계산이 정상 작동하는지 확인
   curl -X POST \
     https://api-gateway-development-10ed.up.railway.app/pim/masters/{masterId}/pricing/calculate \
     -H "Content-Type: application/json" \
     -d '{
       "variantId": "...",
       "quantity": 1,
       "customerType": "regular"
     }'
   ```

2. **`/masters` API에 가격 범위 추가**
   - 기존 쿼리에 가격 계산 로직 추가
   - Response DTO에 `priceRange` 필드 추가

### 프론트엔드 팀 (임시 대응)

1. **가격 표시 수정**
   - 가격이 없으면 "가격 문의" 표시
   - 또는 Skeleton 표시

2. **백엔드 API 완성 대기**
   - 옵션 1 완료 시 바로 적용 가능

---

## 💬 질문사항

1. **가격 규칙이 정상 생성되었는지** 확인 필요
   ```sql
   SELECT COUNT(*) FROM product_master_pricing_rules;
   SELECT COUNT(*) FROM pricing_rules;
   ```

2. **`/masters/:id/pricing/calculate` API 테스트 필요**
   - Seed로 생성된 상품 중 하나로 테스트
   - 응답이 정상인지 확인

3. **구현 우선순위 및 일정 협의**
   - 옵션 1 선택 시 언제까지 가능한지?
   - 임시로 "가격 문의"로 표시하고 기다릴지?

---

## 📞 연락처

프론트엔드 팀: [연락처]
백엔드 팀: [연락처]

**긴급도**: 🔴 높음 (사용자에게 가격이 안 보임)
**예상 소요 시간**: 2-3시간 (옵션 1 선택 시)

