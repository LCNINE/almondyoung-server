import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { listProducts, listProductsSorted } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { getWishlist } from "@lib/api/users/wishlist"
import { PackageX } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { SortOptions } from "../components/refinement-list/sort-products"
import { isSortedOption, mapSortParams } from "../utils/sort-mapping"
import InfiniteProducts from "./infinite-products"

const PRODUCT_LIMIT = 12

export default async function CategoryProducts({
  sortBy,
  collectionId,
  categoryIds,
  productsIds,
  countryCode,
}: {
  sortBy?: SortOptions
  collectionId?: string
  categoryIds?: string[]
  productsIds?: string[]
  countryCode: string
}) {
  const region = await getRegion(countryCode)

  if (!region) {
    return null
  }

  const effectiveSortBy: SortOptions = sortBy ?? "created_at"

  // SSR 첫 페이지(page 1)만 서버에서 조회. 이후 페이지는 클라이언트 무한 로드가 담당한다.
  const {
    response: { products: initialProducts, count: totalCount },
    nextPage: initialNextPage,
  } = isSortedOption(effectiveSortBy)
    ? await listProductsSorted({
        pageParam: 1,
        ...mapSortParams(effectiveSortBy),
        countryCode,
        categoryId: categoryIds,
        collectionId,
        limit: PRODUCT_LIMIT,
      })
    : await listProducts({
        pageParam: 1,
        countryCode,
        queryParams: {
          limit: PRODUCT_LIMIT,
          category_id: categoryIds,
          collection_id: collectionId ? [collectionId] : undefined,
          id: productsIds,
        },
      })

  const customer = await retrieveCustomer().catch(() => null)
  const groups = customer?.groups ?? []

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const initialWishlistIds = wishlist.map((item) => item.productId)

  if (initialProducts.length === 0) {
    const t = await getTranslations("category.products")
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
        <PackageX className="w-12 h-12 mb-4 text-gray-300" strokeWidth={1.5} />
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
      key={effectiveSortBy}
      initialProducts={initialProducts}
      initialNextPage={initialNextPage}
      totalCount={totalCount}
      sortBy={effectiveSortBy}
      categoryIds={categoryIds}
      collectionId={collectionId}
      productsIds={productsIds}
      countryCode={countryCode}
      isMembership={isMembershipGroup(groups)}
      isLoggedIn={!!customer}
      initialWishlistIds={initialWishlistIds}
    />
  )
}
