import { SearchPageClient } from "../components/search-page-client"
import { searchProducts } from "@lib/api/pim/search"
import { listProducts } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getMembershipGroupIdFromEnv } from "@/lib/utils/membership-group"
import { getWishlist } from "@lib/api/users/wishlist"
import type { HttpTypes } from "@medusajs/types"

export interface SearchProductResult {
  items: HttpTypes.StoreProduct[]
  pagination: {
    page: number
    size: number
    total: number
    totalPages: number
  }
}

interface SearchContainerProps {
  searchParams: Promise<{
    q?: string
    page?: string
    sort?: string | string[]
    categoryIds?: string | string[]
    brands?: string | string[]
    minPrice?: string
    maxPrice?: string
  }>
  params: Promise<{
    countryCode: string
  }>
}

export async function SearchContainer({
  searchParams,
  params,
}: SearchContainerProps) {
  const { q, sort, categoryIds, brands, minPrice, maxPrice } =
    await searchParams
  const { countryCode } = await params
  const region = await getRegion(countryCode)

  const keyword = q?.trim() || ""
  const size = 20

  const normalizedSort = normalizeSearchSort(sort)
  const brandList = toQueryArray(brands)
  const categoryIdList = toQueryArray(categoryIds)

  const customer = await retrieveCustomer().catch(() => null)
  const isMembership = !!customer?.groups?.some(
    (group) => group.id === getMembershipGroupIdFromEnv()
  )

  // 로그인한 경우에만 위시리스트 조회
  const wishlist = customer ? await getWishlist().catch(() => []) : []
  const wishlistIds = wishlist.map((item) => item.productId)

  let searchResult: SearchProductResult = {
    items: [],
    pagination: {
      page: 1,
      size: 20,
      total: 0,
      totalPages: 0,
    },
  }

  if (keyword) {
    try {
      // 1. search 서비스 OpenSearch 검색으로 productId 목록 가져오기
      const searchApiResult = await searchProducts({
        q: keyword,
        page: 1,
        size,
        sort: normalizedSort,
        categoryIds: categoryIdList,
        brands: brandList,
        minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      })

      if ("data" in searchApiResult && searchApiResult.data) {
        const searchData = searchApiResult.data

        // 2. productId 목록 추출 (medusa에서 handle로 사용)
        const masterIds = searchData.items.map((item) => item.productId)

        let items: HttpTypes.StoreProduct[] = []

        if (masterIds.length > 0) {
          // 3. medusa에서 handle로 상품 조회
          const medusaResult = await listProducts({
            queryParams: {
              handle: masterIds,
              limit: masterIds.length,
            },
            regionId: region?.id,
          })

          // 4. 검색 순서대로 정렬 (검색 관련도 유지)
          const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
          items = [...medusaResult.response.products].sort((a, b) => {
            const orderA = orderMap.get(a.handle ?? "") ?? Infinity
            const orderB = orderMap.get(b.handle ?? "") ?? Infinity
            return orderA - orderB
          })
        }

        searchResult = {
          items,
          pagination: {
            page: searchData.pagination.page,
            size: searchData.pagination.size,
            total: searchData.pagination.total,
            totalPages: searchData.pagination.totalPages,
          },
        }
      }
    } catch (error) {
      console.error("[SearchContainer] 검색 실패:", error)
    }
  }

  return (
    <SearchPageClient
      keyword={keyword}
      searchResult={searchResult}
      countryCode={countryCode}
      regionId={region?.id}
      isMembership={isMembership}
      isLoggedIn={!!customer}
      wishlistIds={wishlistIds}
    />
  )
}

function toQueryArray(value?: string | string[]): string[] | undefined {
  if (!value) return undefined
  if (Array.isArray(value)) {
    const list = value.flatMap((item) => item.split(","))
    const filtered = list.map((item) => item.trim()).filter(Boolean)
    return filtered.length > 0 ? filtered : undefined
  }
  const filtered = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return filtered.length > 0 ? filtered : undefined
}

function normalizeSearchSort(
  value?: string | string[]
): "relevance" | "newest" | "price_asc" | "price_desc" {
  const sortValue = Array.isArray(value) ? value[0] : value
  switch (sortValue) {
    case "newest":
      return "newest"
    case "price-asc":
    case "price_asc":
      return "price_asc"
    case "price-desc":
    case "price_desc":
      return "price_desc"
    case "relevance":
    default:
      return "relevance"
  }
}
