# 마이페이지 리팩토링 명세서

## 현재 코드의 문제점 분석

### 1. 응집도 및 결합도 문제

- **과도한 책임**: `MyPageHome` 컴포넌트가 472줄로 너무 많은 책임을 가지고 있음
- **매직 넘버**: 하드코딩된 상수들이 상수로 정의되지 않음
- **중복 코드**: 모바일/PC 버전에서 유사한 UI 로직이 중복됨

### 2. 컴포넌트 아키텍처 문제

- **구현 상세 미추상화**: 복잡한 UI 로직이 하나의 컴포넌트에 모두 포함됨
- **Props Drilling**: 불필요한 props 전달이 없지만, 컴포넌트 분리가 부족함
- **같이 실행되지 않는 코드**: 모바일/PC 버전이 하나의 컴포넌트에 혼재

### 3. 가독성 및 예측 가능성 문제

- **복잡한 조건**: 반응형 조건문이 복잡하게 중첩됨
- **매직 넘버**: 하드코딩된 값들이 상수로 정의되지 않음
- **시점 이동**: 긴 컴포넌트로 인해 코드를 위아래로 이동하며 읽어야 함

## 리팩토링 계획

### 1. 컴포넌트 분리 전략

#### 1.1 도메인별 컴포넌트 분리

```
src/app/[countryCode]/mypage/
├── components/
│   ├── user-profile-section.tsx      # 사용자 프로필 영역
│   ├── quick-links-section.tsx       # 퀵링크 메뉴
│   ├── shipping-items-section.tsx    # 배송 중 상품
│   ├── payment-info-section.tsx      # 결제 정보
│   ├── recommended-products-section.tsx # 추천 상품
│   ├── menu-list-section.tsx         # 메인 메뉴 리스트
│   └── banners/
│       ├── savings-banner.tsx        # 절약 금액 배너
│       ├── points-banner.tsx         # 적립금 배너
│       └── payment-banner.tsx        # 결제 배너
```

#### 1.2 반응형 컴포넌트 분리

```
src/app/[countryCode]/mypage/
├── layouts/
│   ├── mobile-layout.tsx             # 모바일 레이아웃
│   └── desktop-layout.tsx            # 데스크톱 레이아웃
```

#### 1.3 공통 컴포넌트 추출

```
src/components/mypage/
├── mypage-icon.tsx                   # 마이페이지 아이콘들
├── mypage-card.tsx                   # 공통 카드 컴포넌트
└── mypage-section.tsx                # 공통 섹션 래퍼
```

### 2. 상수 및 타입 정의

#### 2.1 상수 정의

```typescript
// src/app/[countryCode]/mypage/constants.ts
export const MY_PAGE_CONSTANTS = {
  QUICK_LINKS: [
    { label: "주문목록", icon: "📦" },
    { label: "찜한상품", icon: "❤️" },
    { label: "자주산상품", icon: "🛍️" },
    { label: "맞춤정보", icon: "👀" },
  ],
  MENU_ITEMS: [
    { label: "주문조회", icon: "📄" },
    { label: "취소 / 반품 / 교환목록", icon: "🔄" },
    // ... 나머지 메뉴 아이템들
  ],
  BREAKPOINTS: {
    MOBILE: "md",
    DESKTOP: "md",
  },
} as const
```

#### 2.2 타입 정의

```typescript
// src/app/[countryCode]/mypage/types.ts
export interface QuickLink {
  label: string
  icon: string
}

export interface MenuItem {
  label: string
  icon: string
}

export interface ShippingItem {
  id: string
  status: "preparing" | "shipping"
  productName: string
  price: string
  quantity: number
  orderNumber: string
}
```

### 3. 훅 분리

#### 3.1 데이터 관련 훅

```typescript
// src/app/[countryCode]/mypage/hooks/
├── use-mypage-data.ts                # 마이페이지 데이터 관리
├── use-user-profile.ts               # 사용자 프로필 데이터
└── use-shipping-items.ts             # 배송 중 상품 데이터
```

### 4. 유틸리티 함수 분리

#### 4.1 헬퍼 함수

```typescript
// src/app/[countryCode]/mypage/utils/
├── format-currency.ts                # 통화 포맷팅
├── format-order-number.ts            # 주문번호 포맷팅
└── get-shipping-status.ts            # 배송 상태 관련 로직
```

### 5. 시멘틱 HTML 구조 개선

#### 5.1 현재 문제점

- `<section>` 태그가 적절히 사용되지 않음
- 컨테이너와 내부 요소의 책임이 명확하지 않음
- 접근성 속성이 부족함

#### 5.2 개선 방향

```html
<main className="min-h-screen">
  <section aria-labelledby="user-profile">
    <!-- 사용자 프로필 섹션 -->
  </section>

  <section aria-labelledby="quick-actions">
    <!-- 퀵 액션 섹션 -->
  </section>

  <section aria-labelledby="shipping-status">
    <!-- 배송 상태 섹션 -->
  </section>
</main>
```

### 6. 반응형 처리 개선

#### 6.1 현재 문제점

- 모바일/PC 버전이 하나의 컴포넌트에 혼재
- 조건부 렌더링이 복잡함

#### 6.2 개선 방향

- `MobileLayout`과 `DesktopLayout` 컴포넌트로 분리
- 공통 섹션 컴포넌트는 props로 반응형 스타일을 받도록 구성

### 7. 성능 최적화

#### 7.1 메모이제이션

- `React.memo`를 활용한 불필요한 리렌더링 방지
- `useMemo`를 활용한 계산 비용이 큰 값들 캐싱

#### 7.2 코드 스플리팅

- 각 섹션별로 lazy loading 적용 고려

## 구현 순서

1. **상수 및 타입 정의** - 기존 하드코딩된 값들을 상수로 추출
2. **아이콘 컴포넌트 분리** - 인라인 SVG를 별도 컴포넌트로 분리
3. **섹션별 컴포넌트 분리** - 각 기능별로 컴포넌트 분리
4. **반응형 레이아웃 분리** - 모바일/PC 레이아웃 분리
5. **훅 및 유틸리티 분리** - 비즈니스 로직 분리
6. **시멘틱 HTML 구조 개선** - 접근성 및 구조 개선
7. **성능 최적화** - 메모이제이션 및 최적화 적용

## 예상 효과

1. **가독성 향상**: 각 컴포넌트가 단일 책임을 가지게 됨
2. **유지보수성 향상**: 기능별로 분리되어 수정이 용이함
3. **재사용성 향상**: 공통 컴포넌트로 분리되어 다른 곳에서도 활용 가능
4. **테스트 용이성**: 작은 단위의 컴포넌트로 분리되어 테스트 작성이 용이함
5. **성능 향상**: 불필요한 리렌더링 방지 및 코드 스플리팅으로 초기 로딩 시간 단축

## 주의사항

- **UI 디자인 변경 금지**: 기존 디자인을 유지하면서 코드 구조만 개선
- **기능 동작 보장**: 리팩토링 후에도 모든 기능이 동일하게 동작해야 함
- **점진적 개선**: 한 번에 모든 것을 바꾸지 않고 단계적으로 개선
- **기존 API 호환성**: 기존 props와 인터페이스를 최대한 유지
