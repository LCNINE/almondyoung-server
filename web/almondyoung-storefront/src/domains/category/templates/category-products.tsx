import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts, listProductsSorted } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import { getWishlist } from "@lib/api/users/wishlist"
import { PackageX } from "lucide-react"
import { getTranslations } from "next-intl/server"
import type { SortOptions } from "../components/refinement-list/sort-products"
import {
  isSortedOption,
  mapSortParams,
  normalizeCategorySort,
  normalizePageSize,
} from "../utils/sort-mapping"
import InfiniteProducts from "./infinite-products"

export default async function CategoryProducts({
  sortBy,
  limit,
  collectionId,
  categoryIds,
  productsIds,
  countryCode,
}: {
  sortBy?: SortOptions
  limit?: number
  collectionId?: string
  categoryIds?: string[]
  productsIds?: string[]
  countryCode: string
}) {
  const [region, customer] = await Promise.all([
    getRegion(countryCode),
    retrieveCustomer().catch(() => null),
  ])

  if (!region) {
    return null
  }

  const effectiveSortBy = normalizeCategorySort(sortBy)
  const pageSize = normalizePageSize(limit)
  const groups = customer?.groups ?? []
  const isMembership = isMembershipGroup(groups)

  // SSR 첫 페이지(page 1)만 서버에서 조회. 이후 페이지는 클라이언트 무한 로드가 담당한다.
  // 위시리스트는 customer 유무만 필요하므로 상품 조회와 같이 띄운다.
  const [
    {
      response: { products: initialProducts, count: totalCount },
      nextPage: initialNextPage,
    },
    wishlist,
  ] = await Promise.all([
    isSortedOption(effectiveSortBy)
      ? listProductsSorted({
          pageParam: 1,
          ...mapSortParams(effectiveSortBy),
          countryCode,
          categoryId: categoryIds,
          collectionId,
          limit: pageSize,
        })
      : listProducts({
          pageParam: 1,
          countryCode,
          queryParams: {
            limit: pageSize,
            order: "-created_at",
            category_id: categoryIds,
            collection_id: collectionId ? [collectionId] : undefined,
            id: productsIds,
          },
        }),
    // 로그인한 경우에만 위시리스트 조회
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
  ])

  const initialWishlistIds = wishlist.map((item) => item.productId)

  const filteredProducts = filterProductsByMembershipVisibility(
    initialProducts,
    isMembership
  )

  if (filteredProducts.length === 0) {
    const t = await getTranslations("category.products")
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <PackageX className="mb-4 h-12 w-12 text-gray-300" strokeWidth={1.5} />
        <p className="text-[15px] font-medium text-gray-700">
          {t("emptyTitle")}
        </p>
        <p className="mt-1.5 text-[13px] text-gray-400">
          {t("emptyDescription")}
        </p>
      </div>
    )
  }

  return (
    <InfiniteProducts
      key={`${effectiveSortBy}-${pageSize}`}
      initialProducts={filteredProducts}
      initialNextPage={initialNextPage}
      totalCount={totalCount}
      sortBy={effectiveSortBy}
      limit={pageSize}
      categoryIds={categoryIds}
      collectionId={collectionId}
      productsIds={productsIds}
      countryCode={countryCode}
      isMembership={isMembership}
      isLoggedIn={!!customer}
      initialWishlistIds={initialWishlistIds}
    />
  )
}
