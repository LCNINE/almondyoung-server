"use client"

import { useQuantityDiscountNow } from "@/hooks/use-quantity-discount-now"
import { useTranslations } from "next-intl"
import type { HttpTypes } from "@medusajs/types"
import { variantTierRows } from "@/domains/products/product-details/components/product-actions/quantity-pricing"
import { getHideMembershipPriceForNonMembers } from "@/lib/utils/product-card"

type QuantityDiscountBadgeProps = {
  product: Pick<HttpTypes.StoreProduct, "metadata">
  variant?: HttpTypes.StoreProductVariant | null
  isMembership: boolean
}

/** 목록 카드의 «3개↑ 5%». 대표가는 그대로 두고 조건과 함께 첫 구간만 알린다. */
export default function QuantityDiscountBadge({ product, variant, isMembership }: QuantityDiscountBadgeProps) {
  const t = useTranslations("productCard")
  const now = useQuantityDiscountNow([product.metadata])
  if (!variant) return null

  const [first] = variantTierRows(variant, product, {
    isMember: isMembership,
    hideMemberPrices: getHideMembershipPriceForNonMembers(product),
    now,
  }).rows
  if (!first) return null

  return (
    <span className="bg-secondary text-foreground inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium">
      {t("quantityDiscountBadge", { count: first.minQuantity, percent: first.percent })}
    </span>
  )
}
