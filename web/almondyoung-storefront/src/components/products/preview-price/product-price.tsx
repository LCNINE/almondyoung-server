import { VariantPrice } from "@/lib/types/common/price"
import { ProductMembershipBadge } from "../prodcut-card/parts/product-membership-badge"

interface Props {
  price: VariantPrice
  membershipPrice: number
}

export default async function ProductPrice({ price, membershipPrice }: Props) {
  if (!price) {
    return null
  }

  const membershipDiscountRate = Math.round(
    ((price.original_price_number - membershipPrice) /
      price.original_price_number) *
      100
  )

  const membershipSavings = price.original_price_number - membershipPrice

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ProductMembershipBadge size="md" label="멤버십할인가" />
          {membershipDiscountRate > 0 && (
            <span className="inline-block text-sm font-semibold text-[#F29219]">
              {membershipDiscountRate}% OFF
            </span>
          )}
          <span className="text-lg font-bold text-[#F29219]">
            {membershipPrice?.toLocaleString()}원
          </span>
        </div>

        {/* todo: 멤버십인유저는 이거 안보이게 해야함 */}
        <p className="text-xs font-medium text-[#F29219]">
          멤버십 가입 시 {membershipSavings.toLocaleString()}원 절약
        </p>
      </div>
    </>
  )
}
