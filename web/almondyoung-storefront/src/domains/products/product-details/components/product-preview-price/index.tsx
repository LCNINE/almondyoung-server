"use client"

import { ProductMembershipBadge } from "@/components/shared/badges/product-membership-badge"
import { TimeSaleBadge } from "@/components/shared/badges/time-sale-badge"
import { TimeSaleCountdown } from "@/components/shared/time-sale-countdown"
import { useTimeSaleForVariant } from "@/components/providers/time-sale-provider"
import {
  getPricesForVariant,
  getProductPrice,
} from "@/lib/utils/get-product-price"
import {
  getIsMembershipOnly,
  getRequiresMembershipToPurchase,
} from "@/lib/utils/product-card"
import { HttpTypes } from "@medusajs/types"
import { Lock } from "lucide-react"
import { useTranslations } from "next-intl"

interface Props {
  hasMembership: boolean
  product: HttpTypes.StoreProduct
}

export default function ProductPreviewPrice({ hasMembership, product }: Props) {
  const t = useTranslations("productDetail.price")
  const tSale = useTranslations("home.timeSale")
  const { cheapestPrice, cheapestVariant } = getProductPrice({ product })
  // 세일이 여럿이라 전역 종료 시각이 없다 — 이 품목의 가격을 만든 세일의 것을 쓴다.
  const timeSale = useTimeSaleForVariant(cheapestVariant)
  const isTimeSale = timeSale !== null
  const endsAt = timeSale?.endsAt ?? null

  if (!cheapestPrice) return null

  // 멤버십가 비공개 여부 (비회원에게 멤버십가 숫자 대신 "멤버십 회원 공개" 표시)
  const isMembershipOnly = getIsMembershipOnly(product)

  const membershipPrice = cheapestVariant?.metadata?.membershipPrice as
    | number
    | undefined

  const hasMembershipPrice =
    typeof membershipPrice === "number" && membershipPrice > 0

  // 멤버십가는 지금 보고 있는 값보다 쌀 때만 가입 유인이 된다. 타임세일가가 더 싸면 "가입 시 절약"
  // 은 거짓말이 되고, 실제로 20,000원을 19,800원보다 싸다고 광고하게 된다.
  const membershipBeatsCurrentPrice =
    hasMembershipPrice && membershipPrice < cheapestPrice.calculated_price_number

  const membershipDiscountRate = membershipBeatsCurrentPrice
    ? Math.round(
        ((cheapestPrice.calculated_price_number - membershipPrice) /
          cheapestPrice.calculated_price_number) *
          100
      )
    : 0

  const membershipSavings = membershipBeatsCurrentPrice
    ? cheapestPrice.calculated_price_number - membershipPrice
    : 0

  // 멤버: Medusa가 실제 적용한 할인 (price list 기반)
  const memberActualDiscount = Math.round(
    ((cheapestPrice.original_price_number -
      cheapestPrice.calculated_price_number) /
      cheapestPrice.original_price_number) *
      100
  )
  const hasMemberActualDiscount = memberActualDiscount > 0

  const isMembershipApplied = hasMembership && hasMemberActualDiscount

  const showOriginalPrice =
    cheapestPrice.calculated_price_number < cheapestPrice.original_price_number

  // 옵션마다 가격이 다르면 대표가는 "최저가"이므로 "~"를 붙여 시작가임을 알림
  const variantAmounts =
    product.variants
      ?.map((v) => getPricesForVariant(v)?.calculated_price_number)
      .filter((n): n is number => typeof n === "number") ?? []
  const hasPriceRange =
    variantAmounts.length > 1 &&
    Math.min(...variantAmounts) !== Math.max(...variantAmounts)

  // 멤버십가 비공개 상품: 비회원에게도 일반 판매가는 그대로 보여주고,
  // 아래 멤버십가 프로모션 영역에서 숫자 대신 "멤버십 회원 공개"를 표시
  const showMembershipPriceHiddenNotice = !hasMembership && isMembershipOnly

  const showMembersOnlyPurchaseNotice =
    !hasMembership && getRequiresMembershipToPurchase(product)

  return (
    <div className="flex flex-col gap-1.5 pt-0 pb-2">
      {isTimeSale && endsAt && (
        <div className="flex items-baseline gap-2">
          <TimeSaleBadge className="self-center" />
          <span className="text-muted-foreground text-[12px]">
            {tSale("countdownLabel")}
          </span>
          <TimeSaleCountdown
            endsAt={endsAt}
            compact
            className="text-primary text-[17px] leading-none font-bold tabular-nums"
          />
        </div>
      )}

      {/* 원래 가격 (취소선) */}
      {showOriginalPrice && (
        <span className="text-sm text-gray-400 line-through">
          {cheapestPrice.original_price}
        </span>
      )}

      {/* 최종 가격 */}
      {isMembershipApplied ? (
        <div className="flex flex-col gap-2">
          <ProductMembershipBadge size="md" label={t("membershipBadgeLabel")} />
          <div className="flex items-center gap-2">
            <span className="text-xl font-semibold text-red-500">
              {memberActualDiscount}%
            </span>
            <span className="text-xl font-bold">
              {cheapestPrice.calculated_price_number.toLocaleString()}
              {t("won")}
              {hasPriceRange && t("priceFrom")}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">
            {cheapestPrice.calculated_price_number.toLocaleString()}
            {t("won")}
            {hasPriceRange && t("priceFrom")}
          </span>

          {cheapestPrice.percentage_diff &&
            Number(cheapestPrice.percentage_diff) > 0 && (
              <span className="text-sm font-semibold text-red-500">
                {cheapestPrice.percentage_diff}%
              </span>
            )}
        </div>
      )}

      {/* 비멤버에게 멤버십 가격 프로모션 (비공개 상품은 숫자 대신 안내 문구) */}
      {showMembershipPriceHiddenNotice ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <ProductMembershipBadge
              size="md"
              label={t("membershipBadgeLabel")}
            />
            <span className="text-primary text-lg font-bold">
              {t("membershipOnlyPrice")}
            </span>
          </div>
        </div>
      ) : (
        !hasMembership &&
        hasMembershipPrice &&
        membershipDiscountRate > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ProductMembershipBadge
                size="md"
                label={t("membershipBadgeLabel")}
              />
              <span className="text-primary text-sm font-semibold">
                {membershipDiscountRate}% OFF
              </span>
              <span className="text-primary text-lg font-bold">
                {membershipPrice.toLocaleString()}
                {t("won")}
              </span>
            </div>
            <p className="text-primary text-xs font-medium">
              {t("memberSavings", {
                amount: membershipSavings.toLocaleString(),
              })}
            </p>
          </div>
        )
      )}

      {showMembersOnlyPurchaseNotice && (
        <div className="bg-muted mt-1 flex items-start gap-3 rounded-xl px-4 py-3.5">
          <Lock className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-foreground text-sm font-bold">
              {t("membersOnlyTitle")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[13px]">
              {t("membersOnlyDescription")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
