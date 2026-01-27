import { SearchPageClient } from "../components/search-page-client"
import { searchProducts } from "@lib/api/pim/search"
import type { ProductCard, SearchProductResult } from "@lib/types/ui/product"
import type { ProductSearchItemDto } from "@lib/types/dto/pim"

interface SearchContainerProps {
  searchParams: Promise<{
    q?: string
    page?: string
    sort?: string
    brands?: string
    minPrice?: string
    maxPrice?: string
  }>
  params: Promise<{
    countryCode: string
  }>
}

// PIM 검색 결과를 ProductCard로 변환
// TODO: 서버에서 thumbnail 필드 추가 후 매핑 업데이트
const mapSearchItemToProductCard = (item: ProductSearchItemDto): ProductCard => ({
  id: item.master_id,
  name: item.name,
  thumbnail: "", // TODO: 서버 인덱스에 thumbnail 필드 추가 필요
  basePrice: item.price ?? undefined,
  status: item.status === "active" ? "active" : "inactive",
  brand: item.brand ?? undefined,
  createdAt: item.created_at,
})

export async function SearchContainer({
  searchParams,
  params,
}: SearchContainerProps) {
  const { q, page, sort, brands, minPrice, maxPrice } = await searchParams
  const { countryCode } = await params

  const keyword = q?.trim() || ""
  const currentPage = parseInt(page || "1", 10)
  const limit = 20

  // 정렬 파라미터 파싱
  let sortBy: "relevance" | "price" | "createdAt" = "relevance"
  let sortOrder: "asc" | "desc" = "desc"

  if (sort) {
    if (sort === "price-asc") {
      sortBy = "price"
      sortOrder = "asc"
    } else if (sort === "price-desc") {
      sortBy = "price"
      sortOrder = "desc"
    } else if (sort === "newest") {
      sortBy = "createdAt"
      sortOrder = "desc"
    }
  }

  // 브랜드 필터 파싱
  const brandList = brands ? brands.split(",").filter(Boolean) : undefined

  let searchResult: SearchProductResult = {
    items: [],
    pagination: {
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    },
  }

  if (keyword) {
    try {
      // PIM Elasticsearch 검색
      const result = await searchProducts({
        keyword,
        page: currentPage,
        limit,
        sortBy,
        sortOrder,
        brands: brandList,
        minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      })

      if ("data" in result && result.data) {
        const searchData = result.data

        searchResult = {
          items: searchData.items.map(mapSearchItemToProductCard),
          pagination: searchData.pagination,
          aggregations: searchData.aggregations,
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
