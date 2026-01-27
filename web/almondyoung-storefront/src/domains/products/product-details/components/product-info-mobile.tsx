"use client"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"
import type { ProductDetail } from "@lib/types/ui/product"

type Props = {
  product: ProductDetail
}

/**
 * @description 모바일 상품 정보 섹션
 * - 옵션 선택 로직을 내부에서 관리
 * - 액션은 이 컴포넌트에서 완결
 * - props drilling 최소화
 */
export function ProductInfoMobile({ product }: Props) {
  // 유틸 함수
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    const member = product.membershipPrice || 0
    if (base > 0 && member > 0 && member < base) {
      return Math.round(((base - member) / base) * 100)
    }
    return 0
  }

  return (
    <section className="md:hidden" aria-label="상품 정보">
      {/* 브랜드 & 상품명 */}
      <header className="mb-4">
        {product.brand && (
          <p className="text-sm text-gray-600">{product.brand}</p>
        )}
        <h2 className="text-xl font-bold">{product.name}</h2>
      </header>

      {/* 평점 - 선택 필드 */}
      {(product.rating || product.reviewCount) && (
        <ProductRatingDisplay
          rating={product.rating || 0}
          reviewCount={product.reviewCount || 0}
        />
      )}

      {/* 가격 - 필수 필드 */}
      <ProductPriceDisplay
        basePrice={product.basePrice || 0}
        membershipPrice={product.membershipPrice}
        isMembershipOnly={product.isMembershipOnly}
        discountRate={getDiscountRate()}
        memberPrices={product.memberPrices}
        actualPrice={product.actualPrice}
        showMembershipHint={
          typeof product.membershipPrice === "number" &&
          typeof product.basePrice === "number" &&
          typeof product.actualPrice === "number" &&
          product.basePrice > product.membershipPrice &&
          Math.abs(product.actualPrice - product.membershipPrice) >= 1
        }
        membershipSavings={
          typeof product.membershipPrice === "number" &&
          typeof product.basePrice === "number" &&
          product.basePrice > product.membershipPrice
            ? product.basePrice - product.membershipPrice
            : undefined
        }
      />

      {/* 배송 정보 - 선택 필드 */}
      {product.shipping && <ProductShippingInfo shipping={product.shipping} />}

      {/* 수량/옵션 선택은 하단 시트에서만 노출 */}
    </section>
  )
}
