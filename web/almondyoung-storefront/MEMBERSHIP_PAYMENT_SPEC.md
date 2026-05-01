# 멤버십 결제 페이지 구현 명세서

## 📋 개요

멤버십 구독 결제 페이지에서 HMS 카드 등록 후 멤버십 구독을 생성하는 플로우를 구현합니다.

---

## 🎯 요구사항

### 1. 플랜 목록 조회

- **API:** `GET /api/membership/plans`
- **목적:** 월간/연간 플랜 정보를 가져와서 사용자에게 선택지 제공
- **참고:** API 게이트웨이를 통해 `/api/membership/*` 요청이 멤버십 서비스로 라우팅됨
- **데이터 구조:**
  ```typescript
  {
    success: true,
    data: [
      {
        plan: {
          id: string,           // UUID
          tierId: string,
          price: number,
          durationDays: number, // 30 (월간) 또는 365 (연간)
          currency: string,
          trialDays: number,
          isActive: boolean,
          createdAt: string,
          updatedAt: string
        },
        tier: {
          id: string,
          code: string,         // 예: "PREMIUM", "BASIC"
          name: string,
          priorityLevel: number,
          createdAt: string,
          updatedAt: string
        }
      },
      // ... 더 많은 플랜
    ],
    count: number
  }
  ```

### 2. 플랜 선택 로직

- **월간 플랜:** `data[0]` (배열의 첫 번째 항목)
- **연간 플랜:** `data[1]` (배열의 두 번째 항목)
- **가정:** 플랜 목록은 우선순위 순으로 정렬되어 있으며, 월간이 먼저, 연간이 두 번째로 반환됨

### 3. HMS 카드 프로필 생성

- **API:** `POST /api/wallet/v2/payments/profiles/hms-card`
- **조건:** 사용자가 "새 카드 등록"을 선택한 경우에만 호출
- **참고:** Next.js rewrite를 통해 wallet 서비스로 자동 라우팅됨
- **요청 데이터:**
  ```typescript
  {
    userId: string,           // JWT에서 추출된 사용자 ID
    memberName: string,       // 카드 소유자명 (payerName과 동일)
    phone: string,            // 전화번호 (숫자만)
    payerNumber: string,      // 6자리 생년월일 (YYMMDD)
    paymentNumber: string,    // 카드번호 (숫자만, 16자리)
    payerName: string,        // 납부자명
    validYear: string,        // YY (예: "28")
    validMonth: string,       // MM (예: "12")
    validUntil: string,       // YYMM (예: "2812")
    password: string,         // 비밀번호 앞 2자리
    paymentCompany: string    // 카드사 코드 (예: "HMC")
  }
  ```
- **응답:**
  ```typescript
  string // profileId (생성된 HMS 카드 프로필 ID)
  ```

### 4. 멤버십 구독 생성

- **API:** `POST /api/membership/subscriptions`
- **인증:** JWT 토큰 필요 (자동으로 userId 추출)
- **참고:** Next.js rewrite를 통해 membership 서비스로 자동 라우팅됨
- **요청 데이터:**
  ```typescript
  {
    planId: string // 선택한 플랜의 UUID
  }
  ```
- **응답:**
  ```typescript
  {
    success: true,
    data: {
      subscription: { ... },
      plan: { ... },
      tier: { ... }
    }
  }
  ```

---

## 🔄 실행 플로우

```
1. 페이지 로드
   ↓
2. GET /api/membership/plans 호출
   ↓
3. 플랜 목록 파싱
   - durationDays === 30 → 월간 플랜
   - durationDays === 365 → 연간 플랜
   ↓
4. 사용자 입력 (카드 정보 + 구독 유형 선택)
   ↓
5. 폼 제출
   ↓
6. [조건부] useNewCard === true인 경우
   → POST /api/wallet/v2/payments/profiles/hms-card
   → profileId 받음
   ↓
7. POST /api/membership/subscriptions
   - planId: 선택한 구독 유형에 따라 monthlyPlan.plan.id 또는 yearlyPlan.plan.id
   ↓
8. 성공 시 /mypage/membership으로 리다이렉트
```

---

## 📝 구현 세부사항

### 1. 페이지 로드 시 플랜 조회

```typescript
// page.tsx
async function getPlans() {
  const res = await fetch("/api/plans", {
    cache: "no-store", // 또는 revalidate 설정
  })

  if (!res.ok) {
    throw new Error("플랜 목록을 불러올 수 없습니다")
  }

  const data = await res.json()
  return data.data // PlanWithTier[]
}

export default async function MembershipFormPage() {
  const plans = await getPlans()

  // 월간/연간 플랜 추출 (durationDays로 판별)
  const monthlyPlan = plans.find(p => p.plan.durationDays === 30)
  const yearlyPlan = plans.find(p => p.plan.durationDays === 365)

  if (!monthlyPlan || !yearlyPlan) {
    throw new Error("필요한 플랜을 찾을 수 없습니다")
  }

  return (
    <MembershipForm
      memberId="demo-user-id" // 실제로는 서버에서 가져오기
      monthlyPlan={monthlyPlan}
      yearlyPlan={yearlyPlan}
      existingFmsMember={null}
      existingSubType={null}
      availableBenefits={mockBenefits}
    />
  )
}
```

