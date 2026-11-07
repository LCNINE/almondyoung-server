"use client"

import { getProductPrice } from "@/lib/utils/get-product-price"
import { getPercentageDiff } from "@/lib/utils/get-precentage-diff"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"

export default function ProductPrice({
  product,
  variant,
  quantity = 1,
  unitPrice: tierUnitPrice,
}: {
  product: HttpTypes.StoreProduct
  variant?: HttpTypes.StoreProductVariant
  quantity?: number
  /** 수량 할인이 적용된 개당 가격(없으면 1개 가격) */
  unitPrice?: number
}) {
  const t = useTranslations("productDetail.price")
  const { cheapestPrice, variantPrice } = getProductPrice({
    product,
    variantId: variant?.id,
  })

  const selectedPrice = variant ? variantPrice : cheapestPrice
  if (!selectedPrice) {
    return <div className="block h-9 w-32 animate-pulse bg-gray-100" />
  }

  const unitPrice = tierUnitPrice ?? selectedPrice.calculated_price_number
  const subtotal = unitPrice * quantity
  const percentageDiff = getPercentageDiff(selectedPrice.original_price_number, unitPrice)

  const hasDiscount = Number(percentageDiff) > 0

  return (
    <div className="relative flex flex-col">
      {hasDiscount && (
        <span className="absolute -top-4 right-0 text-xs text-gray-400 line-through">
          {(selectedPrice.original_price_number * quantity).toLocaleString()}
          {t("won")}
        </span>
      )}

      <div className="flex items-center gap-2">
        {hasDiscount && (
          <span className="text-sm font-semibold text-red-500">
            {percentageDiff}%
          </span>
        )}

        <span className="text-base font-bold">
          {subtotal.toLocaleString()}
          {t("won")}
        </span>

      </div>

    </div>
  )
}
