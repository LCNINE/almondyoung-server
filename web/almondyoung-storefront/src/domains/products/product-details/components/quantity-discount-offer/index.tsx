"use client"

import { useId, useState } from "react"
import type { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import {
  productQuantitySummary,
  variantTierRows,
  type QuantityPricingContext,
} from "../product-actions/quantity-pricing"
import QuantityBundlePicker from "../quantity-bundle-picker"
import QuantityOptionNote from "../quantity-option-note"

type QuantityDiscountOfferProps = {
  product: Pick<HttpTypes.StoreProduct, "variants" | "metadata">
  context: QuantityPricingContext
  focusVariant?: HttpTypes.StoreProductVariant
  quantity?: number
  onSelect?: (quantity: number) => void
  className?: string
}

/** 미리보기 옵션은 구매 옵션과 별도로 보관한다. 살 옵션을 고르기 전에도 실제 묶음 가격을 비교할 수 있다. */
export default function QuantityDiscountOffer({
  product,
  context,
  focusVariant,
  quantity,
  onSelect,
  className,
}: QuantityDiscountOfferProps) {
  const t = useTranslations("productDetail.quantityDiscount")
  const id = useId()
  const [previewVariantId, setPreviewVariantId] = useState<string | null>(null)

  const offers = (product.variants ?? [])
    .map((variant) => ({
      variant,
      ...variantTierRows(variant, product, context),
    }))
    .filter(
      (offer) =>
        offer.rows.length > 0 ||
        offer.memberHints.length > 0 ||
        offer.hiddenMemberQuantity
    )

  const focus = focusVariant
    ? {
        variant: focusVariant,
        ...variantTierRows(focusVariant, product, context),
      }
    : null

  const offer =
    focus ??
    offers.find((item) => item.variant.id === previewVariantId) ??
    offers[0]

  if (!offers.length || !offer || offer.currentPrice === null) return null

  if (
    focus &&
    !focus.rows.length &&
    !focus.memberHints.length &&
    !focus.hiddenMemberQuantity
  ) {
    const summary = productQuantitySummary(product, context)

    return summary ? (
      <QuantityOptionNote
        kind="notEligible"
        summary={summary}
        optionLabel={focus.variant.title ?? undefined}
        className={className}
      />
    ) : null
  }

  const membershipPrice = Number(offer.variant.metadata?.membershipPrice)
  const memberBasePrice =
    Number.isFinite(membershipPrice) && membershipPrice > 0
      ? Math.min(offer.currentPrice, membershipPrice)
      : offer.currentPrice
  const showPreviewOptions = !focus && (product.variants?.length ?? 0) > 1

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {showPreviewOptions && (
        <div className="flex min-w-0 flex-col gap-2">
          <p id={id} className="text-foreground text-sm font-bold">
            {t("previewOptions")}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("previewDescription")}
          </p>
          {offers.length > 4 ? (
            <select
              aria-labelledby={id}
              value={offer.variant.id}
              onChange={(event) => setPreviewVariantId(event.target.value)}
              className="border-border bg-background text-foreground min-h-11 w-full rounded-lg border px-3 text-sm"
            >
              {offers.map((item) => (
                <option key={item.variant.id} value={item.variant.id}>
                  {item.variant.title}
                </option>
              ))}
            </select>
          ) : (
            <div
              role="group"
              aria-labelledby={id}
              className="flex flex-wrap gap-2"
            >
              {offers.map((item) => (
                <button
                  key={item.variant.id}
                  type="button"
                  aria-pressed={item.variant.id === offer.variant.id}
                  onClick={() => setPreviewVariantId(item.variant.id)}
                  className={cn(
                    "min-h-11 rounded-lg border px-3 py-2 text-sm font-medium",
                    item.variant.id === offer.variant.id
                      ? "border-mint-deep bg-mint-tint text-mint-deep"
                      : "border-border bg-background text-foreground"
                  )}
                >
                  {item.variant.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <QuantityBundlePicker
        rows={offer.rows}
        memberHints={offer.memberHints}
        hiddenMemberQuantity={offer.hiddenMemberQuantity}
        currentPrice={offer.currentPrice}
        memberBasePrice={memberBasePrice}
        quantity={focus ? quantity : undefined}
        onSelect={focus ? onSelect : undefined}
        optionLabel={
          (product.variants?.length ?? 0) > 1
            ? (offer.variant.title ?? undefined)
            : undefined
        }
      />
      {showPreviewOptions && offer.rows.length === 0 && (
        <p className="text-muted-foreground text-xs">
          {t("previewPurchaseHint")}
        </p>
      )}
    </div>
  )
}
