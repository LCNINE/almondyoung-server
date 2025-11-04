# 마이페이지 도메인 리팩토링 명세서

## 1. 개요

마이페이지 관련 코드를 도메인 중심 아키텍처로 리팩토링하여 응집도를 높이고 결합도를 낮춥니다.

### 리팩토링 목표

1. **도메인 중심 구조**: 함께 수정되는 코드를 같은 디렉토리에 배치
2. **수평적 구조**: depth를 줄이고 도메인을 수평적으로 배치
3. **라우팅 분리**: `app/` 폴더는 오로지 라우팅만을 위한 용도로 사용
4. **명확한 의존성**: 도메인 간 의존성을 명확하게 파악 가능하도록 구조화

### 참조 규칙

- [프론트엔드 코드 작성 규칙: 응집도 및 결합도](./.kiro/steering/frontend-cohesion-coupling.md)
- [프론트엔드 코드 작성 규칙: 컴포넌트 및 아키텍처](./.kiro/steering/frontend-component-architecture.md)
- [프론트엔드 코드 작성 규칙: 가독성 및 예측 가능성](./.kiro/steering/frontend-readability-predictability.md)

---

## 2. 현재 구조

```text
src/
├── app/
│   └── [countryCode]/
│       └── mypage/
│           ├── [section]/
│           │   ├── components/        # 섹션별 페이지 컴포넌트
│           │   └── page.tsx
│           ├── components/
│           │   ├── client/            # 클라이언트 전용 컴포넌트
│           │   ├── desktop/           # 데스크톱 레이아웃 컴포넌트
│           │   ├── mobile/            # 모바일 레이아웃 컴포넌트
│           │   ├── order-list/        # 주문 목록 관련 컴포넌트
│           │   └── shared/            # 공유 컴포넌트
│           ├── hooks/
│           │   └── use-user-info.ts
│           ├── order/
│           │   └── list/
│           │       ├── components/
│           │       ├── hooks/
│           │       └── page.tsx
│           ├── constants.ts
│           ├── sidebar-constants.ts
│           ├── sidebar-types.ts
│           ├── types.ts
│           ├── layout.tsx
│           └── page.tsx
└── components/
    ├── orders/                        # 주문 관련 공통 컴포넌트
    └── ...
```

### 문제점

1. **라우팅과 로직의 혼재**: `app/` 폴더에 컴포넌트, hooks, types 등이 모두 포함
2. **불명확한 도메인 경계**: mypage와 order가 계층적으로 구성되어 있어 수평적 구조가 아님
3. **분산된 관련 코드**: 주문 관련 컴포넌트가 `components/orders/`와 `mypage/order/`에 분산
4. **깊은 depth**: `mypage/order/list/components/` 등 4depth 이상의 구조

---

## 3. 목표 구조

```text
src/
├── app/
│   └── [countryCode]/
│       └── mypage/
│           ├── [section]/
│           │   └── page.tsx          # 라우팅만 담당
│           ├── order/
│           │   └── list/
│           │       └── page.tsx      # 라우팅만 담당
│           ├── layout.tsx            # 레이아웃만 담당
│           └── page.tsx              # 라우팅만 담당
│
├── domains/
│   ├── mypage/                       # 마이페이지 도메인 (수평적 배치)
│   │   ├── components/
│   │   │   ├── desktop/
│   │   │   │   ├── desktop-layout.tsx
│   │   │   │   ├── mypage-sidebar.tsx
│   │   │   │   ├── payment-info-section.tsx
│   │   │   │   ├── quick-menu-section.tsx
│   │   │   │   ├── recommended-products-section.tsx
│   │   │   │   ├── shipping-items-section.tsx
│   │   │   │   ├── shipping-item-card.atomic.tsx
│   │   │   │   └── user-profile-section.tsx
│   │   │   ├── mobile/
│   │   │   │   ├── mobile-layout.tsx
│   │   │   │   ├── mobile-header.tsx
│   │   │   │   ├── menu-list.tsx
│   │   │   │   ├── quick-links.tsx
│   │   │   │   ├── payment-banner.tsx
│   │   │   │   ├── points-banner.tsx
│   │   │   │   ├── savings-banner.tsx
│   │   │   │   └── shipping-item.tsx
│   │   │   ├── client/
│   │   │   │   ├── add-to-cart-button.tsx
│   │   │   │   ├── logout-button.tsx
│   │   │   │   └── shipping-action-buttons.tsx
│   │   │   └── shared/
│   │   │       ├── order-cards-list.tsx
│   │   │       └── shipping-item-card.tsx
│   │   ├── hooks/
│   │   │   └── use-user-info.ts
│   │   ├── constants/
│   │   │   ├── mypage-constants.ts   # 기존 constants.ts
│   │   │   ├── sidebar-constants.ts
│   │   │   └── menu-constants.ts     # 메뉴 관련 상수 분리
│   │   ├── types/
│   │   │   ├── mypage-types.ts       # 기존 types.ts
│   │   │   └── sidebar-types.ts
│   │   └── index.ts                  # Public API 정의
│   │
│   └── order-list/                   # 주문 목록 도메인 (수평적 배치)
│       ├── components/
│       │   ├── desktop/
│       │   │   └── order-list-desktop.tsx
│       │   ├── mobile/
│       │   │   └── order-list-mobile.tsx
│       │   └── shared/
│       │       ├── order-filter.tsx
│       │       ├── order-search.tsx
│       │       └── frequent-products.tsx
│       ├── hooks/
│       │   └── use-order-list.ts
│       ├── types/
│       │   └── order-list-types.ts
│       └── index.ts                  # Public API 정의
│
└── components/
    └── ...                           # 전역 공통 컴포넌트만 유지
```

