import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { Pagination } from "../components/pagination"
import ProductCard from "@/domains/products/components/product-card"
import { SortOptions } from "../components/refinement-list/sort-products"
import { getWishlist } from "@lib/api/users/wishlist"

const PRODUCT_LIMIT = 12

type PaginatedProductsParams = {
  limit: number
  collection_id?: string[]
  category_id?: string[]
  id?: string[]
  order?: string
}

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
  const queryParams: PaginatedProductsParams = {
    limit: 12,
  }

  if (collectionId) {
    queryParams["collection_id"] = [collectionId]
  }

  if (categoryIds?.length) {
    queryParams["category_id"] = categoryIds
  }

  if (productsIds) {
    queryParams["id"] = productsIds
  }

  // sortBy를 서버 order 파라미터로 변환
  if (sortBy === "created_at") {
    queryParams["order"] = "-created_at" // 최신순 (내림차순)
  } else if (sortBy === "price_asc") {
    queryParams["order"] = "+variants.calculated_price.calculated_amount"
  } else if (sortBy === "price_desc") {
    queryParams["order"] = "-variants.calculated_price.calculated_amount"
  }

  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const {
    response: { products, count },
  } = await listProducts({
    pageParam: page,
    queryParams,
    countryCode,
  })

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
