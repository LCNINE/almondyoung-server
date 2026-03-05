import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
import {
  getProductPrice,
  getPricesForVariant,
} from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"

interface ProductDetailPriceProps {
  hasMembership: boolean
  product: HttpTypes.StoreProduct
  selectedVariant?: HttpTypes.StoreProductVariant
}

export default function ProductDetailPrice({
  hasMembership,
  product,
  selectedVariant,
}: ProductDetailPriceProps) {
  const { cheapestPrice } = getProductPrice({ product })

  // variant 선택 시 해당 variant 가격, 미선택 시 cheapestPrice
  const price = selectedVariant
    ? getPricesForVariant(selectedVariant)
    : cheapestPrice

  if (!price) {
    return null
  }

  const membershipPrice = selectedVariant
    ? (selectedVariant.metadata?.membershipPrice as number | undefined)
    : (product.variants?.[0]?.metadata?.membershipPrice as number | undefined)

  const hasMembershipPrice =
    typeof membershipPrice === "number" && membershipPrice > 0

  const membershipDiscountRate = hasMembershipPrice
    ? Math.round(
        ((price.original_price_number - membershipPrice) /
          price.original_price_number) *
          100
      )
    : 0

  const membershipSavings = hasMembershipPrice
    ? price.original_price_number - membershipPrice
    : 0

  const isMembershipApplied = hasMembership && hasMembershipPrice
  const showOriginalPrice = isMembershipApplied || price.price_type === "sale"

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* 원래 가격 (취소선) */}
      {showOriginalPrice && (
        <span className="text-sm text-gray-400 line-through">
          {price.original_price}
        </span>
      )}

      {/* 최종 가격 */}
      {isMembershipApplied ? (
        <div className="flex flex-col gap-2">
          <ProductMembershipBadge size="md" label="멤버십할인가" />
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold text-red-500">
              {membershipDiscountRate}%
            </span>
            <span className="text-xl font-bold">
              {membershipPrice.toLocaleString()}원
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">{price.calculated_price}</span>
          {price.percentage_diff && Number(price.percentage_diff) > 0 && (
            <span className="text-sm font-semibold text-red-500">
              {price.percentage_diff}%
            </span>
          )}
        </div>
      )}

      {/* 멤버십가입안한 사람에게 보여지는 멤버십 가격 프로모션 */}
      {!hasMembership && hasMembershipPrice && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ProductMembershipBadge size="md" label="멤버십할인가" />
            {membershipDiscountRate > 0 && (
              <span className="text-primary text-sm font-semibold">
                {membershipDiscountRate}% OFF
              </span>
            )}
            <span className="text-primary text-lg font-bold">
              {membershipPrice.toLocaleString()}원
            </span>
          </div>
          <p className="text-primary text-xs font-medium">
            멤버십 가입 시 {membershipSavings.toLocaleString()}원 절약
          </p>
        </div>
      )}
    </div>
  )
}
