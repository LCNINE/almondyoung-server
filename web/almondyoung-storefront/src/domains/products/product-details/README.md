# Product Details Domain

상품 상세 페이지 도메인 컴포넌트입니다. 시맨틱 HTML을 적극 활용하고, 과도한 div와 CSS 중첩을 최소화한 리팩토링 버전입니다.

## 📁 파일 구조

```
src/domains/products/product-details/
├── components/                     # 컴포넌트 모듈
│   ├── product-image-gallery.tsx   # 이미지 갤러리 (<figure>, <nav>)
│   ├── product-price-display.tsx   # 가격 표시 (<output>, <dl>)
│   ├── product-rating-display.tsx  # 평점 표시
│   ├── product-shipping-info.tsx   # 배송 정보 (<dl>)
│   ├── product-option-selector.tsx # 옵션 선택 (<fieldset>)
│   ├── product-info-mobile.tsx     # 모바일 상품 정보
│   ├── product-sidebar-purchase.tsx# 데스크탑 사이드바 (<aside>)
│   ├── product-tabs.tsx            # 탭 네비게이션 (<nav role="tablist">)
│   ├── product-detail-info.tsx     # 상세 정보 (<article>, <dl>)
│   ├── product-qna-section.tsx     # Q&A 섹션
│   ├── product-info-accordion.tsx  # 구매/반품 정보 아코디언
│   ├── product-bottom-bar.tsx      # 모바일 하단 액션바 (<nav>)
│   ├── product-bottom-sheet.tsx    # 모바일 바텀 시트 (role="dialog")
│   └── index.ts                    # Export 모음
├── product-detail-page-new.tsx     # 🆕 새 메인 페이지 (리팩토링)
├── productDetail.client.tsx        # 원본 보존 (기존 파일)
└── index.ts                        # 도메인 Export
```

## 🎯 주요 개선사항

### 1. **시맨틱 HTML 적극 활용**

#### Before (기존)

```tsx
<div className="...">
  <div className="...">상품 정보</div>
</div>
```

#### After (새 버전)

```tsx
<section aria-label="상품 정보">
  <header>
    <h2>상품명</h2>
  </header>
</section>
```

### 2. **적절한 시맨틱 태그 사용**

| 용도          | 태그                           | 예시                 |
| ------------- | ------------------------------ | -------------------- |
| 이미지 + 캡션 | `<figure>`                     | 상품 이미지 갤러리   |
| 정의 목록     | `<dl>`, `<dt>`, `<dd>`         | 배송 정보, 상품 스펙 |
| 계산된 값     | `<output>`                     | 총 가격, 할인 가격   |
| 폼 그룹       | `<fieldset>`, `<legend>`       | 옵션 선택            |
| 보조 콘텐츠   | `<aside>`                      | 데스크탑 구매 패널   |
| 탭            | `role="tablist"`, `role="tab"` | 상세정보 탭          |
| 다이얼로그    | `role="dialog"`                | 바텀 시트            |

### 3. **과도한 div 제거**

#### Before

```tsx
<div className="flex">
  <div className="w-32">
    <div className="text-gray-600">배송비</div>
  </div>
  <div className="flex-1">
    <div>2,500원</div>
  </div>
</div>
```

#### After

```tsx
<dl className="space-y-2">
  <div className="flex">
    <dt className="w-32 text-gray-600">배송비</dt>
    <dd>2,500원</dd>
  </div>
</dl>
```

### 4. **CSS 중첩 최소화**

각 컴포넌트에 명확한 책임을 부여하고, 재사용 가능한 작은 단위로 분리했습니다.

## 🚀 사용 방법

### 새 버전 사용 (권장)

```tsx
// app/[countryCode]/(main)/products/[id]/page.tsx
import { ProductDetailPageNew } from "@/domains/products/product-details"

export default function Page({ params }: { params: Promise<any> }) {
  return <ProductDetailPageNew params={params} product={product} user={user} />
}
```

### 개별 컴포넌트 사용

```tsx
import {
  ProductImageGallery,
  ProductPriceDisplay,
  ProductOptionSelector,
  // ... 필요한 컴포넌트만 import
} from "@/domains/products/product-details"

export function MyCustomPage() {
  return (
    <>
      <ProductImageGallery
        thumbnails={thumbnails}
        mainImage={mainImage}
        productName={productName}
        onImageChange={setMainImage}
      />
      <ProductPriceDisplay
        basePrice={basePrice}
        membershipPrice={membershipPrice}
        isMembershipOnly={false}
        discountRate={20}
      />
    </>
  )
}
```

## 📦 컴포넌트 API

### ProductImageGallery

```tsx
type Props = {
  thumbnails: string[] // 썸네일 이미지 목록
  mainImage: string // 메인 이미지 URL
  productName: string // 상품명 (alt 텍스트용)
  onImageChange: (image: string) => void // 이미지 변경 핸들러
}
```

### ProductPriceDisplay

```tsx
type Props = {
  basePrice: number // 정가
  membershipPrice?: number // 멤버십 가격
  isMembershipOnly: boolean // 멤버십 전용 여부
  discountRate: number // 할인율 (%)
  memberPrices?: MemberPrice[] // 등급별 가격
}
```

### ProductOptionSelector

```tsx
type Props = {
  options: Option[] // 옵션 목록
  selectedOptions: Record<string, string> // 선택된 옵션
  selectedCartOptions: SelectedCartOption[] // 장바구니에 담긴 옵션
  onOptionChange: (label: string, value: string) => void
  onQuantityUpdate: (id: string, newQuantity: number) => void
  onOptionRemove: (id: string) => void
}
```

## 🎨 스타일링 가이드

### Tailwind 사용 원칙

- 1개 태그에 과도한 클래스 중첩 금지 (최대 5개 이내 권장)
- 반복되는 스타일은 컴포넌트로 분리
- 반응형 클래스는 `md:`, `lg:` 접두사 사용

### 시맨틱 우선

- div 사용 전에 적절한 시맨틱 태그가 있는지 확인
- 의미 있는 구조를 먼저 만들고 스타일 적용
- 접근성(ARIA) 속성 적극 활용

## 🔄 마이그레이션 가이드

기존 `productDetail.client.tsx`에서 새 버전으로 전환:

1. **단계별 전환 가능**: 개별 컴포넌트부터 교체 가능
2. **원본 보존**: 기존 파일은 그대로 유지되므로 안전
3. **점진적 적용**: 필요한 부분만 먼저 전환 후 테스트

```tsx
// 1단계: 이미지 갤러리만 교체
import { ProductImageGallery } from "@/domains/products/product-details"

// 2단계: 가격 표시도 교체
import { ProductImageGallery, ProductPriceDisplay } from "..."

// 3단계: 전체 페이지 교체
import { ProductDetailPageNew } from "..."
```

## ✅ 체크리스트

- [x] 시맨틱 HTML 사용
- [x] 과도한 div 제거
- [x] CSS 중첩 최소화
- [x] 컴포넌트 분리
- [x] 접근성(ARIA) 속성
- [x] 린터 오류 없음
- [x] kebab-case 명명 규칙
- [x] 원본 파일 보존

## 📝 참고사항

- **원본 파일 보존**: `productDetail.client.tsx`는 그대로 유지됩니다.
- **점진적 마이그레이션**: 필요에 따라 개별 컴포넌트부터 교체 가능합니다.
- **UI 디자인 유지**: 디자인은 동일하며, 구조만 개선되었습니다.
