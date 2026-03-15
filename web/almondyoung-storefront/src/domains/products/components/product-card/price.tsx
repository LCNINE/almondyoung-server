"use client"

import { VariantPrice } from "@/lib/types/common/price"
import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"

interface Props {
  price: VariantPrice
  membershipPrice: number
  isMembership: boolean
  isMembershipOnly: boolean
}

export default function ProductPrice({
  price,
  membershipPrice,
  isMembership,
  isMembershipOnly,
}: Props) {
  if (!price) {
    return null
  }
  // TODO: 어드민페이지 가격숨김표시기능이 완성되고 모든 상품 적용이 완성되면 이부분은 지울것
  if (!isMembership)
    return (
      <div className="flex flex-col gap-0.5 text-[#F2994A]">
        <ProductMembershipBadge size="sm" label="멤버십할인가" />
        <span className="text-[15px] font-bold">멤버십 회원 공개</span>
      </div>
    ) // 여기라인까지 지우면됌

  if (!isMembership && isMembershipOnly) {
    return (
      <div className="flex flex-col gap-0.5 text-[#F2994A]">
        <ProductMembershipBadge size="sm" label="멤버십할인가" />
        <span className="text-[15px] font-bold">멤버십 회원 공개</span>
      </div>
    )
  }

  const discount = Math.round(
    ((price.original_price_number - membershipPrice) /
      price.original_price_number) *
      100
  )

  if (isMembership)
    return (
      <>
        <div className="flex items-center gap-1 text-[13px] text-gray-400">
          <span className="shrink-0 font-bold">{discount}%</span>
          <span className="min-w-0 truncate line-through">
            {price.original_price_number.toLocaleString()}원
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-x-1 gap-y-0.5 md:flex-row md:items-center">
          <span className="text-[16px] leading-none font-bold whitespace-nowrap text-black">
            {price.calculated_price_number.toLocaleString()}원
          </span>

          <ProductMembershipBadge
            size="sm"
            label="멤버십할인가"
            className="shrink-0"
          />
        </div>
      </>
    )

  const membershipSavings = price.original_price_number - membershipPrice

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex flex-col gap-0.5 text-[#F2994A]">
          <ProductMembershipBadge size="sm" label="멤버십할인가" />
          <span className="text-[15px] font-bold whitespace-nowrap">
            {membershipPrice.toLocaleString()}원
          </span>
          <span className="hidden text-[11px] font-medium md:block">
            가입 시 {membershipSavings.toLocaleString()}원 절약
          </span>
        </div>
      </div>
    </>
  )
}