### 구조 설명

#### 1. 도메인의 수평적 배치

```text
domains/
├── mypage/          # 마이페이지 메인 도메인
└── order-list/      # 주문 목록 도메인
```

- `order-list`는 UI상 `mypage`의 하위 페이지이지만, **도메인 레벨에서는 수평적으로 배치**
- 각 도메인은 독립적으로 관리되며, 서로 다른 도메인의 코드를 직접 참조하지 않음
- 필요시 `domains/mypage/index.ts`를 통해 Public API로 export된 것만 사용

#### 2. app/ 폴더의 역할

```text
app/[countryCode]/mypage/
├── [section]/
│   └── page.tsx           # import { SectionPage } from '@/domains/mypage'
├── order/
│   └── list/
│       └── page.tsx       # import { OrderListPage } from '@/domains/order-list'
├── layout.tsx             # import { MypageLayout } from '@/domains/mypage'
└── page.tsx               # import { MypageDashboard } from '@/domains/mypage'
```

- **라우팅만을 담당**: 실제 로직은 `domains/` 에서 import
- Next.js의 App Router 규칙에 따른 파일 구조만 유지
- 비즈니스 로직, 컴포넌트, hooks, types 등은 모두 `domains/`로 이동

#### 3. 도메인 내부 구조

각 도메인은 다음과 같은 일관된 구조를 가집니다:

```text
domain-name/
├── components/           # 이 도메인에서만 사용되는 컴포넌트
│   ├── desktop/         # 데스크톱 전용 컴포넌트
│   ├── mobile/          # 모바일 전용 컴포넌트
│   ├── shared/          # 데스크톱/모바일 공통 컴포넌트
│   └── ...              # 기타 컴포넌트 그룹
├── hooks/               # 이 도메인에서만 사용되는 hooks
├── constants/           # 이 도메인에서만 사용되는 상수
├── types/               # 이 도메인에서만 사용되는 타입
└── index.ts             # Public API (다른 도메인에서 사용 가능한 것만 export)
```

---

## 4. 이동 계획

### Phase 1: 도메인 폴더 생성 및 기본 구조 설정

1. `src/domains/` 폴더 생성
2. `src/domains/mypage/` 폴더 생성
3. `src/domains/order-list/` 폴더 생성
4. 각 도메인 내에 기본 폴더 구조 생성 (`components/`, `hooks/`, `constants/`, `types/`)

### Phase 2: mypage 도메인 코드 이동

#### 2.1 컴포넌트 이동

**Source → Target**

```
src/app/[countryCode]/mypage/components/desktop/
→ src/domains/mypage/components/desktop/

src/app/[countryCode]/mypage/components/mobile/
→ src/domains/mypage/components/mobile/

src/app/[countryCode]/mypage/components/client/
→ src/domains/mypage/components/client/

src/app/[countryCode]/mypage/components/shared/
→ src/domains/mypage/components/shared/
```

#### 2.2 Hooks 이동

```
src/app/[countryCode]/mypage/hooks/
→ src/domains/mypage/hooks/
```

#### 2.3 상수 및 타입 이동

