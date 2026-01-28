import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"

export function ProductPrice({
  price,
  originalPrice,
  discount,
  membershipSavings,
  showMembershipHint,
  showMembershipBadge,
}: {
  price: number
  originalPrice: number
  discount: number
  membershipSavings?: number
  showMembershipHint?: boolean
  showMembershipBadge?: boolean
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
        {showMembershipBadge && <ProductMembershipBadge size="sm" />}
      </div>
      {showMembershipHint && membershipSavings != null && (
        <span className="text-[11px] text-gray-500">
          멤버십 가입 시 {membershipSavings.toLocaleString()}원 절약
        </span>
      )}
    </>
  )
}
