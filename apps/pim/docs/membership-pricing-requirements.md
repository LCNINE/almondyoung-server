# PIM 멤버십 가격 정책 시스템 요구사항 명세서

## 📋 문서 정보

- **작성일**: 2025-09-29
- **버전**: 1.0
- **담당자**: PIM 팀
- **관련 마이크로서비스**: PIM, Membership

---

## 🎯 개요

### 목적

PIM 시스템에 멤버십 기반 가격 정책 기능을 구현하여, 회원 등급별로 차별화된 가격과 상품 접근 권한을 제공합니다.

### 핵심 가치

- **멤버십 혜택 차별화**: 티어별 맞춤 가격 정책
- **유연한 정책 관리**: 상품/변형별 세밀한 가격 제어
- **가시성 제어**: 멤버십 전용 상품 관리
- **프로모션 연동**: 향후 타임세일 시스템과의 통합 준비

---

## 🗂️ 핵심 기능

### 1. 멤버십 가격 정책 (Membership Policies)

#### 1.1 정책 적용 범위

- **상품 마스터 레벨**: 전체 상품에 대한 멤버십 정책
- **변형 레벨**: 특정 변형(옵션 조합)에 대한 개별 정책
- **티어별 차별화**: 각 멤버십 티어별 독립적인 정책

#### 1.2 가격 정책 유형

```typescript
// 할인율 기반
{
  discount: 15, // 15% 할인
  price: null
}

// 고정 가격 기반
{
  discount: null,
  price: 45000 // 멤버십 전용 가격
}

// 가시성 전용 (가격 변경 없이 접근 권한만)
{
  visibilityOnly: true,
  discount: null,
  price: null
}
```

#### 1.3 정책 우선순위

1. **변형별 멤버십 정책** (최고 우선순위)
2. **상품별 멤버십 정책**
3. **기본 가격 전략** (option_based/variant_based)

---

## 🏗️ 데이터베이스 스키마

### 멤버십 정책 테이블 (membership_policies)

```sql
CREATE TABLE membership_policies (
  id UUID PRIMARY KEY,
  master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  membership_tier_id UUID NOT NULL, -- 멤버십 서비스의 티어 ID
  price BIGINT, -- 멤버십 전용 가격 (원 단위)
  discount INTEGER, -- 할인율 (%)
  visibility_only BOOLEAN DEFAULT false, -- 가시성 전용 여부
  valid_from TIMESTAMP DEFAULT NOW(),
  valid_to TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 제약 조건

- `master_id`와 `variant_id` 중 하나는 반드시 존재해야 함
- 동일한 `(master_id/variant_id, membership_tier_id)` 조합은 유일해야 함
- `price`와 `discount` 중 하나는 반드시 존재해야 함 (둘 다 null 불가, 단 `visibility_only=true`인 경우 예외)

---

## 🔄 비즈니스 로직

### 1. 가격 계산 로직

#### 1.1 일반 사용자 (비회원/무료 회원)

```
최종 가격 = 기존 가격 전략에 따른 가격
- option_based: basePrice + 옵션별 추가 가격
- variant_based: 변형별 개별 가격
```

#### 1.2 멤버십 회원

```
1. 해당 변형에 대한 멤버십 정책 확인
2. 없으면 상품 마스터에 대한 멤버십 정책 확인
3. 멤버십 정책이 있는 경우:
   - price가 설정된 경우: 멤버십 전용 가격 적용
   - discount가 설정된 경우: 기본 가격에서 할인율 적용