### 2. MembershipForm Props 수정

```typescript
type MembershipFormProps = {
  memberId: string
  monthlyPlan: PlanWithTier
  yearlyPlan: PlanWithTier
  existingFmsMember: FmsMember
  existingSubType: SubscriptionType
  availableBenefits: MemberBenefit[]
}

type PlanWithTier = {
  plan: {
    id: string
    tierId: string
    price: number
    durationDays: number
    currency: string
    trialDays: number
    isActive: boolean
    createdAt: string
    updatedAt: string
  }
  tier: {
    id: string
    code: string
    name: string
    priorityLevel: number
    createdAt: string
    updatedAt: string
  }
}
```

### 3. 폼 제출 로직

```typescript
// components.tsx
import { clientApi } from "@lib/api/client-api"
import { ApiError } from "@lib/api/api-error"
import { useUser } from "contexts/user-context"

// 컴포넌트 내부
const { user } = useUser()

async function onSubmit(data: z.infer<typeof registerMembershipFormSchema>) {
  try {
    // 사용자 인증 확인
    if (!user) {
      toast.error("로그인이 필요합니다.")
      return
    }

    // 1단계: 새 카드 등록 (조건부)
    if (data.useNewCard) {
      const validMonth = data.validUntil.slice(0, 2) // "2812" → "28"
      const validYear = data.validUntil.slice(2, 4) // "2812" → "12"

      // userId는 JWT에서 자동 추출됨
      await clientApi("/api/wallet/v2/payments/profiles/hms-card", {
        method: "POST",
        body: JSON.stringify({
          memberName: data.payerName,
          phone: data.phone,
          payerNumber: data.payerNumber,
          paymentNumber: data.paymentNumber,
          payerName: data.payerName,
          validYear: validYear,
          validMonth: validMonth,
          validUntil: data.validUntil,
          password: data.password,
          paymentCompany: "HMC", // 또는 동적으로 결정
        }),
      })
    }

    // 2단계: 멤버십 구독 생성
    const selectedPlanId =
      data.subscriptionType === "monthly"
        ? monthlyPlan.plan.id
        : yearlyPlan.plan.id

    // userId는 JWT에서 자동 추출됨
    await clientApi("/api/membership/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        planId: selectedPlanId,
      }),
    })

    toast.success("멤버십이 등록되었습니다!")
    router.push("/mypage/membership")
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message)
    } else {
      toast.error("멤버십 등록에 실패했습니다.")
    }
    console.error(error)
  }
}
```

### 4. validUntil 파싱 로직

```typescript
// "2812" → validMonth: "28", validYear: "12"
// 실제로는 "MMYY" 형식이므로:
// "2812" → validMonth: "28" (MM), validYear: "12" (YY)

// 올바른 파싱:
const validMonth = data.validUntil.slice(0, 2) // "28"
const validYear = data.validUntil.slice(2, 4)  // "12"

// HMS API 요청 시:
{
  validMonth: "28", // MM
  validYear: "12",  // YY
  validUntil: "2812" // MMYY
}
```

---

## 🔐 인증 처리

### JWT 토큰

- `clientApi`는 자동으로 쿠키에서 JWT 토큰을 포함하여 요청
- 멤버십 구독 API는 `@UseGuards(JwtAuthGuard)`로 보호됨
- 서버에서 자동으로 `userId` 추출

### HMS 카드 API

- `userId`를 요청 body에 명시적으로 포함해야 함
- 현재는 prop으로 받은 `memberId` 사용
- 추후 JWT에서 추출하도록 개선 필요

---

## ⚠️ 주의사항

### 1. 플랜 판별 방식

- **구현 방식:** `durationDays`로 월간/연간 판별
  ```typescript
  const monthlyPlan = plans.find((p) => p.plan.durationDays === 30)
  const yearlyPlan = plans.find((p) => p.plan.durationDays === 365)
  ```
- **장점:** 플랜 순서에 의존하지 않아 안정적
- **에러 처리:** 플랜을 찾지 못한 경우 에러 발생

### 2. 카드사 코드

- 현재 하드코딩: `"HMC"`
- 실제로는 카드번호 BIN으로 카드사 판별 필요
- 또는 사용자에게 선택하도록 UI 추가

### 3. 에러 처리

- HMS 카드 생성 실패 시 멤버십 구독 진행하지 않음
- 각 단계별 명확한 에러 메시지 표시
- 네트워크 에러, 인증 에러, 검증 에러 구분

### 4. 기존 카드 사용

- `useNewCard: false`인 경우 HMS 카드 생성 생략
- 기존 카드 정보는 서버에 이미 저장되어 있음
- 멤버십 구독 시 자동으로 기존 카드 사용

### 5. 무료 체험 기간

- 플랜에 `trialDays`가 포함되어 있음
- 실제 결제는 무료 체험 종료 후 스케줄러가 처리
- 프론트엔드에서는 결제 처리 없이 구독만 생성

