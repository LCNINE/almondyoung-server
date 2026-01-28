"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { BasicProductCard } from "@components/products/product-card"
import { SearchHistory } from "@components/search/search-history"
import { SearchHotKeyword } from "@components/search/search-hot-keyword"
import { SearchPopularKeyword } from "@components/search/search-popular-keyword"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import CustomDropdown from "@components/dropdown"
import type { SearchProductResult } from "@lib/types/ui/product"
import { SearchResultPagination } from "./search-pagination"
import { SearchEmptyState } from "./search-empty-state"

interface SearchPageClientProps {
  keyword: string
  searchResult: SearchProductResult
  currentPage: number
  countryCode: string
}

const SORT_OPTIONS = [
  { id: "relevance", label: "관련도순" },
  { id: "price-asc", label: "낮은가격순" },
  { id: "price-desc", label: "높은가격순" },
  { id: "newest", label: "최신순" },
]

export function SearchPageClient({
  keyword,
  searchResult,
  currentPage,
  countryCode,
}: SearchPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()

  const hasKeyword = keyword.length > 0
  const hasResults = searchResult.items.length > 0
  const total = searchResult.pagination.total
  const totalPages = searchResult.pagination.totalPages

  // 정렬 변경 핸들러
  const handleSortChange = useCallback(
    (sortId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (sortId === "relevance") {
        params.delete("sort")
      } else {
        params.set("sort", sortId)
      }
      params.delete("page") // 정렬 변경 시 첫 페이지로
      router.push(`/${countryCode}/search?${params.toString()}`)
    },
    [router, searchParams, countryCode]
  )

  // 페이지 변경 핸들러
  const handlePageChange = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page === 1) {
        params.delete("page")
      } else {
        params.set("page", page.toString())
      }
      router.push(`/${countryCode}/search?${params.toString()}`)
    },
    [router, searchParams, countryCode]
  )

  // 검색어가 없는 경우: 최근 검색어 / 추천 검색어 / 급상승 검색어 표시
  if (!hasKeyword) {
    return (
      <div className="flex flex-col gap-8">
        {/* 최근 검색어 */}
        {historyKeywords.length > 0 && (
          <section>
            <SearchHistory />
          </section>
        )}

        {/* 추천 검색어 */}
        <section>
          <SearchPopularKeyword />
        </section>

        {/* 급상승 검색어 */}
        <section>
          <SearchHotKeyword />
        </section>
      </div>
    )
  }

  // 검색 결과가 없는 경우
  if (!hasResults) {
    return (
      <SearchEmptyState
        keyword={keyword}
        historyKeywords={historyKeywords}
      />
    )
  }

  // 검색 결과 표시
  return (
    <div className="flex flex-col">
      {/* 검색 헤더 */}
      <div className="mb-6">
        <h1 className="mb-2 text-xl font-bold text-gray-900 md:text-2xl">
          <span className="text-olive-600">&apos;{keyword}&apos;</span> 검색결과
        </h1>
        <p className="text-sm text-gray-500">
          총 <span className="font-semibold text-gray-700">{total.toLocaleString()}</span>개의 상품
        </p>
      </div>

      {/* 정렬 툴바 */}
      <div className="mb-4 flex items-center justify-between">
        <div className="hidden text-sm text-gray-500 md:block">
          {currentPage}/{totalPages} 페이지
        </div>
        <div className="ml-auto">
          <CustomDropdown
            items={SORT_OPTIONS}
            defaultValue={searchParams.get("sort") || "relevance"}
            onSelect={handleSortChange}
          />
        </div>
      </div>

      {/* 상품 그리드 */}
      <section className="mb-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {searchResult.items.map((product, idx) => (
            <BasicProductCard
              key={`${product.id}-${idx}`}
              product={product}
            />
          ))}
        </div>
      </section>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <SearchResultPagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}
