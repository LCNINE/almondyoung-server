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

  // 멤버십가 비공개 상품: 비회원에게 일반 판매가는 그대로 보여주고,
  // 멤버십가 숫자 영역만 "멤버십 회원 공개"로 대체 (상품 숨김/구매 제한 아님)
  if (!isMembership && isMembershipOnly) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-foreground text-[15px] font-bold whitespace-nowrap">
          {price.original_price_number.toLocaleString()}원
        </span>
        <div className="flex flex-col gap-0.5 text-[#F2994A]">
          <ProductMembershipBadge size="sm" label="멤버십할인가" />
          <span className="text-[15px] font-bold">멤버십 회원 공개</span>
        </div>
      </div>
    )
  }

  // 멤버: Medusa가 실제 적용한 할인 (price list 기반)
  const memberDiscount = Math.round(
    ((price.original_price_number - price.calculated_price_number) /
      price.original_price_number) *
      100
  )
  const hasMemberDiscount = memberDiscount > 0

  // 비멤버: metadata 기반 잠재 할인 (가입 시 혜택 안내용)
  const metadataDiscount = Math.round(
    ((price.original_price_number - membershipPrice) /
      price.original_price_number) *
      100
  )
  const hasMetadataDiscount = metadataDiscount > 0

  if (isMembership) {
    // Medusa price list가 실제로 적용된 경우에만 배지 표시
    if (!hasMemberDiscount) {
      return (
        <span className="text-foreground text-[16px] leading-none font-bold whitespace-nowrap">
          {price.calculated_price_number.toLocaleString()}원
        </span>
      )
    }

    return (
      <>
        <div className="flex items-center gap-1 text-[13px] text-gray-400">
          <span className="shrink-0 font-bold">{memberDiscount}%</span>
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
  if (!hasMetadataDiscount) {
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
          <span className="shrink-0 font-bold">{metadataDiscount}%</span>
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
