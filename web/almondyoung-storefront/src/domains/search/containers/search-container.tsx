import { SearchPageClient } from "../components/search-page-client"
import { searchProducts } from "@lib/api/pim/search"
import { getProductList } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import type { ProductCardProps, SearchProductResult } from "@lib/types/ui/product"

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

        let items: ProductCardProps[] = []

        if (masterIds.length > 0) {
          // 3. medusa에서 handle로 상품 조회
          const medusaResult = await getProductList({
            handle: masterIds,
            limit: masterIds.length,
            region_id: region?.id,
            includeFullVariants: true,
          })

          // 4. 검색 순서대로 정렬 (검색 관련도 유지)
          const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
          const sortedProducts = [...medusaResult.products].sort((a, b) => {
            const orderA = orderMap.get(a.handle ?? "") ?? Infinity
            const orderB = orderMap.get(b.handle ?? "") ?? Infinity
            return orderA - orderB
          })

          // 5. medusa 상품을 ProductCardProps로 변환
          items = mapStoreProductsToCardProps(sortedProducts)
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