4. 멤버십 정책이 없는 경우: 기본 가격 적용
```

### 2. 상품 가시성 제어 (프론트엔드 처리)

#### 2.1 서버 응답 정책

- **투명한 데이터 제공**: 모든 상품 데이터를 API 응답에 포함
- **메타데이터 포함**: 멤버십 정책, 권한 레벨, 할인 정보 등
- **사용자 정보 제공**: 현재 사용자의 멤버십 티어 정보

#### 2.2 프론트엔드 처리 로직

- **일반 상품**: 모든 사용자에게 표시
- **멤버십 전용 상품**: 조건부 렌더링으로 표시/비표시 결정
- **가격 표시**: 사용자 권한에 따라 일반가/멤버십가 선택 표시
- **UX 최적화**: 즉시 반응하는 인터페이스, 로딩 없는 필터링

### 3. 유효기간 관리

- `valid_from`: 정책 시작일
- `valid_to`: 정책 종료일 (NULL인 경우 무기한)
- 현재 시점이 유효기간 내에 있는 정책만 적용

---

## 🚀 API 요구사항

### 1. 멤버십 정책 관리 API

#### 1.1 정책 생성

```http
POST /masters/{masterId}/membership-policies
POST /variants/{variantId}/membership-policies

{
  "membershipTierId": "tier-uuid",
  "price": 45000, // 또는 null
  "discount": 15, // 또는 null
  "visibilityOnly": false,
  "validFrom": "2025-10-01T00:00:00Z",
  "validTo": "2025-12-31T23:59:59Z"
}
```

#### 1.2 정책 조회

```http
GET /masters/{masterId}/membership-policies
GET /variants/{variantId}/membership-policies
GET /membership-policies?tierIds=tier1,tier2&status=active
```

#### 1.3 정책 수정/삭제

```http
PUT /membership-policies/{policyId}
DELETE /membership-policies/{policyId}
```

### 2. 상품 조회 API (MVP - 프론트엔드 처리)

#### 2.1 상품 목록 (메타데이터만 포함)

```http
GET /masters

Response:
{
  "data": [
    {
      "id": "master-uuid",
      "name": "제품명",
      "basePrice": 100000,
      "membershipPolicy": {
        "discount": 15,
        "price": null,
        "requiredTierLevel": 2,
        "membershipOnly": false
      }
    }
  ]
}

// 프론트엔드에서 처리
const userTier = getUserMembershipFromAuth(); // 로그인 시 이미 받은 정보
const visibleProducts = products.filter(p =>
  !p.membershipPolicy?.membershipOnly ||
  userTier.level >= p.membershipPolicy.requiredTierLevel
);
```

#### 2.2 멤버십 정책 조회 (다른 서비스용)

```http
GET /masters/{masterId}/membership-policies
GET /variants/{variantId}/membership-policies

// 주문/결제 서비스에서 사용
// 해당 서비스가 직접 가격 계산 및 검증 수행
```

---

## 🔗 외부 시스템 연동

### 1. Membership 서비스 연동

- **티어 정보 검증**: 멤버십 서비스에서 유효한 티어 ID 확인
- **사용자 티어 조회**: 주문/결제 시 사용자의 현재 티어 확인

### 2. 연동 인터페이스

```typescript
interface MembershipServiceClient {
  // 티어 유효성 검증
  validateTier(tierId: string): Promise<boolean>;

  // 사용자 티어 조회
  getUserTier(userId: string): Promise<{
    tierId: string;
    tierCode: string;
    priorityLevel: number;
  }>;

  // 티어 목록 조회
  getTiers(): Promise<Tier[]>;
}
```

---

## 📊 데이터 플로우

### 1. 상품 등록 시

```
1. 상품 마스터 생성
2. (선택사항) 멤버십 정책 설정
   - 티어별 가격/할인율 설정
   - 유효기간 설정
   - 가시성 정책 설정
