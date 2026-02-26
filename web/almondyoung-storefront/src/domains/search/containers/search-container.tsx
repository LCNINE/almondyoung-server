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
  const { q, page, sort, categoryIds, brands, minPrice, maxPrice } =
    await searchParams
  const { countryCode } = await params
  const region = await getRegion(countryCode)

  const keyword = q?.trim() || ""
  const currentPage = parseInt(page || "1", 10)
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
      const searchApiResult = await searchProducts({
        q: keyword,
        page: currentPage,
        size,
        sort: normalizedSort,
        categoryIds: categoryIdList,
        brands: brandList,
        minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      })

      if ("data" in searchApiResult && searchApiResult.data) {
        const searchData = searchApiResult.data
        const masterIds = searchData.items.map((item) => item.productId)

        let items: ProductCardProps[] = []

        if (masterIds.length > 0) {
          const medusaResult = await getProductList({
            handle: masterIds,
            limit: masterIds.length,
            region_id: region?.id,
          })

          const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
          const sortedProducts = [...medusaResult.products].sort((a, b) => {
            const orderA = orderMap.get(a.handle ?? "") ?? Infinity
            const orderB = orderMap.get(b.handle ?? "") ?? Infinity
            return orderA - orderB
          })

          items = mapStoreProductsToCardProps(sortedProducts)
        }

        searchResult = {
          items,
          pagination: searchData.pagination,
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
      currentPage={currentPage}
      countryCode={countryCode}
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
