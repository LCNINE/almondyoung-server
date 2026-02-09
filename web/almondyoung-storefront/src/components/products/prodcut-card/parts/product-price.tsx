import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"

export function ProductPrice({
  price,
  originalPrice,
  discount,
  membershipSavings,
  showMembershipHint,
  showMembershipBadge,
  membershipPrice,
  isMember,
}: {
  price: number
  originalPrice: number
  discount: number
  membershipSavings?: number
  showMembershipHint?: boolean
  showMembershipBadge?: boolean
  membershipPrice?: number
  isMember: boolean
}) {
  // 멤버십 회원이고 할인이 있는 경우에만 할인 정보 표시
  const showDiscountInfo = discount > 0 && showMembershipBadge

  return (
    <>
      {showDiscountInfo && (
        <div className="text-[13px] text-gray-400">
          <span className="font-bold">{discount}% </span>
          <span className="line-through">
            {originalPrice.toLocaleString()}원
          </span>
        </div>
      )}

      <div className="flex items-center gap-1">
        <span className="text-[16px] font-bold text-black">
          {price.toLocaleString()}원
        </span>
        {showMembershipBadge && (
          <ProductMembershipBadge size="sm" label="멤버십할인가" />
        )}
      </div>
      {!isMember &&
        membershipPrice != null &&
        membershipPrice > 0 &&
        membershipSavings != null && (
          <div className="flex flex-col gap-0.5 text-[#F2994A]">
            <ProductMembershipBadge size="sm" label="멤버십할인가" />
            <span className="text-[15px] font-bold">
              {membershipPrice.toLocaleString()}원
            </span>
            <span className="text-[11px] font-medium">
              가입 시 {membershipSavings.toLocaleString()}원 절약
            </span>
          </div>
        )}
    </>
  )
}
