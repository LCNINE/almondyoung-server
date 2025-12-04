"use client"

import { useEffect, useState, useMemo } from "react"
import { useSearchParams, useRouter, useParams } from "next/navigation"
import { searchProductService } from "@lib/services/pim/products/searchProductService"
import type { ProductCard } from "@lib/types/ui/product"
import ProductsGrid from "@components/products/products-grid"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar/index"

export default function Search() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const params = useParams()
  const countryCode = (params?.countryCode as string) || "kr"

  // URL 파라미터 읽기
  // q 파라미터(검색 입력에서 사용) 또는 keyword 파라미터 모두 지원
  const keyword = searchParams.get("keyword") || searchParams.get("q") || undefined
  const categoryId = searchParams.get("categoryId") || undefined
  const brands = searchParams.getAll("brands")
  const minPrice = searchParams.get("minPrice")
    ? Number(searchParams.get("minPrice"))
    : undefined
  const maxPrice = searchParams.get("maxPrice")
    ? Number(searchParams.get("maxPrice"))
    : undefined
  const status = searchParams.get("status") || undefined
  const sortBy = (searchParams.get("sortBy") as "relevance" | "price" | "createdAt") || "relevance"
  const sortOrder = (searchParams.get("sortOrder") as "asc" | "desc") || "desc"
  const page = searchParams.get("page") ? Number(searchParams.get("page")) : 1
  const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : 20

  // 태그 필터 파싱 (tagFilters[0][groupId]=color&tagFilters[0][valueIds][]=red 형식)
  const tagFilters = useMemo(() => {
    const filters: Array<{ groupId: string; valueIds: string[] }> = []
    const groupIds = new Set<string>()
    
    // tagFilters[0][groupId], tagFilters[1][groupId] 등을 찾기
    searchParams.forEach((value, key) => {
      const match = key.match(/^tagFilters\[(\d+)\]\[groupId\]$/)
      if (match) {
        const index = parseInt(match[1])
        groupIds.add(index.toString())
      }
    })

    // 각 그룹의 valueIds 수집
    groupIds.forEach((indexStr) => {
      const groupId = searchParams.get(`tagFilters[${indexStr}][groupId]`)
      if (groupId) {
        const valueIds = searchParams.getAll(`tagFilters[${indexStr}][valueIds][]`)
        if (valueIds.length > 0) {
          filters.push({ groupId, valueIds })
        }
      }
    })

    return filters.length > 0 ? filters : undefined
  }, [searchParams])

  // 상태 관리
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ProductCard[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })

  // 검색 실행
  useEffect(() => {
    let ignore = false

    const performSearch = async () => {
      try {
        setLoading(true)
        setError(null)

        const result = await searchProductService({
          keyword,
          categoryId,
          brands: brands.length > 0 ? brands : undefined,
          minPrice,
          maxPrice,
          status,
          tagFilters,
          sortBy,
          sortOrder,
          page,
          limit,
        })

        if (ignore) return

        setItems(result.items)
        setPagination(result.pagination)
      } catch (err) {
        if (!ignore) {
          const errorMessage =
            err instanceof Error ? err.message : "검색 중 오류가 발생했습니다."
          setError(errorMessage)
          console.error("❌ [Search] 검색 실패:", err)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    performSearch()

    return () => {
      ignore = true
    }
  }, [keyword, categoryId, brands.join(","), minPrice, maxPrice, status, JSON.stringify(tagFilters), sortBy, sortOrder, page, limit])

  // 페이지 변경 핸들러
  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("page", newPage.toString())
    router.push(`/${countryCode}/search?${params.toString()}`)
  }

  // 현재 페이지의 상품 목록 (페이지네이션용)
  const currentProducts = useMemo(() => {
    // ProductsGrid는 이미 페이지네이션된 데이터를 받으므로 전체 items 전달
    return items
  }, [items])

  return (
    <div className="flex gap-6">
      {/* 필터 사이드바 */}
      <aside className="hidden w-[233px] flex-shrink-0 md:block">
        <ProductFilterSidebar />
      </aside>

      {/* 메인 콘텐츠 */}
      <div className="flex-1 min-w-0">
        {/* 정렬 툴바 */}
        <ProductSortToolbar />

        {/* 로딩 상태 */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-gray-600">검색 중...</p>
          </div>
        )}

        {/* 에러 상태 */}
        {error && (
          <div className="flex items-center justify-center py-12">
            <p className="text-red-600">{error}</p>
          </div>
        )}

        {/* 검색 결과 */}
        {!loading && !error && (
          <>
            {items.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-600">검색 결과가 없습니다.</p>
              </div>
            ) : (
              <ProductsGrid
                items={items}
                currentProducts={currentProducts}
                totalPages={pagination.totalPages}
                currentPage={pagination.page}
                setCurrentPage={handlePageChange}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