```

### 2. 상품 조회 시 (프론트엔드 처리)

```
1. 서버: 모든 상품 데이터 + 멤버십 메타데이터 반환
2. 서버: 사용자 멤버십 티어 정보 함께 전달
3. 프론트엔드: 사용자 권한에 따른 조건부 렌더링
4. 프론트엔드: 가격 계산 및 표시 (일반가 vs 멤버십가)
5. 프론트엔드: 가시성 필터링 (멤버십 전용 상품)
```

### 3. 주문/결제 시 (다른 서비스에서 처리)

```
1. 프론트엔드: 주문/결제 서비스에 주문 요청
2. 주문/결제 서비스: PIM에서 상품 정보 + 멤버십 정책 조회
3. 주문/결제 서비스: 멤버십 서비스에서 사용자 티어 확인
4. 주문/결제 서비스: 최종 가격 계산 및 검증
5. 주문/결제 서비스: 주문 생성 및 결제 처리
6. PIM 서비스: 순수 데이터 제공 역할만 수행
```

---

## ⚠️ 제약사항 및 고려사항

### 1. MVP 고려사항 (단순화)

- **프론트엔드 처리**: 가시성 및 가격 표시 로직은 클라이언트에서 처리
- **서버 검증**: 실제 주문/결제 시점에서만 서버 재검증 수행
- **데이터 투명성**: 모든 상품 정보를 API에서 제공 (메타데이터 포함)

### 2. 보안 고려사항 (MVP)

- **결제 시점 검증**: 주문 생성 시 서버에서 가격 재계산 및 검증
- **API Rate Limiting**: 과도한 데이터 크롤링 방지
- **점진적 보안 강화**: 향후 민감한 데이터는 서버 필터링으로 이관 가능

### 3. 데이터 일관성 (기본)

- 멤버십 정책 변경 시 즉시 반영
- 정책 유효기간 관리 (기본 기능만)

---

## 🎯 향후 확장 계획

### 1. 프로모션 시스템 연동 (10월 이후)

- 멤버십 할인 + 프로모션 할인 중복 적용 정책
- 타임세일과 멤버십 혜택의 우선순위 결정
- 복합 할인 시 최대 할인율 제한

### 2. 고도화 기능

- 구매 이력 기반 개인화 가격
- 지역별/시간대별 차별 가격
- A/B 테스트를 위한 동적 가격 정책

### 3. 분석 및 모니터링

- 멤버십 정책별 매출 분석
- 티어별 구매 패턴 분석
- 가격 민감도 분석

---

### 참고해야할 파일목록 (zod파일과 타입파일은 ssot를 지켜야함. 어기면안됨)

apps/pim/src/schemas/categories.schema.ts
apps/pim/src/schemas/channel-products.schema.ts
apps/pim/src/schemas/product-masters.schema.ts
apps/pim/src/schemas/product-variants.schema.ts
apps/pim/src/schemas/sales-channels.schema.ts
apps/pim/src/types.ts

## 📝 구현 우선순위 (MVP 중심)

### Phase 1 (MVP - 필수 기능)

1. **데이터베이스 스키마**: `membership_policies` 테이블 구현
2. **기본 API**: 정책 CRUD API 구현
3. **상품 조회 API**: 메타데이터 포함한 상품 목록 반환
4. **정책 조회 API**: 다른 서비스가 사용할 멤버십 정책 조회
5. **멤버십 서비스 연동**: 정책 생성 시 티어 유효성 검증

### Phase 2 (확장 기능 - 추후)

1. 고급 정책 관리 도구
2. 분석 및 리포팅
3. 프로모션 시스템 연동

### Phase 3 (최적화 - CTO 담당)

1. 캐싱 최적화
2. 성능 튜닝
3. 모니터링 및 알람

---

## ✅ 성공 기준

### 기능적 요구사항

- [ ] 티어별 차별화된 가격 정책 적용
- [ ] 멤버십 전용 상품 가시성 제어
- [ ] 실시간 가격 계산 및 조회
- [ ] 멤버십 서비스와의 안정적 연동

### 비기능적 요구사항

- [ ] 상품 목록 조회 응답시간 < 500ms
- [ ] 가격 계산 정확도 100%
- [ ] 멤버십 서비스 장애 시 기본 가격으로 폴백
- [ ] 동시 사용자 1000명 이상 지원

---

## 📚 참고 문서

- [PIM 시스템 종합 가이드](./pim-comprehensive-guide.md)
- [멤버십 시스템 아키텍처 문서](../../membership/docs/)
- [가격 전략 시스템 문서](./pricing-strategy-guide.md)
