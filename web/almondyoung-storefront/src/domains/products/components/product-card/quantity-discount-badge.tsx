"use client"

import { useQuantityDiscountNow } from "@/hooks/use-quantity-discount-now"
import { useTranslations } from "next-intl"
import type { HttpTypes } from "@medusajs/types"
import { productQuantitySummary } from "@/domains/products/product-details/components/product-actions/quantity-pricing"
import { getHideMembershipPriceForNonMembers } from "@/lib/utils/product-card"

type QuantityDiscountBadgeProps = {
  product: Pick<HttpTypes.StoreProduct, "metadata" | "variants">
  isMembership: boolean
}

/**
 * 목록 카드의 «3개↑ 5%». 옵션마다 구간이 다르면 «3개↑ 최대 10%», 회원 전용 구간만 있으면 비회원에게 «멤버십 3개↑ 10%».
 * 대표가는 그대로 두고 조건과 함께 첫 구간만 알린다.
 */
export default function QuantityDiscountBadge({ product, isMembership }: QuantityDiscountBadgeProps) {
  const t = useTranslations("productCard")
  const now = useQuantityDiscountNow([product.metadata])
  const summary = productQuantitySummary(product, {
    isMember: isMembership,
    hideMemberPrices: getHideMembershipPriceForNonMembers(product),
    now,
  })
  if (!summary) return null

  const key = summary.memberOnly
    ? summary.varies
      ? "quantityDiscountMemberBadgeMax"
      : "quantityDiscountMemberBadge"
    : summary.varies
      ? "quantityDiscountBadgeMax"
      : "quantityDiscountBadge"

  return (
    <span className="bg-secondary text-foreground inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium">
      {t(key, { count: summary.minQuantity, percent: summary.percent })}
    </span>
  )
}
