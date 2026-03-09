import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"

interface Props {
  hasMembership: boolean
  product: HttpTypes.StoreProduct
}

export default function ProductPreviewPrice({ hasMembership, product }: Props) {
  const { cheapestPrice } = getProductPrice({ product })

  if (!cheapestPrice) return null

  // 가격 숨김 처리가 필요한 상품 ID (하드코딩 - 나중에 제거 예정)
  // TODO: 롤리킹 상품 가격 숨김 해제 시 이 배열에서 제거
  const HIDDEN_PRICE_PRODUCT_IDS = [
    "prod_019c0c0d9b01722ab8ff1ceda3f3501f", // 롤리킹 펌제 1제 2제
    "prod_019c0c0d9b2776fc840b2e730adc6447", // 롤리킹 글루
    "prod_019c0c0d9b2e75ca823ec40282e58b09", // 롤리킹 롯드
    "prod_019c0c0d9b2676c28c79ad749950e351", // 롤리킹 속눈썹펌 세트
    "prod_019c0c0d9b2676c28c7999efcab89e60", // 롤리킹 에센스 5ml
  ]

  const isMembershipOnly =
    product.metadata?.isMembershipOnly === true ||
    product.metadata?.isMembershipOnly === "true" ||
    HIDDEN_PRICE_PRODUCT_IDS.includes(product.id)

  const membershipPrice = product.variants?.[0]?.metadata?.membershipPrice as
    | number
    | undefined

  const hasMembershipPrice =
    typeof membershipPrice === "number" && membershipPrice > 0

  const membershipDiscountRate = hasMembershipPrice
    ? Math.round(
        ((cheapestPrice.original_price_number - membershipPrice) /
          cheapestPrice.original_price_number) *
          100
      )
    : 0

  const membershipSavings = hasMembershipPrice
    ? cheapestPrice.original_price_number - membershipPrice
    : 0

  const isMembershipApplied = hasMembership && hasMembershipPrice

  const cheapestPriceAmount =
    cheapestPrice.original_price_number - cheapestPrice.calculated_price_number

  const showOriginalPrice =
    (isMembershipApplied && membershipDiscountRate > 0) ||
    cheapestPriceAmount > 0

  // 가격 숨김 상품: 비회원에게만 가격 숨김
  if (!hasMembership && isMembershipOnly) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ProductMembershipBadge size="md" label="멤버십할인가" />
            <span className="text-primary text-lg font-bold">
              멤버십 회원 공개
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {/* 원래 가격 (취소선) */}
      {showOriginalPrice && (
        <span className="text-sm text-gray-400 line-through">
          {cheapestPrice.original_price}
        </span>
      )}

      {/* 최종 가격 */}
      {isMembershipApplied ? (
        <div className="flex flex-col gap-2">
          <ProductMembershipBadge size="md" label="멤버십할인가" />
          <div className="flex items-center gap-2">
            {membershipDiscountRate > 0 && (
              <span className="text-xl font-semibold text-red-500">
                {membershipDiscountRate}%
              </span>
            )}

            <span className="text-xl font-bold">
              {membershipPrice.toLocaleString()}원
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">
            {cheapestPrice.calculated_price_number.toLocaleString()}원
          </span>

          {cheapestPrice.percentage_diff &&
            Number(cheapestPrice.percentage_diff) > 0 && (
              <span className="text-sm font-semibold text-red-500">
                {cheapestPrice.percentage_diff}%
              </span>
            )}
        </div>
      )}

      {/* 비멤버에게 멤버십 가격 프로모션 */}
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
