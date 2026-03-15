"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { HttpTypes } from "@medusajs/types"
import ProductPrice from "./price"
import Thumbnail from "../thumbnail"

export default function ProductCard({
  product,
  isMembership,
  isMembershipOnly,
  rank,
}: {
  product: HttpTypes.StoreProduct
  isMembership: boolean
  isMembershipOnly: boolean
  rank?: number
}) {
  const { cheapestPrice } = getProductPrice({
    product,
  })

  return (
    <LocalizedClientLink
      href={`/products/${product.handle}`}
      className="group cursor-pointer"
    >
      <div>
        <Thumbnail
          thumbnail={product.thumbnail}
          images={product.images}
          size="full"
          rank={rank}
        />

        <div className="mt-4">
          <h3 className="line-clamp-1 text-[14px] leading-tight text-gray-600">
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
