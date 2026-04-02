import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts, listProductsSorted } from "@/lib/api/medusa/products"
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

  const isSorted =
    sortBy === "price_asc" || sortBy === "price_desc" || sortBy === "sales_desc"

  const { response } = isSorted
    ? await listProductsSorted({
        pageParam: page,
        sortBy:
          sortBy === "price_asc"
            ? "min_price"
            : sortBy === "price_desc"
              ? "max_price"
              : "sales_count",
        order: sortBy === "price_asc" ? "asc" : "desc",
        countryCode,
        categoryId: categoryIds,
        collectionId,
        limit: PRODUCT_LIMIT,
      })
    : await listProducts({
        pageParam: page,
        countryCode,
        queryParams: {
          limit: PRODUCT_LIMIT,
          category_id: categoryIds,
          collection_id: collectionId ? [collectionId] : undefined,
          id: productsIds,
        },
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
        className="grid w-full grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
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
