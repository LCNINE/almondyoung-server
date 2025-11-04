# 홈 섹션 리팩토링 명세서

## 📋 현재 문제점

### 1. 섹션 구조 중복
- 동일한 섹션 래퍼 구조가 매번 반복됨
- 컨테이너 스타일이 하드코딩: `container mx-auto max-w-[1360px] px-4 md:px-[40px]`
- 섹션 보더/패딩이 매번 선언: `border-muted w-full border-t py-8 lg:py-12`

### 2. 반응형 처리 불일치
- `guest-home.client.tsx`: 모바일 스크롤 구현 ✅
- `authenticated-home.client.tsx`: 반응형 없음 ❌
- 동일한 UI인데 로직이 통일되지 않음

### 3. 컴포넌트 파일 비대화
- 두 파일 모두 200~300줄
- 섹션별 분리 없이 한 파일에 모두 작성

### 4. 스타일 불일치
- `guest-home`: `border-gray-20`
- `authenticated-home`: `border-muted`

---

## 🎯 리팩토링 목표

**핵심 3가지만 집중:**
1. **섹션 컴포넌트 재사용** - 중복 제거
2. **반응형 리스트 통일** - 모바일 스크롤 + 데스크톱 그리드
3. **파일 분리** - 가독성 향상

---

## 🏗️ 새로운 구조

```
src/app/[countryCode]/(main)/
├── home-gate.client.tsx                    (기존 유지)
├── components/
│   ├── authenticated-home.client.tsx       (기존 - 간소화)
│   ├── guest-home.client.tsx               (기존 - 간소화)
│   │
│   └── sections/                           (신규)
│       ├── product-section.tsx             🆕 섹션 래퍼
│       ├── responsive-product-list.tsx     🆕 반응형 리스트
│       └── section-header.tsx              🆕 섹션 헤더
```

---

## 📦 생성할 컴포넌트 (3개만)

### 1. `product-section.tsx`
**역할:** 섹션 래퍼 (컨테이너, 패딩, 보더)

```tsx
interface ProductSectionProps {
  children: React.ReactNode
  background?: "white" | "muted"
  className?: string
}

export function ProductSection({
  children,
  background = "white",
  className = "",
}: ProductSectionProps) {
  return (
    <section
      className={cn(
        "w-full border-t border-gray-200 py-8 lg:py-12",
        background === "muted" && "bg-muted",
        className
      )}
    >
      <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
        {children}
      </div>
    </section>
  )
}
```

### 2. `section-header.tsx`
**역할:** 제목 + 설명 + 더보기 링크

```tsx
interface SectionHeaderProps {
  title: string
  description?: string
  showMoreLink?: string
  showMoreText?: string
}

export function SectionHeader({
  title,
  description,
  showMoreLink,
  showMoreText = "더보기",
}: SectionHeaderProps) {
  return (
    <div className="mb-6 flex items-center justify-between lg:mb-8">
      <div>
        <h2 className="mb-2 text-2xl font-bold text-gray-900 lg:text-3xl">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-gray-600 lg:text-base">{description}</p>
        )}
      </div>
      {showMoreLink && (
        <Link href={showMoreLink} className="text-sm font-medium text-gray-600">
          {showMoreText}
        </Link>
      )}
    </div>
  )
}
```

### 3. `responsive-product-list.tsx`
**역할:** 모바일 스크롤 + 데스크톱 그리드

