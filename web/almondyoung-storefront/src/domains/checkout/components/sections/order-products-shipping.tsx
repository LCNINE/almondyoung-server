"use client"

import { Badge } from "@/components/ui/badge"
import { FreeShippingProgress } from "@/domains/cart/components/free-shipping-progress"
import { cartRequiresShipping } from "@/lib/api/medusa/shipping-method-policy"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { calcItemPrice, formatPrice } from "@/lib/utils/price-utils"
import { StoreCart, StoreCartLineItem } from "@medusajs/types"
import Image from "next/image"
import { useTranslations } from "next-intl"

interface OrderProductsSectionProps {
  products: StoreCart["items"]
  shipping: number
}

export const OrderProductsSection = ({
  products,
  shipping,
}: OrderProductsSectionProps) => {
  const t = useTranslations("checkout.orderProducts")

  if (!products?.length) {
    return (
      <section aria-labelledby="order-heading" className="mb-8">
        <h2
          id="order-heading"
          className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
        >
          {t("title")}
        </h2>
        <article className="rounded-md border border-gray-200 bg-white p-4 lg:rounded-[10px] lg:p-10">
          <p className="text-center text-gray-500">{t("empty")}</p>
        </article>
      </section>
    )
  }

  const itemSubtotal = products.reduce(
    (sum, item) => sum + (item.unit_price ?? 0) * (item.quantity ?? 0),
    0
  )

  const requiresShipping = cartRequiresShipping(products)

  return (
    <section aria-labelledby="order-heading" className="mb-8">
      <h2
        id="order-heading"
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        {t("title")}
      </h2>
      <article className="rounded-md border border-gray-200 bg-white lg:rounded-[10px]">
        {/* 상품 목록 */}
        <div className="space-y-4 px-[14px] py-[18px] lg:px-10 lg:py-8">
          {products.map((item, i) => (
            <ProductItem
              key={item.id}
              item={item}
              showDivider={i < products.length - 1}
            />
          ))}
        </div>

        {requiresShipping && (
          <div className="border-t border-gray-100 px-[14px] py-4 lg:px-10">
            <FreeShippingProgress className="mb-3" itemSubtotal={itemSubtotal} />
            <p className="text-right text-[12px] text-gray-600 lg:text-sm">
              {t("shippingFee", { amount: formatPrice(shipping) })}
            </p>
          </div>
        )}
      </article>
    </section>
  )
}

function ProductItem({
  item,
  showDivider,
}: {
  item: StoreCartLineItem
  showDivider: boolean
}) {
  const t = useTranslations("checkout.orderProducts")
  const { thumbnail, product_title, title, variant_title, subtitle, quantity } =
    item
  const productTitle = product_title ?? title
  const { total, originalTotal, hasReducedPrice } = calcItemPrice(item)

  return (
    <div className={showDivider ? "border-b border-gray-100 pb-4" : ""}>
      <div className="flex items-start gap-3 lg:gap-4">
        <div className="relative h-[52px] w-[52px] lg:h-[64px] lg:w-[64px]">
          <Image
            src={getThumbnailUrl(thumbnail ?? "")}
            fill
            alt={productTitle}
            sizes="(max-width: 1024px) 52px, 64px"
            className="pointer-events-none rounded-[2px] object-cover select-none lg:rounded-[5px]"
          />
        </div>
        <p className="flex-1 text-[12px] text-gray-900 lg:text-sm">
          {productTitle}
        </p>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between rounded-[2px] bg-[#F5F5F5]/50 px-2 py-2 lg:px-3 lg:py-2.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-[2px] border-gray-200 bg-white px-1 py-0 text-[11px] font-medium text-gray-600"
            >
              {t("optionBadge")}
            </Badge>
            <span className="text-[12px] text-gray-600 lg:text-sm">
              {t("optionLine", {
                value: variant_title ?? subtitle ?? t("optionDefault"),
                quantity,
              })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <PriceDisplay
              hasDiscount={hasReducedPrice}
              originalPrice={originalTotal}
              price={total}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function PriceDisplay({
  hasDiscount,
  originalPrice,
  price,
}: {
  hasDiscount: boolean
  originalPrice?: number | null
  price: number
}) {
  const t = useTranslations("checkout.orderProducts")
  return (
    <div className="flex items-center gap-1.5 text-right">
      {hasDiscount && (
        <span className="text-[12px] text-gray-400 line-through lg:text-sm">
          {formatPrice(originalPrice)}
        </span>
      )}
      <span className="text-[13px] font-medium text-gray-900 lg:text-base">
        {t("amountWon", { amount: formatPrice(price) })}
      </span>
    </div>
  )
}