```
src/app/[countryCode]/mypage/constants.ts
→ src/domains/mypage/constants/mypage-constants.ts

src/app/[countryCode]/mypage/sidebar-constants.ts
→ src/domains/mypage/constants/sidebar-constants.ts

src/app/[countryCode]/mypage/types.ts
→ src/domains/mypage/types/mypage-types.ts

src/app/[countryCode]/mypage/sidebar-types.ts
→ src/domains/mypage/types/sidebar-types.ts
```

### Phase 3: order-list 도메인 코드 이동

#### 3.1 컴포넌트 이동

**Source → Target**

```
src/app/[countryCode]/mypage/order/list/components/desktop/
→ src/domains/order-list/components/desktop/

src/app/[countryCode]/mypage/order/list/components/mobile/
→ src/domains/order-list/components/mobile/

src/app/[countryCode]/mypage/components/order-list/
→ src/domains/order-list/components/shared/
```

#### 3.2 Hooks 이동

```
src/app/[countryCode]/mypage/order/list/hooks/
→ src/domains/order-list/hooks/
```

#### 3.3 타입 이동

```
src/app/[countryCode]/mypage/order/list/types.ts
→ src/domains/order-list/types/order-list-types.ts
```

### Phase 4: app/ 폴더 정리

#### 4.1 라우팅 파일만 유지

각 `page.tsx`는 해당 도메인의 컴포넌트를 import만 함:

**mypage/page.tsx**

```tsx
import { MypageDashboard } from "@/domains/mypage"

export default function MypagePage() {
  return <MypageDashboard />
}
```

**mypage/order/list/page.tsx**

```tsx
import { OrderListPage } from "@/domains/order-list"

export default function Page() {
  return <OrderListPage />
}
```

**mypage/layout.tsx**

```tsx
import { MypageLayout } from "@/domains/mypage"

export default function Layout({ children }: { children: React.ReactNode }) {
  return <MypageLayout>{children}</MypageLayout>
}
```

#### 4.2 삭제할 폴더

- `src/app/[countryCode]/mypage/components/` (전체)
- `src/app/[countryCode]/mypage/hooks/` (전체)
- `src/app/[countryCode]/mypage/order/list/components/` (전체)
- `src/app/[countryCode]/mypage/order/list/hooks/` (전체)

#### 4.3 삭제할 파일

- `src/app/[countryCode]/mypage/constants.ts`
- `src/app/[countryCode]/mypage/sidebar-constants.ts`
- `src/app/[countryCode]/mypage/sidebar-types.ts`
- `src/app/[countryCode]/mypage/types.ts`
- `src/app/[countryCode]/mypage/order/list/types.ts`

### Phase 5: Public API 정의 (index.ts)

#### 5.1 mypage/index.ts

```typescript
// Layouts
export { default as MypageLayout } from "./components/desktop/desktop-layout"
export { default as MobileMypageLayout } from "./components/mobile/mobile-layout"

// Pages
export { default as MypageDashboard } from "./components/mypage-dashboard"

// Shared Components (다른 도메인에서 사용 가능)
export { default as ShippingItemCard } from "./components/shared/shipping-item-card"
export { default as OrderCardsList } from "./components/shared/order-cards-list"

// Hooks (다른 도메인에서 사용 가능)
export { useUserInfo } from "./hooks/use-user-info"

// Types (다른 도메인에서 사용 가능)
export type * from "./types/mypage-types"
export type * from "./types/sidebar-types"

// Constants (다른 도메인에서 사용 가능)
export * from "./constants/mypage-constants"
export * from "./constants/sidebar-constants"
```

#### 5.2 order-list/index.ts

```typescript
// Page
export { default as OrderListPage } from "./components/order-list-page"

// Desktop Components
export { default as OrderListDesktop } from "./components/desktop/order-list-desktop"

// Mobile Components
export { default as OrderListMobile } from "./components/mobile/order-list-mobile"

// Shared Components
export { default as OrderFilter } from "./components/shared/order-filter"
export { default as OrderSearch } from "./components/shared/order-search"
export { default as FrequentProducts } from "./components/shared/frequent-products"

// Hooks
export { useOrderList } from "./hooks/use-order-list"

// Types
export type * from "./types/order-list-types"
```

### Phase 6: Import 경로 수정

#### 6.1 절대 경로 패턴

```typescript
// Before
import { Component } from "../components/desktop/component"
import { useHook } from "../../hooks/use-hook"

// After
import { Component } from "@/domains/mypage"
import { useHook } from "@/domains/mypage"
```

#### 6.2 도메인 간 참조

