좋습니다. CTO의 의견(이미지·blob류는 분리, 프론트에서 순서대로 여러 API 호출)과 현재 PIM의 패턴(상품 등록은 Composite API, 부가 기능은 Atomic API)을 모두 반영한 **최신 명세서**를 다시 작성해보겠습니다.

---

# 📝 PIM 멤버십 가격 정책 시스템 설계 명세서 (v1.0 – MVP)

## 📋 문서 정보

- **작성일**: 2025-09-29
- **버전**: 1.0 (MVP)
- **설계 방법론**: Spec-Driven Development
- **구현 우선순위**: MVP – Atomic API (상품 등록과 분리)

---

## 🏗️ 아키텍처 설계

### 1. 구현 패턴

| 구분                          | 현재 PIM 패턴                | 멤버십 정책 구현   |
| ----------------------------- | ---------------------------- | ------------------ |
| 핵심 데이터(상품/옵션/변형)   | Composite API(POST /masters) | 유지               |
| 부가 기능(채널, 이미지, 정책) | Atomic API 별도 엔드포인트   | 멤버십 정책도 동일 |

→ **상품 등록 후 별도로 멤버십 정책 API 호출**. 프론트에서 순서대로 API를 호출해 데이터를 저장.

### 2. 시스템 구조도

```
┌───────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│  Controller       │    │  Service           │    │  Repository         │
│ MembershipPolicy  │◄──►│ MembershipPolicy   │◄──►│ MembershipMappings  │
│ Controller        │    │ Service            │    │ Repository          │
└───────────────────┘    └────────────────────┘    └────────────────────┘
                                │
                                ▼
                       ┌────────────────────┐
                       │ MembershipService  │
                       │ Client (티어검증) │
                       └────────────────────┘
```

---

## 📊 데이터 모델 설계

### 1. 테이블: membership_mappings

```sql
CREATE TABLE membership_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  master_id UUID REFERENCES product_masters(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  membership_tier_id UUID NOT NULL,           -- 멤버십 서버의 티어 ID
  visibility_only BOOLEAN DEFAULT false,      -- 가시성 전용 여부
  price BIGINT,                               -- 멤버십 전용 가격(표시용)
  discount INTEGER,                           -- 할인율(%) 표시용
  valid_from TIMESTAMP DEFAULT NOW(),
  valid_to TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(master_id, variant_id, membership_tier_id)
);
```

### 2. 타입 정의

```ts
export interface MembershipMapping {
  id: string;
  masterId?: string;
  variantId?: string;
  membershipTierId: string;
  price?: number;
  discount?: number;
  visibilityOnly: boolean;
  validFrom: Date;
  validTo?: Date;
  createdAt: Date;
}
```

### 3. Zod 스키마 정의

```ts
export const CreateMembershipMappingSchema = z
  .object({
    membershipTierId: z.uuid(),
    price: z.number().positive().optional(),
    discount: z.number().int().min(1).max(100).optional(),
    visibilityOnly: z.boolean().default(false),
    validFrom: z.iso.datetime().optional(),
    validTo: z.iso.datetime().optional(),
  })
  .refine(
    (d) =>
      d.visibilityOnly || d.price !== undefined || d.discount !== undefined,
    { message: 'visibilityOnly가 false이면 price 또는 discount 필수' },
  );

export const MembershipMappingSchema = z.object({
  id: z.uuid(),
  masterId: z.uuid().nullable(),
  variantId: z.uuid().nullable(),
  membershipTierId: z.uuid(),
  price: z.number().nullable(),
  discount: z.number().int().nullable(),
  visibilityOnly: z.boolean(),
  validFrom: z.iso.datetime(),
  validTo: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
```

---

## 🔧 서비스 계층 설계

### MembershipPolicyService (Atomic API 전용)

- `createMapping(scope, targetId, dto)`
- `updateMapping(id, dto)`
- `deleteMapping(id)`
- `findMappings(scope, targetId)`
- `calculatePrice(context)` (회원 가격 계산)

**상품 등록 시점에는 호출하지 않음**.
상품 등록 후 별도로 `POST /masters/:id/membership-policies` 또는 `POST /variants/:id/membership-policies`로 추가.

---

## 🎮 컨트롤러 계층 설계

### 엔드포인트

```text
POST    /masters/:id/membership-policies      // 마스터 상품에 정책 추가
GET     /masters/:id/membership-policies      // 마스터 정책 목록
POST    /variants/:id/membership-policies     // 변형 상품에 정책 추가
GET     /variants/:id/membership-policies     // 변형 정책 목록
PUT     /membership-policies/:id              // 정책 수정
DELETE  /membership-policies/:id              // 정책 삭제
GET     /masters/:id/membership-price         // 마스터 멤버십 가격 계산
GET     /variants/:id/membership-price        // 변형 멤버십 가격 계산
```

→ 기존 PIM API 패턴과 일치.

---

## 🧪 테스트 설계

- 단위 테스트: Service·Repository 모킹하여 정책 생성·계산 검증
- e2e 테스트: `POST /masters/:id/membership-policies` → `GET /masters/:id/membership-price` 연계 확인

---

## 🔧 설정 및 모듈 구성

- `MembershipPricingModule`에 Controller, Service, Repository, MembershipServiceClient 등록
- 환경변수 `MEMBERSHIP_SERVICE_URL`로 멤버십 서버 호출

---

---

## 🚀 배포 및 모니터링

- Terminus 헬스체크로 MembershipServiceClient 상태 확인
- Prometheus 메트릭스: 정책 생성 건수·가격 계산 시간 수집

---

## 📋 구현 체크리스트

### Phase 1 (MVP)

- [ ] membership_mappings 테이블 생성
- [ ] MembershipMappingsRepository/Service/Controller 구현
- [ ] POST/GET/PUT/DELETE API 구현
- [ ] 기본 단위·e2e 테스트 작성

### Phase 2 (확장)

- [ ] Medusa PriceList/Discount 매핑
- [ ] 정책 이력·유효기간 관리

### Phase 3 (운영)

- [ ] 헬스체크·모니터링·알람
- [ ] 문서화·배포 파이프라인 구성

---

💡 **핵심 요약**

- **상품 등록 API는 그대로 Composite**
- **이미지·멤버십 정책·채널상품 같은 부가 기능은 Atomic API로 별도 호출**
- **프론트는 상품 등록 → 이미지 업로드 → 멤버십 정책 설정 순서로 여러 API를 호출**

이렇게 하면 CTO가 강조한 “blob류 데이터와 폼 데이터 분리” 원칙도 지키면서, PIM의 기존 아키텍처 패턴과 일관성을 유지할 수 있습니다.