```tsx
interface ResponsiveProductListProps {
  products: ProductCard[]
  renderCard: (product: ProductCard, index: number) => React.ReactNode
  columns?: {
    mobile?: number
    tablet?: number
    desktop?: number
  }
}

export function ResponsiveProductList({
  products,
  renderCard,
  columns = { mobile: 1, tablet: 3, desktop: 5 },
}: ResponsiveProductListProps) {
  return (
    <div className="scrollbar-hide overflow-x-auto md:overflow-visible">
      <div
        className={cn(
          "flex gap-3",
          "md:grid md:gap-4",
          "lg:gap-6",
          columns.tablet && `md:grid-cols-${columns.tablet}`,
          columns.desktop && `lg:grid-cols-${columns.desktop}`
        )}
      >
        {products.map((product, index) => (
          <div
            key={`${product.id}-${index}`}
            className="w-[150px] flex-shrink-0 md:w-auto"
          >
            {renderCard(product, index)}
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## 🔄 리팩토링 적용 예시

### Before (guest-home.client.tsx)
```tsx
// 135줄 - 신상품 섹션
<section className="border-gray-20 w-full border-t py-8 lg:py-12">
  <div className="mx-auto w-full max-w-[1360px] px-4 md:px-[40px]">
    <div className="mb-6 lg:mb-8">
      <h2 className="mb-2 text-2xl font-bold text-gray-900 lg:text-3xl">
        신상품
      </h2>
      <p className="text-sm text-gray-600 lg:text-base">
        신상품을 만나보세요
      </p>
    </div>
    <div className="scrollbar-hide overflow-x-auto md:overflow-visible">
      <div className="flex gap-3 md:grid md:grid-cols-3 md:gap-4 lg:grid-cols-5 lg:gap-6">
        {newProducts.slice(0, 10).map((product, idx) => (
          <div key={`new-${product.id}-${idx}`} className="w-[150px] flex-shrink-0 md:w-auto">
            <BasicProductCard product={product} />
          </div>
        ))}
      </div>
    </div>
  </div>
</section>
```

### After
```tsx
// 간결하고 명확함
<ProductSection>
  <SectionHeader title="신상품" description="신상품을 만나보세요" />
  <ResponsiveProductList
    products={newProducts.slice(0, 10)}
    renderCard={(product) => <BasicProductCard product={product} />}
  />
</ProductSection>
```

**결과:**
- 20줄 → 6줄 (70% 감소)
- 의도가 명확함
- 재사용 가능

---

## ✅ 리팩토링 체크리스트

### Phase 1: 공통 컴포넌트 생성
- [ ] `product-section.tsx` 생성
- [ ] `section-header.tsx` 생성
- [ ] `responsive-product-list.tsx` 생성

### Phase 2: guest-home.client.tsx 리팩토링
- [ ] 신상품 섹션 → 새 컴포넌트 적용
- [ ] 웰컴딜 섹션 → 새 컴포넌트 적용
- [ ] 디지털 템플릿 섹션 → 새 컴포넌트 적용
- [ ] 인기 급상승 섹션 → 새 컴포넌트 적용
- [ ] 재구매 많은 제품 섹션 → 새 컴포넌트 적용

### Phase 3: authenticated-home.client.tsx 리팩토링
- [ ] 추천제품 섹션 → 새 컴포넌트 + 반응형 추가
- [ ] 자주 구매 섹션 → 새 컴포넌트 + 반응형 추가
- [ ] 장바구니 섹션 → 새 컴포넌트 + 반응형 추가
- [ ] 전문가 추천 섹션 → 새 컴포넌트 + 반응형 추가

### Phase 4: 정리
- [ ] 불필요한 주석 제거
- [ ] 스타일 클래스 통일 (`border-gray-200` 으로)
- [ ] 빈 데이터 확인 및 TODO 주석 추가

---

## 📊 예상 효과

| 항목 | Before | After | 개선 |
|------|--------|-------|------|
| `guest-home.client.tsx` | 294줄 | ~150줄 | 49% ↓ |
| `authenticated-home.client.tsx` | 197줄 | ~100줄 | 49% ↓ |
| 섹션 중복 코드 | 매 섹션마다 | 0 | 100% 제거 |
| 반응형 처리 | 불일치 | 통일 | ✅ |
| 가독성 | 낮음 | 높음 | ✅ |

---

## 🚫 하지 않을 것

- ~~utils 파일 생성~~ (불필요)
- ~~데이터 변환 로직 분리~~ (서버/API에서 처리)
- ~~custom hooks 생성~~ (단순 GET이라 불필요)
- ~~복잡한 추상화~~ (KISS 원칙)

---

## 📝 참고 규칙

### Frontend Component Architecture 적용
- ✅ **규칙 1**: 구현 상세를 컴포넌트로 추상화
- ✅ **규칙 3**: 같이 실행되지 않는 코드 분리 (guest/authenticated)
- ✅ **규칙 4**: 조합(Composition) 패턴 사용

### Frontend Readability 적용
- ✅ **규칙 3**: 구현 상세 추상화 (섹션 → 컴포넌트)
- ✅ **규칙 4**: 같이 실행되지 않는 코드 분리
- ✅ **규칙 6**: 시점 이동 줄이기 (한 눈에 파악 가능)