```typescript
// ❌ 나쁜 예: 직접 참조
import { Component } from "@/domains/mypage/components/desktop/component"

// ✅ 좋은 예: Public API를 통한 참조
import { Component } from "@/domains/mypage"
```

---

## 5. 주요 원칙

### 5.1 도메인 독립성

- 각 도메인은 자신의 책임 범위 내에서만 코드를 관리
- 다른 도메인의 코드를 직접 참조하지 않음
- 필요한 경우 Public API(`index.ts`)를 통해서만 접근

### 5.2 수평적 구조

```text
❌ 나쁜 예: 계층적 구조
domains/
└── mypage/
    └── order-list/    # mypage의 하위로 배치

✅ 좋은 예: 수평적 구조
domains/
├── mypage/           # 수평적 배치
└── order-list/       # 수평적 배치
```

### 5.3 컴포넌트 그룹화 기준

컴포넌트는 다음 기준으로 그룹화합니다:

1. **플랫폼별**: `desktop/`, `mobile/`
2. **공유 여부**: `shared/` (플랫폼 무관)
3. **클라이언트 전용**: `client/` (useClient 필요)
4. **기능별**: `sections/`, `filters/` 등

### 5.4 명명 규칙

파일 및 폴더명은 **kebab-case**를 사용합니다 [[memory:3968396]]:

```text
✅ 좋은 예:
- order-list-desktop.tsx
- use-order-list.ts
- mypage-constants.ts
- shipping-item-card.tsx

❌ 나쁜 예:
- OrderListDesktop.tsx
- useOrderList.ts
- mypageConstants.ts
- ShippingItemCard.tsx
```

### 5.5 index.ts의 역할

`index.ts`는 해당 도메인의 **Public API**를 정의합니다:

```typescript
// ✅ Export 해야 하는 것:
// - 다른 도메인에서 사용할 수 있는 컴포넌트
// - 다른 도메인에서 사용할 수 있는 hooks
// - 다른 도메인에서 사용할 수 있는 types
// - 라우팅 페이지에서 사용할 컴포넌트

// ❌ Export 하지 않아야 하는 것:
// - 도메인 내부에서만 사용하는 컴포넌트
// - 도메인 내부에서만 사용하는 유틸 함수
// - 도메인 내부에서만 사용하는 상수
```

---

## 6. 의존성 규칙

### 6.1 허용되는 의존성

```text
domains/mypage/
  ↓ (허용)
  components/common/        # 전역 공통 컴포넌트
  lib/                      # 유틸리티, API 클라이언트
  hooks/                    # 전역 공통 hooks

domains/order-list/
  ↓ (허용)
  domains/mypage/index.ts   # Public API를 통한 참조만 허용
  components/common/        # 전역 공통 컴포넌트
  lib/                      # 유틸리티, API 클라이언트
  hooks/                    # 전역 공통 hooks
```

### 6.2 금지되는 의존성

```text
❌ domains/order-list/ → domains/mypage/components/desktop/
   (Public API를 거치지 않은 직접 참조)

❌ domains/mypage/ → domains/order-list/
   (상위 도메인이 하위 도메인을 참조)

❌ domains/domain-a/ → domains/domain-b/hooks/
   (다른 도메인의 내부 파일 직접 참조)
```

### 6.3 의존성 검증 방법

리팩토링 후 다음 명령으로 잘못된 import를 검증할 수 있습니다:

```bash
# 도메인 간 직접 참조 검사
grep -r "from '@/domains/mypage/components" src/domains/order-list/

# app/ 폴더에서 비라우팅 import 검사
grep -r "from '../components" src/app/[countryCode]/mypage/
```

---

## 7. 마이그레이션 체크리스트

### Phase 1: 준비

- [ ] `src/domains/` 폴더 생성
- [ ] `src/domains/mypage/` 기본 구조 생성
- [ ] `src/domains/order-list/` 기본 구조 생성

### Phase 2: mypage 도메인

- [ ] 데스크톱 컴포넌트 이동
- [ ] 모바일 컴포넌트 이동
- [ ] 클라이언트 컴포넌트 이동
- [ ] 공유 컴포넌트 이동
- [ ] hooks 이동
- [ ] 상수 파일 이동 및 분리
- [ ] 타입 파일 이동 및 분리
- [ ] `mypage/index.ts` 작성

### Phase 3: order-list 도메인

- [ ] 데스크톱 컴포넌트 이동
- [ ] 모바일 컴포넌트 이동
- [ ] 공유 컴포넌트 이동
- [ ] hooks 이동
- [ ] 타입 파일 이동
- [ ] `order-list/index.ts` 작성

