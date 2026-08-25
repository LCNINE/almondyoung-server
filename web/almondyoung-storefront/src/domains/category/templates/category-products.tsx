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
import { CategoryPaginationLinks } from "../components/pagination-links"

export default async function CategoryProducts({
  sortBy,
  limit,
  page = 1,
  collectionId,
  categoryIds,
  productsIds,
  countryCode,
  paginationBaseUrl,
}: {
  sortBy?: SortOptions
  limit?: number
  page?: number
  collectionId?: string
  categoryIds?: string[]
  productsIds?: string[]
  countryCode: string
  paginationBaseUrl?: string
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

  // ?page=N 이 오면 그 페이지를 서버에서 렌더한다. 크롤러가 따라갈 URL 을 만들기
  // 위한 것이고, 사람은 평소처럼 무한 로드로 다닌다 (UA 분기 아님).
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
          pageParam: page,
          ...mapSortParams(effectiveSortBy),
          countryCode,
          categoryId: categoryIds,
          collectionId,
          limit: pageSize,
        })
      : listProducts({
          pageParam: page,
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

  // Medusa 응답 미들웨어가 비회원에게 members-only 상품을 걸러내므로 첫 페이지가
  // 통째로 빌 수 있다(예: 최신순 + 신규 상품이 전부 멤버십 전용). 다음 페이지가 남아
  // 있는데 빈 상태로 끝내면 실제로는 상품이 있는 카테고리가 "상품이 없습니다"로 보인다.
  // 이 경우엔 무한 로드에 넘겨 다음 페이지를 이어받게 한다.
  if (filteredProducts.length === 0 && !initialNextPage) {
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

  const lastPage = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <>
      <InfiniteProducts
        key={`${effectiveSortBy}-${pageSize}-${page}`}
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
      {paginationBaseUrl && lastPage > 1 && (
        <CategoryPaginationLinks
          baseUrl={paginationBaseUrl}
          page={page}
          lastPage={lastPage}
        />
      )}
    </>
  )
}