---

## 📊 데이터 흐름 다이어그램

```
┌─────────────────┐
│  사용자 입력     │
│  - 카드 정보     │
│  - 구독 유형     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  폼 제출         │
└────────┬────────┘
         │
         ▼
    useNewCard?
         │
    ┌────┴────┐
    │ Yes     │ No
    ▼         ▼
┌─────────┐  │
│ HMS 카드 │  │
│ 프로필   │  │
│ 생성     │  │
└────┬────┘  │
     │       │
     └───┬───┘
         │
         ▼
┌─────────────────┐
│  멤버십 구독     │
│  생성           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  성공 리다이렉트 │
│  /mypage/       │
│  membership     │
└─────────────────┘
```

---

## 🧪 테스트 시나리오

### 1. 새 카드로 월간 구독

1. 페이지 로드 → 플랜 목록 표시
2. "새 카드 등록" 선택
3. 카드 정보 입력
4. "월간 구독" 선택
5. 제출 → HMS 카드 생성 → 멤버십 구독 생성
6. 성공 메시지 → 리다이렉트

### 2. 기존 카드로 연간 구독

1. 페이지 로드 → 플랜 목록 표시
2. "기존 카드 사용" 선택
3. "연간 구독" 선택
4. 제출 → 멤버십 구독 생성 (HMS 카드 생성 생략)
5. 성공 메시지 → 리다이렉트

### 3. 에러 처리

1. 잘못된 카드 정보 입력
2. 제출 → HMS 카드 생성 실패
3. 에러 메시지 표시
4. 멤버십 구독 생성 진행하지 않음

---

## 📦 필요한 타입 정의

```typescript
// lib/types/membership.ts
export type PlanWithTier = {
  plan: {
    id: string
    tierId: string
    price: number
    durationDays: number
    currency: string
    trialDays: number
    isActive: boolean
    createdAt: string
    updatedAt: string
  }
  tier: {
    id: string
    code: string
    name: string
    priorityLevel: number
    createdAt: string
    updatedAt: string
  }
}

export type HmsCardProfileRequest = {
  // userId와 memberId는 서버에서 자동 처리
  memberName: string
  phone: string
  payerNumber: string
  paymentNumber: string
  payerName: string
  validYear: string
  validMonth: string
  validUntil: string
  password: string
  paymentCompany: string
}

export type CreateSubscriptionRequest = {
  planId: string
}
```

---

## 🔐 인증 및 사용자 정보

### Context API 사용

- `UserProvider`를 통해 전역 사용자 정보 관리 (`layout.tsx`)
- `useUser()` 훅으로 현재 로그인한 사용자 정보 접근
- 사용자 인증 상태 확인 및 에러 처리

  ```typescript
  import { useUser } from "contexts/user-context"

  const { user } = useUser()

  if (!user) {
    toast.error("로그인이 필요합니다.")
    return
  }
  ```

### JWT 토큰 자동 처리

- `clientApi`는 자동으로 쿠키에서 JWT 토큰을 포함하여 요청
- 멤버십 구독 API와 HMS 카드 API 모두 `@UseGuards(JwtAuthGuard)`로 보호됨
- 서버에서 자동으로 `userId` 추출 (`@User('userId')` 데코레이터)
- 프론트엔드는 `userId`를 전달할 필요 없음

---

## ✅ 체크리스트

- [x] 플랜 목록 조회 API 호출 (page.tsx) - `/api/membership/plans`
- [x] durationDays로 월간/연간 플랜 판별
- [x] MembershipForm props 수정 (monthlyPlan, yearlyPlan)
- [x] Context API로 사용자 정보 접근 (useUser)
- [x] 사용자 인증 상태 확인 및 에러 처리
- [x] HMS 카드 프로필 생성 API 호출 (components.tsx) - `/api/wallet/v2/payments/profiles/hms-card`
- [x] 멤버십 구독 생성 API 호출 (components.tsx) - `/api/membership/subscriptions`
- [x] validUntil 파싱 로직 구현 (slice 사용)
- [x] 에러 처리 구현 (ApiError 타입 체크)
- [x] 성공 시 리다이렉트 구현
- [x] 타입 정의 추가 (PlanWithTier 등)
- [ ] 테스트 시나리오 검증

---

## 🚀 다음 단계

1. **플랜 목록 조회 개선**
   - `durationDays`로 월간/연간 판별
   - 플랜이 없는 경우 에러 처리

2. **카드사 자동 판별**
   - BIN 번호로 카드사 판별 로직 추가
   - 또는 카드사 선택 UI 추가

3. **로딩 상태 관리**
   - 각 API 호출 시 로딩 인디케이터 표시
   - 버튼 비활성화

4. **혜택 정보 연동**
   - 무료 체험 기간 표시 (`trialDays`)
   - 할인 혜택 적용 로직

5. **분석 이벤트 추가**
   - 플랜 선택 이벤트
   - 구독 완료 이벤트
   - 에러 발생 이벤트
