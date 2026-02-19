"use client"
import { ProductPriceDisplay } from "./product-price-display"
import { ProductRatingDisplay } from "./product-rating-display"
import { ProductShippingInfo } from "./product-shipping-info"
import type { ProductDetail } from "@lib/types/ui/product"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"

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
  const { isMembershipPricing } = useMembershipPricing()
  const isMember = isMembershipPricing
  const hasMembershipPrice =
    typeof product.membershipPrice === "number" &&
    typeof product.basePrice === "number" &&
    product.membershipPrice > 0 &&
    product.basePrice > product.membershipPrice

  const memberDisplayPrice =
    typeof product.actualPrice === "number" &&
      product.actualPrice > 0 &&
      product.actualPrice < (product.basePrice || 0)
      ? product.actualPrice
      : hasMembershipPrice
        ? (product.membershipPrice as number)
        : (product.actualPrice ?? product.basePrice ?? 0)

  // 유틸 함수
  const getDiscountRate = () => {
    const base = product.basePrice || 0
    if (
      isMembershipPricing &&
      base > 0 &&
      memberDisplayPrice > 0 &&
      memberDisplayPrice < base
    ) {
      return Math.round(((base - memberDisplayPrice) / base) * 100)
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
        isMember={isMember}
        isMembershipOnly={product.isMembershipOnly}
        discountRate={getDiscountRate()}
        memberPrices={product.memberPrices}
        actualPrice={memberDisplayPrice}
        showMembershipHint={
          !isMember &&
          hasMembershipPrice &&
          typeof product.actualPrice === "number" &&
          Math.abs(product.actualPrice - (product.membershipPrice ?? 0)) >= 1
        }
        membershipSavings={
          hasMembershipPrice
            ? (product.basePrice ?? 0) - (product.membershipPrice ?? 0)
            : undefined
        }
      />

      {/* 배송 정보 - 선택 필드 */}
      {product.shipping && <ProductShippingInfo shipping={product.shipping} />}

      {/* 수량/옵션 선택은 하단 시트에서만 노출 */}
    </section>
  )
}
