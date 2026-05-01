"use client"

import ProductCard from "@/domains/products/components/product-card"
import CustomDropdown from "@components/dropdown"
import { SearchHistory } from "@components/search/search-history"
import { SharedPagination } from "@/components/shared/pagination"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import type { SearchProductResult } from "../containers/search-container"
import { useRouter, useSearchParams } from "next/navigation"
import { SearchEmptyState } from "./search-empty-state"

interface SearchPageClientProps {
  isMembership: boolean
  isLoggedIn: boolean
  keyword: string
  searchResult: SearchProductResult
  countryCode: string
  regionId?: string
  wishlistIds?: string[]
}

const SORT_OPTIONS = [
  { id: "relevance", label: "관련도순" },
  { id: "price_asc", label: "낮은가격순" },
  { id: "price_desc", label: "높은가격순" },
  { id: "newest", label: "최신순" },
]

export function SearchPageClient({
  keyword,
  searchResult,
  isMembership,
  countryCode,
  wishlistIds = [],
}: SearchPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()

  const currentSort = normalizeSearchSort(searchParams.get("sort"))
  const currentPage = Math.max(1, Number(searchParams.get("page")) || 1)
  const { items, pagination } = searchResult
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.size))

  const hasKeyword = keyword.length > 0
  const hasResults = items.length > 0

  const handleSortChange = (sortId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (sortId === "relevance") {
      params.delete("sort")
    } else {
      params.set("sort", sortId)
    }
    params.delete("page")
    router.push(`/${countryCode}/search?${params.toString()}`)
  }

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (page <= 1) {
      params.delete("page")
    } else {
      params.set("page", page.toString())
    }
    router.push(`/${countryCode}/search?${params.toString()}`)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  if (!hasKeyword) {
    return (
      <div className="flex flex-col gap-8">
        {historyKeywords.length > 0 && (
          <section>
            <SearchHistory />
          </section>
        )}
      </div>
    )
  }

  if (!hasResults) {
    return (
      <SearchEmptyState keyword={keyword} historyKeywords={historyKeywords} />
    )
  }

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <h1 className="mb-2 text-xl font-bold text-gray-900 md:text-2xl">
          <span className="text-olive-600">&apos;{keyword}&apos;</span> 검색결과
        </h1>
        <p className="text-sm text-gray-500">
          총{" "}
          <span className="font-semibold text-gray-700">
            {pagination.total.toLocaleString()}
          </span>
          개의 상품
        </p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="hidden text-sm text-gray-500 md:block">
          {currentPage}/{totalPages} 페이지
        </div>
        <div className="ml-auto">
          <CustomDropdown
            items={SORT_OPTIONS}
            defaultValue={currentSort}
            onSelect={handleSortChange}
          />
        </div>
      </div>

      <section className="mb-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isMembership={isMembership}
              isMembershipOnly={product.metadata?.isMembershipOnly === true}
              countryCode={countryCode}
              isWishlisted={wishlistIds.includes(product.id ?? "")}
            />
          ))}
        </div>
      </section>

      <SharedPagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={handlePageChange}
        className="mb-8"
      />
    </div>
  )
}

function normalizeSearchSort(
  value: string | null
): "relevance" | "newest" | "price_asc" | "price_desc" {
  if (!value) return "relevance"
  if (value === "price-asc") return "price_asc"
  if (value === "price-desc") return "price_desc"
  if (value === "newest") return "newest"
  if (value === "price_asc") return "price_asc"
  if (value === "price_desc") return "price_desc"
  return "relevance"
}
