import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { Pagination } from "../components/pagination"
import ProductCard from "@/domains/products/components/product-card"
import { SortOptions } from "../components/refinement-list/sort-products"

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
  categoryId,
  productsIds,
  countryCode,
}: {
  sortBy?: SortOptions
  page: number
  collectionId?: string
  categoryId?: string
  productsIds?: string[]
  countryCode: string
}) {
  const queryParams: PaginatedProductsParams = {
    limit: 12,
  }

  if (collectionId) {
    queryParams["collection_id"] = [collectionId]
  }

  if (categoryId) {
    queryParams["category_id"] = [categoryId]
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
                isMembership={
                  groups?.some(
                    (group) =>
                      group.id === process.env.MEDUSA_MEMBERSHIP_GROUP_ID
                  ) ?? false
                }
                isMembershipOnly={
                  p.metadata?.isMembershipOnly === true ||
                  p.metadata?.isMembershipOnly === "true"
                }
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
