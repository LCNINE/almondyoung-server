"use client"

import { Badge } from "@/checkout-ui/components/ui/badge"
import { FreeShippingProgress } from "@/checkout-ui/domains/cart/components/free-shipping-progress"
import { ShippingGroupNotice } from "@/checkout-ui/domains/cart/components/shipping-group-notice"
import { cartRequiresShipping } from "@/checkout-ui/lib/api/medusa/shipping-method-policy"
import { getThumbnailUrl } from "@/checkout-ui/lib/utils/get-thumbnail-url"
import { calcItemPrice, formatPrice } from "@/checkout-ui/lib/utils/price-utils"
import { StoreCart, StoreCartLineItem } from "@medusajs/types"
import Image from "next/image"
import { useTranslations } from "next-intl"

interface OrderProductsSectionProps {
  products: StoreCart["items"]
  shipping: number
  /** 카트에 붙은 배송 방법(배송비 그룹당 1개). 2개 이상이면 합계 위에 그룹별 금액을 나눠 보여준다. */
  shippingMethods?: { id: string; name?: string | null; amount?: number | null }[]
  /** 핸드오프로 받은 리전. 상품 링크를 만들 때 쓴다. */
  countryCode: string
}

export const OrderProductsSection = ({
  products,
  shipping,
  shippingMethods,
  countryCode,
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
              countryCode={countryCode}
            />
          ))}
        </div>

        {requiresShipping && (
          <div className="border-t border-gray-100 px-[14px] py-4 lg:px-10">
            <FreeShippingProgress className="mb-3" items={products} />
            {(shippingMethods?.length ?? 0) > 1 && (
              <div className="mb-1 space-y-0.5">
                {shippingMethods!.map((method) => (
                  <p
                    key={method.id}
                    className="text-right text-[12px] text-gray-400 lg:text-xs"
                  >
                    {t("shippingFeeLine", {
                      name: method.name ?? "",
                      amount: formatPrice(method.amount ?? 0),
                    })}
                  </p>
                ))}
              </div>
            )}
            <p className="text-right text-[13px] text-gray-600 lg:text-sm">
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
  countryCode,
}: {
  item: StoreCartLineItem
  showDivider: boolean
  countryCode: string
}) {
  const t = useTranslations("checkout.orderProducts")
  const { thumbnail, product_title, title, variant_title, subtitle, quantity } =
    item
  const productTitle = product_title ?? title
  const { total, originalTotal, hasReducedPrice } = calcItemPrice(item)

  const handle = item.product?.handle
  const storefrontOrigin = process.env.NEXT_PUBLIC_STOREFRONT_ORIGIN ?? ""
  const productHref = handle
    ? `${storefrontOrigin}/${countryCode}/products/${handle}`
    : null

  const summary = (
    <>
      <div className="relative h-[52px] w-[52px] lg:h-[64px] lg:w-[64px]">
        <Image
          src={getThumbnailUrl(thumbnail ?? "")}
          fill
          alt={productTitle}
          sizes="(max-width: 1024px) 52px, 64px"
          className="pointer-events-none rounded-[2px] object-cover select-none lg:rounded-[5px]"
        />
      </div>
      <div className="flex-1">
        <p className="text-[13px] text-gray-900 lg:text-sm">{productTitle}</p>
        <ShippingGroupNotice item={item} className="mt-0.5" />
      </div>
    </>
  )

  return (
    <div className={showDivider ? "border-b border-gray-100 pb-4" : ""}>
      {productHref ? (
        <a
          href={productHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-3 lg:gap-4"
        >
          {summary}
        </a>
      ) : (
        <div className="flex items-start gap-3 lg:gap-4">{summary}</div>
      )}
      <div className="mt-3">
        <div className="flex items-center justify-between rounded-[2px] bg-[#F5F5F5]/50 px-2 py-2 lg:px-3 lg:py-2.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-[2px] border-gray-200 bg-white px-1 py-0 text-[12px] font-medium text-gray-600"
            >
              {t("optionBadge")}
            </Badge>
            <span className="text-[13px] text-gray-600 lg:text-sm">
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
        <span className="text-[13px] text-gray-400 line-through lg:text-sm">
          {formatPrice(originalPrice)}
        </span>
      )}
      <span className="text-[14px] font-medium text-gray-900 lg:text-base">
        {t("amountWon", { amount: formatPrice(price) })}
      </span>
    </div>
  )
}
