import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"

// 가격 숨김 처리가 필요한 상품 ID (하드코딩 - 나중에 제거 예정)
// TODO: 롤리킹 상품 가격 숨김 해제 시 이 배열에서 제거
const HIDDEN_PRICE_PRODUCT_IDS = [
  "prod_019c0c0d9b01722ab8ff1ceda3f3501f", // 롤리킹 펌제 1제 2제
  "prod_019c0c0d9b2776fc840b2e730adc6447", // 롤리킹 글루
  "prod_019c0c0d9b2e75ca823ec40282e58b09", // 롤리킹 롯드
  "prod_019c0c0d9b2676c28c79ad749950e351", // 롤리킹 속눈썹펌 세트
  "prod_019c0c0d9b2676c28c7999efcab89e60", // 롤리킹 에센스 5ml
]

export function ProductPrice({
  productId,
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
  productId?: string
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
  // 가격 숨김 상품: 비회원에게만 가격 숨김 (isMembershipOnly 또는 하드코딩된 상품 ID)
  const isHiddenPriceProduct = productId && HIDDEN_PRICE_PRODUCT_IDS.includes(productId)

  // 가격 숨김 상품: 비회원에게만 가격 숨김 (isMembershipOnly 또는 하드코딩된 상품 ID)
  if (!isMember && (isMembershipOnly || isHiddenPriceProduct)) {
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
