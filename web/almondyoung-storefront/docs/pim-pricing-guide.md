# PIM 가격 계산 API 가이드

상품 옵션 선택 시 실시간 가격 계산을 위한 API 및 사용 가이드입니다.

## 📋 목차

1. [개요](#개요)
2. [서버 액션 API](#서버-액션-api)
3. [서비스 함수](#서비스-함수)
4. [React 훅](#react-훅)
5. [UI 컴포넌트](#ui-컴포넌트)
6. [사용 예시](#사용-예시)

---

## 개요

PIM의 가격 계산 시스템은 3-Layer 구조를 사용합니다:

```
Base Price (기본가)
  ↓
Membership Price (멤버십가, 회원만)
  ↓
Tiered Price (수량별 할인)
  ↓
최종 가격
```

### 가격 계산 규칙

1. **Base Price**: 모든 Variant에 적용되는 기본 가격
2. **Membership Price**: 멤버십 회원에게만 적용되는 할인
3. **Tiered Price**: 구매 수량에 따른 추가 할인

---

## 서버 액션 API

### 1. `calculateMasterPrice()`

Master의 Active 버전 기준으로 가격 계산

```typescript
import { calculateMasterPrice } from "@lib/api/pim/pricing.server"

const result = await calculateMasterPrice(masterId, {
  variantId: "variant-uuid",
  quantity: 10,
  customerType: "membership", // 또는 "regular"
})

if ("error" in result) {
  console.error(result.error.message)
} else {
  console.log("단가:", result.data.price)
  console.log("총가격:", result.data.totalPrice)
  console.log("적용된 규칙:", result.data.appliedRules)
}
```

**Response:**

```typescript
{
  variantId: string
  price: number              // 단가 (할인 적용 후)
  totalPrice: number         // 총 가격 (price × quantity)
  appliedRules: [...]        // 적용된 가격 규칙 목록
  priceBreakdown: {
    initialPrice: number
    afterBasePrice: number
    afterMembershipPrice: number
    afterTieredPrice: number
  }
}
```

### 2. `getMasterPriceSet()`

상품의 모든 가격 옵션 조회

```typescript
import { getMasterPriceSet } from "@lib/api/pim/pricing.server"

const result = await getMasterPriceSet(masterId, variantId)

if ("error" in result) {
  console.error(result.error.message)
} else {
  console.log("기본가:", result.data.basePrice)
  console.log("멤버십가:", result.data.membershipPrice)
  console.log("수량별 가격:", result.data.tieredPrices)
}
```

**Response:**

```typescript
{
  basePrice: number
  membershipPrice?: number
  tieredPrices?: Array<{
    minQuantity: number
    price: number
  }>
}
```

---

## 서비스 함수

서버 액션을 더 편하게 사용할 수 있는 래퍼 함수들입니다.

### 1. `calculateProductPrice()`

```typescript
import { calculateProductPrice } from "@lib/services/pim/products/getPriceService"

const result = await calculateProductPrice(
  masterId,
  variantId,
  quantity,
  isMembership
)

console.log("가격:", result.price)
console.log("총가격:", result.totalPrice)
console.log("할인 내역:", result.breakdown)
```

**Response:**

```typescript
{
  price: number
  totalPrice: number
  breakdown?: {
    basePrice: number
    membershipDiscount?: number
    tieredDiscount?: number
  }
  error?: string
}
```

### 2. `getProductPriceSet()`

```typescript
import { getProductPriceSet } from "@lib/services/pim/products/getPriceService"

const result = await getProductPriceSet(masterId, variantId)

console.log("기본가:", result.basePrice)
console.log("멤버십가:", result.membershipPrice)
console.log("할인율:", result.discountRate, "%")
```

### 3. `calculatePriceRange()`

여러 Variant의 가격 범위 계산 (상품 목록용)

```typescript
import { calculatePriceRange } from "@lib/services/pim/products/getPriceService"

const result = await calculatePriceRange(
  masterId,
  ["variant-1", "variant-2", "variant-3"],
  isMembership
)

console.log(`₩${result.minPrice} ~ ₩${result.maxPrice}`)
```

---

## React 훅

클라이언트 컴포넌트에서 사용할 수 있는 React 훅들입니다.

### 1. `useProductPrice()`

옵션 선택 시 실시간 가격 계산

```typescript
import { useProductPrice } from "@hooks/use-product-price"

function ProductDetail({ product, user }) {
  const [selectedVariant, setSelectedVariant] = useState(null)
  const [quantity, setQuantity] = useState(1)

  const { price, totalPrice, breakdown, loading, error } = useProductPrice({
    masterId: product.masterId,
    variantId: selectedVariant?.id,
    quantity,
    isMembership: user?.isMember,
  })

  if (loading) return <div>가격 계산 중...</div>
  if (error) return <div>에러: {error}</div>

  return (
    <div>
      <p>단가: ₩{price.toLocaleString()}</p>
      <p>총가격: ₩{totalPrice.toLocaleString()}</p>
      {breakdown?.membershipDiscount && (
        <p>멤버십 할인: -₩{breakdown.membershipDiscount.toLocaleString()}</p>
      )}
    </div>
  )
}
```

### 2. `useProductPriceSet()`

모든 가격 옵션 조회

```typescript
import { useProductPriceSet } from "@hooks/use-product-price"

function PriceInfo({ masterId, variantId }) {
  const { basePrice, membershipPrice, discountRate, tieredPrices, loading } =
    useProductPriceSet({ masterId, variantId })

  if (loading) return <div>로딩 중...</div>

  return (
    <div>
      <p>정가: ₩{basePrice.toLocaleString()}</p>
      {membershipPrice && (
        <>
          <p>멤버십가: ₩{membershipPrice.toLocaleString()}</p>
          <p>할인율: {discountRate}%</p>
        </>
      )}
      {tieredPrices && (
        <div>
          <h4>수량별 할인</h4>
          {tieredPrices.map((tier) => (
            <p key={tier.minQuantity}>
              {tier.minQuantity}개 이상: ₩{tier.price.toLocaleString()}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
```

---

## UI 컴포넌트

바로 사용 가능한 UI 컴포넌트들입니다.

### 1. `<ProductPriceDisplay />`

옵션 선택 시 실시간 가격 표시

```tsx
import { ProductPriceDisplay } from "@components/product-price-display"

;<ProductPriceDisplay
  masterId={product.masterId}
  variantId={selectedVariant?.id}
  quantity={quantity}
  isMembership={user?.isMember}
/>
```

**기능:**

- 단가 표시
- 총가격 표시 (수량 > 1일 때)
- 멤버십 할인 표시
- 수량 할인 표시
- 로딩/에러 처리

### 2. `<ProductPriceInfo />`

기본가/멤버십가/수량별 할인 정보 표시

```tsx
import { ProductPriceInfo } from "@components/product-price-display"

;<ProductPriceInfo
  masterId={product.masterId}
  variantId={selectedVariant?.id}
/>
```

**기능:**

- 정가 표시
- 멤버십가 및 할인율 표시
- 수량별 할인 정보 표시
- 로딩/에러 처리

---

## 사용 예시

### 예시 1: 상품 상세 페이지

```tsx
"use client"

import { useState } from "react"
import { ProductPriceDisplay } from "@components/product-price-display"
import { useProductPrice } from "@hooks/use-product-price"

export function ProductDetailPage({ product, user }) {
  const [selectedOptions, setSelectedOptions] = useState({})
  const [quantity, setQuantity] = useState(1)

  // 선택된 옵션으로 variant 찾기
  const selectedVariant = findVariantByOptions(
    product.variants,
    selectedOptions
  )

  // 실시간 가격 계산
  const { price, totalPrice, loading } = useProductPrice({
    masterId: product.masterId,
    variantId: selectedVariant?.id,
    quantity,
    isMembership: user?.isMember,
  })

  return (
    <div>
      <h1>{product.name}</h1>

      {/* 옵션 선택 */}
      <OptionSelector
        options={product.options}
        selected={selectedOptions}
        onChange={setSelectedOptions}
      />

      {/* 수량 선택 */}
      <QuantityInput value={quantity} onChange={setQuantity} />

      {/* 가격 표시 */}
      <ProductPriceDisplay
        masterId={product.masterId}
        variantId={selectedVariant?.id}
        quantity={quantity}
        isMembership={user?.isMember}
      />

      {/* 장바구니 추가 */}
      <button
        disabled={!selectedVariant || loading}
        onClick={() => addToCart(selectedVariant.id, quantity, price)}
      >
        장바구니 담기
      </button>
    </div>
  )
}
```

### 예시 2: 상품 목록 카드

```tsx
"use client"

import { calculatePriceRange } from "@lib/services/pim/products/getPriceService"
import { useEffect, useState } from "react"

export function ProductCard({ product, isMembership }) {
  const [priceRange, setPriceRange] = useState({ minPrice: 0, maxPrice: 0 })

  useEffect(() => {
    // 모든 variant의 가격 범위 계산
    const fetchPriceRange = async () => {
      const variantIds = product.variants.map((v) => v.id)
      const range = await calculatePriceRange(
        product.masterId,
        variantIds,
        isMembership
      )
      setPriceRange(range)
    }

    fetchPriceRange()
  }, [product.masterId, product.variants, isMembership])

  return (
    <div className="product-card">
      <img src={product.thumbnail} alt={product.name} />
      <h3>{product.name}</h3>
      <div className="price">
        {priceRange.minPrice === priceRange.maxPrice ? (
          <span>₩{priceRange.minPrice.toLocaleString()}</span>
        ) : (
          <span>
            ₩{priceRange.minPrice.toLocaleString()} ~ ₩
            {priceRange.maxPrice.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  )
}
```

### 예시 3: 장바구니

```tsx
"use client"

import { useProductPrice } from "@hooks/use-product-price"

export function CartItem({ item, user }) {
  const { totalPrice, loading } = useProductPrice({
    masterId: item.masterId,
    variantId: item.variantId,
    quantity: item.quantity,
    isMembership: user?.isMember,
  })

  return (
    <div className="cart-item">
      <img src={item.thumbnail} alt={item.name} />
      <div>
        <h4>{item.name}</h4>
        <p>{item.optionName}</p>
        <p>수량: {item.quantity}개</p>
      </div>
      <div className="price">
        {loading ? (
          <span>계산 중...</span>
        ) : (
          <span>₩{totalPrice.toLocaleString()}</span>
        )}
      </div>
    </div>
  )
}
```

---

## 주의사항

1. **Server Action vs Client Hook**
   - 서버 컴포넌트: `calculateProductPrice()` 서비스 함수 사용
   - 클라이언트 컴포넌트: `useProductPrice()` 훅 사용

2. **가격 업데이트 타이밍**
   - 옵션 변경 시: 자동 업데이트
   - 수량 변경 시: 자동 업데이트
   - 로그인/로그아웃 시: `isMembership` 변경으로 자동 업데이트

3. **에러 처리**
   - 모든 함수/훅은 에러를 반환하므로 UI에서 적절히 처리 필요
   - 에러 발생 시 가격은 0으로 설정됨

4. **성능 최적화**
   - 가격 계산은 debounce 처리 권장 (특히 수량 입력 시)
   - 여러 variant의 가격을 한 번에 조회해야 할 때는 `calculatePriceRange()` 사용

---

## API 스펙 요약

| 함수/훅                 | 타입          | 용도             | 입력                                        | 출력                                     |
| ----------------------- | ------------- | ---------------- | ------------------------------------------- | ---------------------------------------- |
| `calculateMasterPrice`  | Server Action | 가격 계산        | masterId, request                           | price, totalPrice                        |
| `getMasterPriceSet`     | Server Action | 가격 세트 조회   | masterId, variantId                         | basePrice, membershipPrice               |
| `calculateProductPrice` | Service       | 가격 계산 (래퍼) | masterId, variantId, quantity, isMembership | price, totalPrice, breakdown             |
| `getProductPriceSet`    | Service       | 가격 세트 (래퍼) | masterId, variantId                         | basePrice, membershipPrice, discountRate |
| `calculatePriceRange`   | Service       | 가격 범위 계산   | masterId, variantIds[], isMembership        | minPrice, maxPrice                       |
| `useProductPrice`       | Hook          | 실시간 가격 계산 | masterId, variantId, quantity, isMembership | price, totalPrice, loading               |
| `useProductPriceSet`    | Hook          | 가격 세트 조회   | masterId, variantId                         | basePrice, membershipPrice, loading      |

---

## 성능 최적화 권장 사항

### 1. Batch 가격 계산 API (백엔드 추가 권장)

**현재 문제:**

- 상품 목록에서 가격 범위 표시 시 variant마다 개별 API 호출
- Variant가 많을 경우 (예: 10개) 10번의 API 호출 발생
- 네트워크 비용 및 지연 시간 증가

**권장 API 스펙:**

```typescript
POST /masters/:masterId/pricing/calculate-batch

Request Body:
{
  variants: [
    { variantId: "uuid-1", quantity: 1 },
    { variantId: "uuid-2", quantity: 1 },
    { variantId: "uuid-3", quantity: 1 }
  ],
  customerType: "membership" // optional
}

Response:
{
  results: [
    { variantId: "uuid-1", price: 10000, totalPrice: 10000 },
    { variantId: "uuid-2", price: 15000, totalPrice: 15000 },
    { variantId: "uuid-3", price: 20000, totalPrice: 20000 }
  ]
}
```

**프론트 적용 예시:**

```typescript
// 기존: 개별 호출
const prices = await Promise.all(
  variantIds.map((id) => calculateProductPrice(masterId, id, 1, isMembership))
)

// 개선: 배치 호출
const prices = await calculateBatchPrices(masterId, variantIds, isMembership)
```

### 2. 가격 범위 계산 API (백엔드 추가 권장)

상품 목록에 최적화된 단순 API:

```typescript
GET /masters/:masterId/pricing/price-range?customerType=membership

Response:
{
  minPrice: 10000,
  maxPrice: 50000
}
```

**장점:**

- 서버에서 모든 variant의 가격을 계산하여 min/max만 반환
- 프론트에서는 1번의 API 호출만 필요
- 상품 목록 페이지 성능 대폭 개선

### 3. 현재 임시 대응

백엔드 API 추가 전까지는:

- Variant 수가 10개 이하: 전체 조회
- Variant 수가 10개 초과: 첫 번째, 중간 샘플 8개, 마지막 variant만 조회 (총 10개)
- 근사값으로 가격 범위 표시

---

## 문의

가격 계산 관련 문의는 백엔드 PIM 팀에게 문의하세요.

**성능 개선 제안:**

- Batch 가격 계산 API
- 가격 범위 계산 API
