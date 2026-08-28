"use client"

import { VariantPrice } from "@/lib/types/common/price"
import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
import { DiscountBadge } from "@/components/shared/badges/discount-badge"

interface Props {
  price: VariantPrice
  membershipPrice: number
  isMembership: boolean
  isMembershipOnly: boolean
  /** 이 가격이 타임세일 price list 에서 나왔는지. */
  isTimeSale?: boolean
}

export default function ProductPrice({
  price,
  membershipPrice,
  isMembership,
  isMembershipOnly,
  isTimeSale,
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

  // 타임세일 중에는 미구독자의 calculated_price 도 정가보다 낮다. 아래 미구독 분기는
  // "calculated_price = 멤버십가" 라는 전제 위에 있어서, 그대로 두면 세일가가 화면 어디에도
  // 안 나온다 — 정가만 취소선으로 찍히고 실제 결제가는 사라진다.
  if (!isMembership && hasMemberDiscount) {
    const saleDiscount = memberDiscount
    // 멤버십가가 지금 보고 있는 값보다 쌀 때만 가입 유인이 된다. 세일가가 더 싸면 거짓말이 된다.
    const membershipStillCheaper = membershipPrice > 0 && membershipPrice < price.calculated_price_number

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1 text-[13px] text-gray-400">
          {!isTimeSale && <span className="shrink-0 font-bold">{saleDiscount}%</span>}
          <span className="min-w-0 truncate line-through">
            {price.original_price_number.toLocaleString()}원
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
          <span
            className={`text-[16px] leading-none font-bold whitespace-nowrap ${
              isTimeSale ? "text-primary" : "text-foreground"
            }`}
          >
            {price.calculated_price_number.toLocaleString()}원
          </span>
        </div>
        {isTimeSale && <DiscountBadge percent={saleDiscount} />}
        {membershipStillCheaper && (
          <div className="flex flex-col gap-0.5 text-[#F2994A]">
            <ProductMembershipBadge size="sm" label="멤버십할인가" />
            <span className="text-[15px] font-bold whitespace-nowrap">
              {membershipPrice.toLocaleString()}원
            </span>
          </div>
        )}
      </div>
    )
  }

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
          {!isTimeSale && <span className="shrink-0 font-bold">{memberDiscount}%</span>}
          <span className="min-w-0 truncate line-through">
            {price.original_price_number.toLocaleString()}원
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-x-1 gap-y-0.5 md:flex-row md:items-center">
          <span
            className={`text-[16px] leading-none font-bold whitespace-nowrap ${
              isTimeSale ? "text-primary" : "text-black"
            }`}
          >
            {price.calculated_price_number.toLocaleString()}원
          </span>

          <ProductMembershipBadge
            size="sm"
            label="멤버십할인가"
            className="shrink-0"
          />
        </div>

        {isTimeSale && <DiscountBadge percent={memberDiscount} />}
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
