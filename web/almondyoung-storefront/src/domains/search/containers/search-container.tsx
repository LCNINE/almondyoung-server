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
    sort?: string
    brands?: string
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
  const { q, page, sort, brands, minPrice, maxPrice } = await searchParams
  const { countryCode } = await params
  const region = await getRegion(countryCode)

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
      // 1. PIM Elasticsearch 검색으로 master_id 목록 가져오기
      const pimResult = await searchProducts({
        keyword,
        page: currentPage,
        limit,
        sortBy,
        sortOrder,
        brands: brandList,
        minPrice: minPrice ? parseInt(minPrice, 10) : undefined,
        maxPrice: maxPrice ? parseInt(maxPrice, 10) : undefined,
      })

      if ("data" in pimResult && pimResult.data) {
        const searchData = pimResult.data

        // 2. master_id 목록 추출 (medusa에서 handle로 사용)
        const masterIds = searchData.items.map(item => item.master_id)

        let items: ProductCardProps[] = []

        if (masterIds.length > 0) {
          // 3. medusa에서 handle로 상품 조회
          const medusaResult = await getProductList({
            handle: masterIds,
            limit: masterIds.length,
            region_id: region?.id,
          })

          // 4. PIM 검색 순서대로 정렬 (검색 관련도 유지)
          // medusa product의 handle이 PIM master_id와 매핑됨
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
