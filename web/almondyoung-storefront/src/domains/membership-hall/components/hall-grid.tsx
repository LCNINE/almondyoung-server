import type { HttpTypes } from "@medusajs/types"
import ProductCard from "@/domains/products/components/product-card"
import { getHideMembershipPriceForNonMembers } from "@/lib/utils/product-card"

const PRIORITY_COUNT = 5

export function HallGrid({
  products,
  isMember,
  wishlistIds,
  countryCode,
}: {
  products: HttpTypes.StoreProduct[]
  isMember: boolean
  wishlistIds: string[]
  countryCode: string
}) {
  const wishlist = new Set(wishlistIds)

  return (
    <ul className="grid grid-cols-2 gap-x-2 gap-y-6 md:grid-cols-4 md:gap-x-4 md:gap-y-8 lg:grid-cols-5">
      {products.map((product, index) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            isMembership={isMember}
            isMembershipOnly={getHideMembershipPriceForNonMembers(product)}
            isWishlisted={wishlist.has(product.id ?? "")}
            countryCode={countryCode}
            priority={index < PRIORITY_COUNT}
          />
        </li>
      ))}
    </ul>
  )
}
