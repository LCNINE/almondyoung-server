# 폴더 구조 가이드 - 캐시 지역성 원칙 기반

> **작성일**: 2025-01-XX  
> **원칙**: 함께 수정되는 파일을 같은 디렉토리에 두기  
> **참고**: [토스 Frontend Fundamentals - 함께 수정되는 파일을 같은 디렉토리에 두기](https://frontend-fundamentals.com/code-quality/code/examples/code-directory.html)

## 📚 목차

1. [캐시 지역성 원칙](#캐시-지역성-원칙)
2. [도메인 구조 규칙](#도메인-구조-규칙)
3. [표준 하위 구조](#표준-하위-구조)
4. [Container 패턴](#container-패턴)
5. [도메인 분리 가이드](#도메인-분리-가이드)
6. [마이그레이션 전략](#마이그레이션-전략)

---

## 캐시 지역성 원칙

### 개발자 캐시 히트율 향상

현대 컴퓨터 시스템의 캐시 지역성 원칙을 개발자 관점에 적용하면, **함께 수정되는 파일을 같은 디렉토리에 두는 것**이 핵심입니다.

### 시간 지역성 (Temporal Locality)

> 특정 기능을 수정한 후, 가까운 미래에 다시 수정할 가능성이 높다

**예시:**

- 버그 수정 후 코드 리뷰로 다시 수정
- 기능 개선을 위한 반복적인 수정
- A/B 테스트를 위한 변형

**적용:**

- 특정 기능의 모든 관련 파일을 한 폴더에 모음
- 기능 삭제 시 폴더 하나만 삭제하면 됨

### 공간 지역성 (Spatial Locality)

> 특정 기능을 수정할 때, 관련된 주변 코드들이 함께 변경될 가능성이 높다

**예시:**

- 컴포넌트 수정 시 관련 Hook, 타입, 스타일도 함께 수정
- API 변경 시 요청/응답 타입, 유효성 검사도 함께 수정
- 비즈니스 로직 변경 시 테스트 코드도 함께 수정

**적용:**

- 기능 단위로 `components`, `hooks`, `types`, `utils` 등을 묶음
- 도메인 간 잘못된 참조를 방지

---

## 도메인 구조 규칙

### 핵심 원칙: 데이터 관점에서 도메인 분리

**⚠️ 중요: UI에 종속되지 않고, 데이터 관점에서 도메인을 나눕니다.**

도메인은 비즈니스 데이터 모델을 기준으로 분리해야 합니다:

- **User 데이터** → `auth`, `mypage`, `settings`
- **Product 데이터** → `products`, `home`, `best`, `search`
- **Order 데이터** → `order`
- **Review 데이터** → `reviews`
- **Payment 데이터** → `payment-methods`, `payment`
- **Membership 데이터** → `membership`
- **Verification 데이터** → `verify`
- **WishList 데이터** → `wish-list`

**❌ 나쁜 예시 (UI 관점)**

```
domains/
├── desktop/        # 데스크톱 UI
├── mobile/         # 모바일 UI
└── tablet/         # 태블릿 UI
```

**✅ 좋은 예시 (데이터 관점)**

```
domains/
├── auth/           # User 인증 데이터
├── products/       # Product 데이터
├── order/          # Order 데이터
└── reviews/        # Review 데이터
```

### 기본 원칙

```
domains/
└── {domain}/           # 데이터 모델 기준 (User, Product, Order 등)
    └── {feature}/      # 기능 단위 (login, list, details 등)
        ├── components/     # 해당 기능의 컴포넌트
        ├── containers/     # 해당 기능의 컨테이너 (필요시)
        ├── hooks/          # 해당 기능의 훅 (필요시)
        ├── types/          # 해당 기능의 타입 (필요시)
        ├── schemas/        # 해당 기능의 스키마 (필요시)
        ├── utils/          # 해당 기능의 유틸 (필요시)
        ├── api/            # 해당 기능의 API (필요시)
        └── templates/      # 해당 기능의 템플릿 (필요시)
```

### 규칙 1: 기능 단위 중심 구조

**❌ 나쁜 예시 (타입 기반 분리)**

```
auth/
├── components/
│   ├── login/
│   ├── signup/
│   └── account-find/
├── hooks/
├── schemas/
└── templates/
```

**✅ 좋은 예시 (기능 기반 분리)**

```
auth/
├── login/              # 로그인 기능 전체
│   ├── components/
│   ├── hooks/
│   ├── schemas/
│   └── templates/
├── signup/             # 회원가입 기능 전체
│   ├── components/
│   ├── hooks/
│   ├── schemas/
│   └── templates/
└── account-find/       # 계정 찾기 기능 전체
    ├── components/
    └── hooks/
```

### 규칙 2: 함께 수정되는 파일 묶기

**판단 기준:**

1. 기능 A를 수정할 때 B도 함께 수정되는가?
2. 기능 A를 삭제할 때 B도 함께 삭제되는가?
3. 기능 A를 이해하려면 B도 함께 봐야 하는가?

**예시:**

- `order/list`의 컴포넌트, 훅, 타입은 함께 수정됨 → 같은 폴더
- `reviews/manage`의 컴포넌트, 훅, 유틸은 함께 수정됨 → 같은 폴더

### 규칙 3: 도메인 경계 명확히 하기

**❌ 나쁜 예시**

```typescript
// order/list에서 auth의 컴포넌트를 참조
import { LoginForm } from "../../auth/components/login"
```

**✅ 좋은 예시**

```typescript
// order/list에서 auth를 참조하려면 명확한 경로
import { LoginForm } from "../../auth/login/components"
// → "이건 다른 도메인이네?" 라고 쉽게 인지 가능
```

---

## 표준 하위 구조

### 필수 폴더

#### `components/`

- 해당 기능의 Presentational 컴포넌트
- 재사용 가능한 UI 컴포넌트
- 기능별로 독립적으로 관리

#### `containers/` (필요시)

- 비즈니스 로직이 있는 Container 컴포넌트
- 데이터 fetching 및 상태 관리
- 여러 컴포넌트를 조합하는 상위 컴포넌트

### 선택 폴더 (필요시만 생성)

#### `hooks/`

- 해당 기능에 특화된 커스텀 훅
- 전역 훅은 `src/hooks/`에 위치

#### `types/`

- 해당 기능에 특화된 타입 정의
- 전역 타입은 `src/types/`에 위치

#### `schemas/`

- 폼 유효성 검사 스키마 (zod, yup 등)
- API 요청/응답 스키마

#### `utils/`

- 해당 기능에 특화된 유틸리티 함수
- 전역 유틸은 `src/lib/`에 위치

#### `api/`

- 해당 기능의 API 호출 함수
- 도메인별 API 클라이언트

#### `templates/`

- 페이지 레이아웃 템플릿
- 여러 섹션을 조합하는 상위 컴포넌트

### 폴더 구조 예시

```
domains/
├── auth/
│   ├── login/
│   │   ├── components/
│   │   │   ├── login-form.tsx
│   │   │   └── kakao-login-btn.tsx
│   │   ├── hooks/
│   │   │   └── use-auth-storage.ts
│   │   ├── schemas/
│   │   │   └── signin-schema.ts
│   │   └── templates/
│   │       └── login-template.tsx
│   └── signup/
│       ├── components/
│       ├── hooks/
│       ├── schemas/
│       └── templates/
│
├── order/
│   ├── list/
│   │   ├── components/
│   │   │   ├── order-list-client.tsx
│   │   │   └── shared/
│   │   ├── containers/
│   │   │   └── order-list-container.tsx
│   │   ├── hooks/
│   │   │   └── use-order-list.ts
│   │   └── types/
│   │       └── order-list-types.ts
│   └── details/
│       ├── components/
│       └── containers/
│
└── reviews/
    ├── create/
    │   └── components/
    ├── manage/
    │   ├── components/
    │   ├── containers/
    │   ├── hooks/
    │   ├── types/
    │   └── utils/
    └── ui/              # 도메인 내 공유 컴포넌트
        └── components/
```

---

## Container 패턴

### Container란?

**Container 컴포넌트**는 비즈니스 로직과 데이터 fetching을 담당하는 컴포넌트입니다.

### Container 사용 기준

**Container를 사용하는 경우:**

- 데이터 fetching이 필요한 경우
- 여러 컴포넌트를 조합하여 복잡한 로직을 처리하는 경우
- 상태 관리가 복잡한 경우
- 서버 컴포넌트와 클라이언트 컴포넌트를 분리해야 하는 경우

**Container를 사용하지 않는 경우:**

- 단순한 Presentational 컴포넌트만 있는 경우
- 비즈니스 로직이 없는 경우

### Container 구조

```
{feature}/
├── components/          # Presentational 컴포넌트
│   ├── feature-form.tsx
│   └── feature-list.tsx
├── containers/          # Container 컴포넌트
│   ├── feature-container.tsx
│   └── feature-form-container.tsx
└── hooks/
    └── use-feature.ts
```

### Container 예시

```typescript
// containers/order-list-container.tsx
'use client'

import { useOrderList } from '../hooks/use-order-list'
import { OrderListClient } from '../components/order-list-client'

export function OrderListContainer() {
  const { orders, isLoading, error } = useOrderList()

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>

  return <OrderListClient orders={orders} />
}
```

```typescript
// components/order-list-client.tsx
'use client'

interface OrderListClientProps {
  orders: Order[]
}

export function OrderListClient({ orders }: OrderListClientProps) {
  return (
    <div>
      {orders.map(order => (
        <OrderCard key={order.id} order={order} />
      ))}
    </div>
  )
}
```

---

## 도메인 분리 가이드

### 결제 vs 결제수단 분리

#### 현재 상황 분석

**`payment-methods` 도메인:**

- 결제수단 추가/삭제/조회
- 결제수단 관리 UI
- 프로필 관리

**실제 결제 플로우:**

- 결제 Intent 생성
- 결제 실행
- 결제 승인/취소
- 환불 처리

#### 분리 기준: 캐시 지역성 관점

**함께 수정되는 파일 그룹:**

1. **결제수단 관리 그룹**
   - 결제수단 추가 폼
   - 결제수단 목록
   - 결제수단 삭제
   - 프로필 API
   - → **함께 수정됨**: 결제수단 관리 기능 개선 시 모두 수정

2. **결제 실행 그룹**
   - 결제 Intent 생성
   - 결제 실행 로직
   - 결제 승인/취소
   - 결제 결과 처리
   - → **함께 수정됨**: 결제 플로우 변경 시 모두 수정

3. **결제수단 선택 그룹** (경계 영역)
   - 체크아웃에서 결제수단 선택
   - 결제수단 목록 표시
   - → **함께 수정됨**: 체크아웃 플로우와 결제수단 선택 UI

#### 제안 1: 분리 유지 (권장)

```
domains/
├── payment-methods/        # 결제수단 관리
│   ├── add/
│   │   ├── components/
│   │   └── api/
│   ├── list/
│   │   ├── components/
│   │   └── api/
│   ├── delete/
│   │   └── components/
│   └── bnpl/
│       └── components/
│
└── payment/                # 실제 결제 실행 (신규)
    ├── checkout/           # 체크아웃 결제
    │   ├── components/
    │   ├── containers/
    │   └── hooks/
    ├── intent/             # 결제 Intent 관리
    │   ├── components/
    │   └── api/
    └── refund/             # 환불 처리
        ├── components/
        └── api/
```

**장점:**

- 결제수단 관리와 결제 실행이 명확히 분리됨
- 각각 독립적으로 수정 가능
- 도메인 경계가 명확함

**단점:**

- 결제수단 선택 UI가 두 도메인에 걸칠 수 있음

**해결책:**

- 체크아웃에서 결제수단 선택 시 `payment-methods/list` 컴포넌트 재사용
- 또는 `payment/checkout`에서 `payment-methods`를 의존성으로 가짐

#### 제안 2: 통합 (대안)

```
domains/
└── payment/
    ├── methods/            # 결제수단 관리
    │   ├── add/
    │   ├── list/
    │   └── delete/
    ├── checkout/           # 체크아웃 결제
    ├── intent/             # 결제 Intent 관리
    └── refund/             # 환불 처리
```

**장점:**

- 결제 관련 모든 것이 한 곳에
- 결제수단 선택과 결제 실행이 가까움

**단점:**

- 도메인이 커질 수 있음
- 결제수단 관리만 필요한 경우에도 payment 도메인을 봐야 함

#### 최종 권장사항

**제안 1 (분리 유지)을 권장합니다.**

**이유:**

1. **캐시 지역성**: 결제수단 관리와 결제 실행은 서로 다른 수정 주기를 가짐
2. **명확한 책임**: 결제수단 관리 vs 결제 실행은 다른 비즈니스 로직
3. **확장성**: 각 도메인이 독립적으로 성장 가능

**경계 처리:**

```typescript
// payment/checkout에서 payment-methods 재사용
import { PaymentMethodsList } from '@/domains/payment-methods'

export function CheckoutPaymentSection() {
  return (
    <div>
      <PaymentMethodsList onSelect={handleSelect} />
      {/* 결제 실행 로직 */}
    </div>
  )
}
```

### 다른 도메인 분리 예시

#### 주문 (Order) 도메인

```
order/
├── list/           # 주문 목록
├── details/        # 주문 상세
├── exchange/       # 교환/반품
├── track/          # 배송 추적
└── success/        # 주문 완료
```

**분리 기준:**

- 각 기능이 독립적인 페이지/플로우
- 함께 수정되는 파일이 명확히 구분됨

#### 리뷰 (Reviews) 도메인

```
reviews/
├── create/         # 리뷰 작성
├── manage/         # 리뷰 관리
├── details/        # 리뷰 상세
├── summary/        # 리뷰 요약
└── ui/             # 공유 UI 컴포넌트
```

**분리 기준:**

- 각 기능이 독립적인 사용자 플로우
- `ui/`는 도메인 내 공유 컴포넌트

---

## 마이그레이션 전략

### 단계적 적용

#### 1단계: 새 기능부터 규칙 적용

- 새로운 기능 개발 시 가이드 준수
- 기존 코드는 유지

#### 2단계: 수정 시 리팩토링

- 기존 도메인 수정 시 기회가 되면 리팩토링
- 큰 변경 없이 점진적 개선

#### 3단계: 우선순위 기반 리팩토링

**높은 우선순위:**

- `auth`: 복잡도 높음, 자주 수정됨
- `order`: 여러 하위 기능, 복잡한 구조
- `reviews`: 여러 하위 기능, 복잡한 구조

**중간 우선순위:**

- `payment-methods`: 구조 개선 필요
- `mypage`: 여러 섹션, 구조 정리 필요

**낮은 우선순위:**

- `home`: 상대적으로 단순
- `best`: 상대적으로 단순
- `search`: 상대적으로 단순

### 검증 기준

리팩토링 후 다음을 확인:

1. **함께 수정되는 파일이 같은 폴더에 있는가?**

   ```bash
   # 예: 로그인 기능 수정 시
   domains/auth/login/  # 모든 관련 파일이 여기에
   ```

2. **기능 삭제 시 폴더 하나만 삭제하면 되는가?**

   ```bash
   # 예: 계정 찾기 기능 삭제
   rm -rf domains/auth/account-find  # 끝!
   ```

3. **다른 도메인에서 잘못 참조하기 어려운가?**

   ```typescript
   // 나쁜 예: 타입 기반 분리
   import { LoginForm } from "../../auth/components/login"

   // 좋은 예: 기능 기반 분리
   import { LoginForm } from "../../auth/login/components"
   // → "이건 다른 도메인이네?" 라고 쉽게 인지
   ```

4. **개발자 캐시 히트율이 높아졌는가?**
   - 특정 기능 작업 시 관련 파일을 빠르게 찾을 수 있는가?
   - 프로젝트 맥락 파악에 드는 시간이 줄었는가?

---

## 체크리스트

새로운 기능을 추가할 때:

- [ ] 기능 단위로 폴더를 만들었는가?
- [ ] 함께 수정되는 파일을 같은 폴더에 두었는가?
- [ ] 표준 하위 구조를 따르고 있는가? (`components`, `hooks`, `types` 등)
- [ ] Container가 필요한가? 필요하다면 `containers/` 폴더를 만들었는가?
- [ ] 도메인 경계가 명확한가? 다른 도메인을 참조할 때 경로가 명확한가?
- [ ] 기능 삭제 시 폴더 하나만 삭제하면 되는가?

---

## 참고 자료

- [토스 Frontend Fundamentals - 함께 수정되는 파일을 같은 디렉토리에 두기](https://frontend-fundamentals.com/code-quality/code/examples/code-directory.html)
- [Feature-Sliced Design](https://feature-sliced.design/)
- [React Container/Presentational Pattern](https://www.patterns.dev/posts/presentational-container-pattern)

---

---

## 최종 제안 구조 (완성본)

### 전체 도메인 구조

데이터 관점에서 분리된 최종 도메인 구조입니다.

```
domains/
├── auth/                    # 사용자 인증 데이터 (User, Profile, Session)
│   ├── login/
│   │   ├── components/
│   │   ├── containers/
│   │   ├── hooks/
│   │   ├── schemas/
│   │   └── templates/
│   ├── signup/
│   │   ├── components/
│   │   ├── containers/
│   │   ├── hooks/
│   │   ├── schemas/
│   │   └── templates/
│   └── account-find/
│       ├── components/
│       └── hooks/
│
├── products/                # 상품 데이터 (Product, Variant, Option)
│   ├── list/                # 상품 목록
│   │   ├── components/
│   │   ├── containers/
│   │   └── hooks/
│   ├── details/             # 상품 상세
│   │   ├── components/
│   │   ├── containers/
│   │   └── hooks/
│   ├── search/              # 상품 검색
│   │   ├── components/
│   │   ├── containers/
│   │   └── hooks/
│   ├── best/                 # 베스트 상품
│   │   ├── components/
│   │   └── containers/
│   └── home/                 # 홈 상품 목록
│       ├── components/
│       ├── containers/
│       └── templates/
│
├── order/                   # 주문 데이터 (Order, OrderItem)
│   ├── list/                # 주문 목록
│   │   ├── components/
│   │   ├── containers/
│   │   ├── hooks/
│   │   └── types/
│   ├── details/             # 주문 상세
│   │   ├── components/
│   │   └── containers/
│   ├── exchange/            # 교환/반품
│   │   ├── components/
│   │   └── containers/
│   ├── track/               # 배송 추적
│   │   └── components/
│   └── success/             # 주문 완료
│       └── components/
│
├── reviews/                 # 리뷰 데이터 (Review, ReviewComment)
│   ├── create/              # 리뷰 작성
│   │   ├── components/
│   │   └── containers/
│   ├── manage/              # 리뷰 관리
│   │   ├── components/
│   │   ├── containers/
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   ├── details/             # 리뷰 상세
│   │   └── components/
│   ├── summary/             # 리뷰 요약
│   │   └── components/
│   └── ui/                  # 도메인 내 공유 UI
│       └── components/
│
├── payment-methods/         # 결제수단 데이터 (PaymentProfile)
│   ├── add/                 # 결제수단 추가
│   │   ├── components/
│   │   └── api/
│   ├── list/                # 결제수단 목록
│   │   ├── components/
│   │   └── api/
│   ├── delete/              # 결제수단 삭제
│   │   └── components/
│   └── bnpl/                # BNPL 관리
│       └── components/
│
├── payment/                 # 결제 실행 데이터 (PaymentIntent, PaymentAttempt)
│   ├── checkout/            # 체크아웃 결제
│   │   ├── components/
│   │   ├── containers/
│   │   └── hooks/
│   ├── intent/              # 결제 Intent 관리
│   │   ├── components/
│   │   └── api/
│   └── refund/              # 환불 처리
│       ├── components/
│       ├── containers/
│       └── api/
│
├── membership/              # 멤버십 데이터 (Membership, Subscription)
│   ├── subscribe/           # 멤버십 구독
│   │   ├── components/
│   │   ├── containers/
│   │   └── api/
│   ├── manage/              # 멤버십 관리
│   │   ├── components/
│   │   └── containers/
│   └── benefits/            # 멤버십 혜택
│       └── components/
│
├── mypage/                  # 사용자 정보 데이터 (UserProfile, Settings)
│   ├── profile/             # 프로필 관리
│   │   ├── components/
│   │   └── containers/
│   ├── dashboard/           # 대시보드
│   │   ├── components/
│   │   ├── containers/
│   │   └── hooks/
│   └── settings/            # 설정 관리
│       ├── components/
│       └── containers/
│
├── verify/                  # 인증 데이터 (Verification)
│   ├── phone/               # 전화번호 인증
│   │   ├── components/
│   │   └── containers/
│   ├── business/            # 사업자 인증
│   │   ├── components/
│   │   └── containers/
│   └── bank/                # 계좌 인증
│       └── components/
│
├── wish-list/               # 찜 목록 데이터 (WishList)
│   ├── list/                # 찜 목록 조회
│   │   ├── components/
│   │   └── containers/
│   └── manage/              # 찜 목록 관리
│       ├── components/
│       └── hooks/
│
└── settings/                # 설정 데이터 (UserSettings, AppSettings)
    ├── account/             # 계정 설정
    │   ├── components/
    │   └── containers/
    ├── notification/       # 알림 설정
    │   ├── components/
    │   └── containers/
    └── privacy/             # 개인정보 설정
        ├── components/
        └── containers/
```

### 데이터 관점 검증

각 도메인이 명확한 데이터 모델을 가지고 있는지 확인:

| 도메인            | 핵심 데이터 모델              | 검증                  |
| ----------------- | ----------------------------- | --------------------- |
| `auth`            | User, Profile, Session        | ✅ 사용자 인증 데이터 |
| `products`        | Product, Variant, Option      | ✅ 상품 데이터        |
| `order`           | Order, OrderItem              | ✅ 주문 데이터        |
| `reviews`         | Review, ReviewComment         | ✅ 리뷰 데이터        |
| `payment-methods` | PaymentProfile                | ✅ 결제수단 데이터    |
| `payment`         | PaymentIntent, PaymentAttempt | ✅ 결제 실행 데이터   |
| `membership`      | Membership, Subscription      | ✅ 멤버십 데이터      |
| `mypage`          | UserProfile                   | ✅ 사용자 정보 데이터 |
| `verify`          | Verification                  | ✅ 인증 데이터        |
| `wish-list`       | WishList                      | ✅ 찜 목록 데이터     |
| `settings`        | UserSettings                  | ✅ 설정 데이터        |

### 주요 변경 사항

#### 1. `home`, `best`, `search` → `products` 하위로 통합

**이유:**

- 모두 Product 데이터를 다룸
- 함께 수정될 가능성이 높음 (상품 목록 UI 변경 시)
- 데이터 관점에서 동일한 도메인

**변경 전:**

```
domains/
├── home/
├── best/
├── search/
└── products/
```

**변경 후:**

```
domains/
└── products/
    ├── list/        # 기존 products/product-details
    ├── details/     # 기존 products/product-details
    ├── search/      # 기존 search
    ├── best/        # 기존 best
    └── home/        # 기존 home
```

#### 2. `payment` 도메인 신규 생성

**이유:**

- 결제수단 관리(`payment-methods`)와 결제 실행(`payment`)은 다른 데이터 모델
- 결제 실행은 PaymentIntent, PaymentAttempt 데이터를 다룸
- 함께 수정되는 파일 그룹이 다름

#### 3. `mypage` 구조 개선

**변경 전:**

```
mypage/
├── components/
│   ├── desktop/
│   └── mobile/
└── template/
```

**변경 후:**

```
mypage/
├── profile/         # 프로필 관리
├── dashboard/       # 대시보드 (기존 desktop/mobile 통합)
└── settings/        # 설정 관리
```

**이유:**

- UI 기반(desktop/mobile)이 아닌 기능 기반으로 분리
- 함께 수정되는 파일을 묶음

#### 4. `settings` 도메인 분리

**이유:**

- `mypage`와 `settings`는 다른 데이터 모델
- 설정은 독립적으로 관리되는 데이터

### 구현 우선순위

#### Phase 1: 핵심 도메인 리팩토링 (높은 우선순위)

1. `auth` - 기능 단위로 재구조화
2. `order` - 이미 기능 단위로 잘 구성됨 (유지)
3. `reviews` - 이미 기능 단위로 잘 구성됨 (유지)

#### Phase 2: 통합 및 개선 (중간 우선순위)

4. `products` - home, best, search 통합
5. `payment-methods` - 구조 개선
6. `payment` - 신규 도메인 생성
7. `mypage` - 기능 단위로 재구조화

#### Phase 3: 정리 및 완성 (낮은 우선순위)

8. `membership` - 구조 개선
9. `verify` - 구조 개선
10. `wish-list` - 구조 개선
11. `settings` - 신규 도메인 생성

### 마이그레이션 예시

#### 예시 1: `home` → `products/home` 마이그레이션

**1단계: 새 구조 생성**

```bash
mkdir -p domains/products/home/{components,containers,templates}
```

**2단계: 파일 이동**

```bash
# 기존 파일 이동
mv domains/home/components/* domains/products/home/components/
mv domains/home/template/* domains/products/home/templates/
mv domains/home/home-*.tsx domains/products/home/containers/
```

**3단계: Import 경로 수정**

```typescript
// 변경 전
import { HomeTemplate } from "@/domains/home/template"

// 변경 후
import { HomeTemplate } from "@/domains/products/home/templates"
```

**4단계: 기존 폴더 삭제**

```bash
rm -rf domains/home
```

#### 예시 2: `auth` 기능 단위 재구조화

**1단계: 새 구조 생성**

```bash
mkdir -p domains/auth/{login,signup,account-find}/{components,hooks,schemas,templates}
```

**2단계: 파일 이동 및 분류**

```bash
# 로그인 관련 파일
mv domains/auth/components/login/* domains/auth/login/components/
mv domains/auth/hooks/use-auth-storage.ts domains/auth/login/hooks/
mv domains/auth/schemas/signin-schema.ts domains/auth/login/schemas/
mv domains/auth/templates/login-template.tsx domains/auth/login/templates/

# 회원가입 관련 파일
mv domains/auth/components/signup/* domains/auth/signup/components/
mv domains/auth/hooks/use-signup.ts domains/auth/signup/hooks/
mv domains/auth/schemas/signup-schema.ts domains/auth/signup/schemas/
mv domains/auth/templates/signup-template.tsx domains/auth/signup/templates/
```

**3단계: 공유 타입 처리**

```typescript
// domains/auth/types/index.ts (도메인 레벨 공유 타입)
export * from "./user"
```

---

**마지막 업데이트**: 2025-01-XX