### Phase 4: app/ 폴더 정리

- [ ] `mypage/page.tsx` 리팩토링 (import만)
- [ ] `mypage/layout.tsx` 리팩토링 (import만)
- [ ] `mypage/order/list/page.tsx` 리팩토링 (import만)
- [ ] 불필요한 폴더/파일 삭제

### Phase 5: Import 경로 수정

- [ ] mypage 도메인 내부 import 경로 수정
- [ ] order-list 도메인 내부 import 경로 수정
- [ ] 도메인 간 참조를 Public API로 변경
- [ ] app/ 폴더의 import 경로 수정

### Phase 6: 검증

- [ ] TypeScript 타입 에러 확인
- [ ] 린터 에러 확인
- [ ] 빌드 성공 확인
- [ ] 개발 서버 실행 확인
- [ ] 의존성 규칙 준수 확인 (grep)

---

## 8. 기대 효과

### 8.1 응집도 향상

- **Before**: 관련 코드가 `app/`, `components/`, `hooks/` 등에 분산
- **After**: 관련 코드가 하나의 도메인 폴더 내에 응집

### 8.2 결합도 감소

- **Before**: 도메인 간 직접 참조로 결합도 높음
- **After**: Public API를 통한 간접 참조로 결합도 낮음

### 8.3 유지보수성 향상

- 특정 기능 삭제 시 도메인 폴더 전체를 삭제하면 됨
- 코드 수정 시 영향 범위를 도메인 단위로 파악 가능
- 새로운 기능 추가 시 새 도메인 폴더만 생성하면 됨

### 8.4 가독성 향상

- 라우팅 구조와 비즈니스 로직이 명확히 분리
- 도메인 간 의존성이 `index.ts`를 통해 명시적으로 드러남
- 파일 탐색 시 도메인 기준으로 쉽게 찾을 수 있음

### 8.5 확장성 향상

- 새로운 도메인 추가 시 기존 도메인에 영향 없음
- 도메인별로 독립적인 테스트 작성 가능
- 도메인별로 독립적인 문서화 가능

---

## 9. 참고 사항

### 9.1 점진적 마이그레이션

한 번에 모든 것을 리팩토링하지 않고, 다음 순서로 점진적으로 진행합니다:

1. 새 도메인 구조 생성 (기존 코드는 유지)
2. 도메인별로 하나씩 이동 (mypage → order-list)
3. import 경로 수정 및 검증
4. 기존 코드 삭제

### 9.2 커밋 전략

각 Phase를 개별 커밋으로 관리합니다:

```
feat(mypage): Phase 1 - 도메인 폴더 구조 생성
feat(mypage): Phase 2 - mypage 도메인 코드 이동
feat(mypage): Phase 3 - order-list 도메인 코드 이동
feat(mypage): Phase 4 - app 폴더 정리
feat(mypage): Phase 5 - import 경로 수정
test(mypage): Phase 6 - 리팩토링 검증
```

### 9.3 롤백 계획

각 Phase 완료 후 빌드가 성공하는지 확인하고, 실패 시 이전 커밋으로 롤백합니다.

---

## 10. 추가 개선 사항 (향후)

### 10.1 utils 추가

각 도메인에서 반복적으로 사용되는 유틸 함수는 `utils/` 폴더로 분리할 수 있습니다:

```text
domains/mypage/
├── components/
├── hooks/
├── constants/
├── types/
├── utils/              # 새로 추가
│   ├── format.ts
│   ├── validation.ts
│   └── helpers.ts
└── index.ts
```

### 10.2 스토리북 통합

각 도메인의 컴포넌트를 스토리북으로 문서화할 수 있습니다:

```text
domains/mypage/components/desktop/
├── desktop-layout.tsx
└── desktop-layout.stories.tsx
```

---

## 11. 결론

이 리팩토링을 통해 다음을 달성합니다:

1. ✅ **도메인 중심 아키텍처**: 관련 코드를 한곳에 모아 응집도 향상
2. ✅ **수평적 구조**: depth를 줄이고 도메인을 수평적으로 배치
3. ✅ **라우팅 분리**: app/ 폴더는 라우팅만 담당
4. ✅ **명확한 의존성**: Public API를 통한 명시적 의존성 관리
5. ✅ **유지보수성**: 코드 수정/삭제/추가 시 영향 범위를 명확히 파악

제공된 프론트엔드 코드 작성 규칙을 준수하여, 읽기 쉽고 유지보수하기 좋은 코드베이스를 구축합니다.
