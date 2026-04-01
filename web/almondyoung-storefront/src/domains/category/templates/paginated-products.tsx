import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProductsSorted } from "@/lib/api/medusa/products"
import type { ProductSortOption } from "@/lib/types/common/filter"
import { getRegion } from "@/lib/api/medusa/regions"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { Pagination } from "../components/pagination"
import ProductCard from "@/domains/products/components/product-card"
import { SortOptions } from "../components/refinement-list/sort-products"
import { getWishlist } from "@lib/api/users/wishlist"

const PRODUCT_LIMIT = 12

export default async function PaginatedProducts({
  sortBy,
  page,
  collectionId,
  categoryIds,
  productsIds,
  countryCode,
}: {
  sortBy?: SortOptions
  page: number
  collectionId?: string
  categoryIds?: string[]
  productsIds?: string[]
  countryCode: string
}) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const { response } = await listProductsSorted({
    pageParam: page,
    sort: (sortBy as ProductSortOption) || "created_at",
    countryCode,
    categoryIds,
    collectionIds: collectionId ? [collectionId] : undefined,
    productIds: productsIds,
    limit: PRODUCT_LIMIT,
  })

  const { products, count } = response

  const totalPages = Math.ceil(count / PRODUCT_LIMIT)

  const customer = await retrieveCustomer().catch(() => null)
  const groups = customer?.groups ?? []

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = new Set(wishlist.map((item) => item.productId))

  return (
    <>
      <ul
        className="grid w-full grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4"
        data-testid="products-list"
      >
        {products.map((p) => {
          return (
            <li key={p.id}>
              <ProductCard
                product={p}
                isMembership={isMembershipGroup(groups)}
                isMembershipOnly={
                  p.metadata?.isMembershipOnly === true ||
                  p.metadata?.isMembershipOnly === "true"
                }
                isWishlisted={wishlistIds.has(p.id ?? "")}
              />
            </li>
          )
        })}
      </ul>

      {totalPages > 1 && (
        <Pagination
          data-testid="product-pagination"
          page={page}
          totalPages={totalPages}
        />
      )}
    </>
  )
}
