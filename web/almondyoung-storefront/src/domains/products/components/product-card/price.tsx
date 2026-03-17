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

  // 할인이 없으면 가격만 표시
  const hasDiscount = discount > 0

  if (isMembership) {
    // 할인 없으면 단순 가격만
    if (!hasDiscount) {
      return (
        <span className="text-foreground text-[16px] leading-none font-bold whitespace-nowrap">
          {price.calculated_price_number.toLocaleString()}원
        </span>
      )
    }

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
  }

  // 비멤버십 - 할인 없으면 단순 가격만
  if (!hasDiscount) {
    return (
      <span className="text-foreground text-[15px] font-bold whitespace-nowrap">
        {price.original_price_number.toLocaleString()}원
      </span>
    )
  }

  const membershipSavings = price.original_price_number - membershipPrice

  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[13px] text-gray-400">
          <span className="shrink-0 font-bold">{discount}%</span>
          <span className="min-w-0 truncate line-through">
            {price.original_price_number.toLocaleString()}원
          </span>
        </div>
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
