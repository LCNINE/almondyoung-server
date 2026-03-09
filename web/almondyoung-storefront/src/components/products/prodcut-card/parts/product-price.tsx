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
  isMembershipOnly,
}: {
  price: number
  originalPrice: number
  discount: number
  membershipSavings?: number
  showMembershipHint?: boolean
  showMembershipBadge?: boolean
  membershipPrice?: number
  isMember: boolean
  isMembershipOnly?: boolean
}) {
  // 가격 숨김 상품: 비회원에게만 가격 숨김
  if (!isMember && isMembershipOnly) {
    return (
      <div className="flex flex-col gap-0.5 text-[#F2994A]">
        <ProductMembershipBadge size="sm" label="멤버십할인가" />
        <span className="text-[15px] font-bold">멤버십 회원 공개</span>
      </div>
    )
  }

  // 멤버십 회원이고 할인이 있는 경우에만 할인 정보 표시
  const showDiscountInfo = discount > 0 && showMembershipBadge

  return (
    <>
      {showDiscountInfo && (
        <div className="flex items-center gap-1 text-[13px] text-gray-400">
          <span className="shrink-0 font-bold">{discount}%</span>
          <span className="min-w-0 truncate line-through">
            {originalPrice.toLocaleString()}원
          </span>
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="whitespace-nowrap text-[16px] font-bold leading-none text-black">
          {price.toLocaleString()}원
        </span>
        {showMembershipBadge && (
          <ProductMembershipBadge
            size="sm"
            label="멤버십할인가"
            className="shrink-0"
          />
        )}
      </div>
      {!isMember &&
        membershipPrice != null &&
        membershipPrice > 0 &&
        membershipSavings != null && (
          <div className="flex flex-col gap-0.5 text-[#F2994A]">
            <ProductMembershipBadge size="sm" label="멤버십할인가" />
            <span className="whitespace-nowrap text-[15px] font-bold">
              {membershipPrice.toLocaleString()}원
            </span>
            <span className="hidden text-[11px] font-medium md:block">
              가입 시 {membershipSavings.toLocaleString()}원 절약
            </span>
          </div>
        )}
    </>
  )
}
