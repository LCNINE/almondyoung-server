"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { ProductQuickActions } from "domains/products/components/product-quick-actions"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"
import ProductPrice from "./price"
import Thumbnail from "../thumbnail"

export default function ProductCard({
  product,
  isMembership,
  isMembershipOnly,
  rank,
  countryCode = "kr",
  isWishlisted = false,
}: {
  product: HttpTypes.StoreProduct
  isMembership: boolean
  isMembershipOnly: boolean
  rank?: number
  countryCode?: string
  isWishlisted?: boolean
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })

  const isSingleOption = (product.variants?.length ?? 0) <= 1

  return (
    <LocalizedClientLink
      href={`/products/${product.handle}`}
      className="group cursor-pointer"
    >
      <div>
        <div className="relative">
          <Thumbnail
            thumbnail={product.thumbnail}
            images={product.images}
            size="full"
            rank={rank}
          />
          <ProductQuickActions
            productId={product.id ?? ""}
            productHandle={product.handle ?? ""}
            variantId={product.variants?.[0]?.id}
            isSingleOption={isSingleOption}
            countryCode={countryCode}
            isWishlisted={isWishlisted}
          />
        </div>

        <div className="mt-4 min-h-20">
          <h3 className="text-foreground line-clamp-1 text-[14px] leading-tight">
            {product.title}
          </h3>

          <div className="flex flex-col gap-3">
            {cheapestPrice && (
              <ProductPrice
                price={cheapestPrice}
                membershipPrice={
                  product.variants?.[0]?.metadata?.membershipPrice as number
                }
                isMembership={isMembership}
                isMembershipOnly={isMembershipOnly}
              />
            )}
          </div>
        </div>
      </div>
    </LocalizedClientLink>
  )
}
