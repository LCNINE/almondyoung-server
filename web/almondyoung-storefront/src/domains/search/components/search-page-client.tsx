"use client"

import ProductCard from "@/domains/products/components/product-card"
import CustomDropdown from "@components/dropdown"
import { SearchHistory } from "@components/search/search-history"
import { SharedPagination } from "@/components/shared/pagination"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import type { SearchProductResult } from "../containers/search-container"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { SearchEmptyState } from "./search-empty-state"
import { CircleHelp } from "lucide-react"
import { useState } from "react"

interface SearchPageClientProps {
  isMembership: boolean
  isLoggedIn: boolean
  keyword: string
  searchResult: SearchProductResult
  countryCode: string
  regionId?: string
  wishlistIds?: string[]
}

export function SearchPageClient({
  keyword,
  searchResult,
  isMembership,
  countryCode,
  wishlistIds = [],
}: SearchPageClientProps) {
  const router = useRouter()
  const t = useTranslations("search.result")
  const tSort = useTranslations("search.sort")
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()
  const [isReviewInfoOpen, setIsReviewInfoOpen] = useState(false)

  const SORT_OPTIONS = [
    { id: "relevance", label: tSort("relevance") },
    { id: "review", label: tSort("review") },
    { id: "price_asc", label: tSort("priceAsc") },
    { id: "price_desc", label: tSort("priceDesc") },
    { id: "newest", label: tSort("newest") },
  ]

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
          <span className="text-olive-600">{t("title", { keyword })}</span>
        </h1>
        <p className="text-sm text-gray-500">
          {t.rich("totalCount", {
            count: pagination.total.toLocaleString(),
            strong: (chunks) => (
              <span className="font-semibold text-gray-700">{chunks}</span>
            ),
          })}
        </p>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="hidden text-sm text-gray-500 md:block">
          {t("pageInfo", { current: currentPage, total: totalPages })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div
            className="relative flex items-center"
            onMouseEnter={() => setIsReviewInfoOpen(true)}
            onMouseLeave={() => setIsReviewInfoOpen(false)}
          >
            <button
              type="button"
              aria-label={tSort("reviewHelpAria")}
              aria-expanded={isReviewInfoOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olive-500"
              onClick={() => setIsReviewInfoOpen((open) => !open)}
              onBlur={() => setIsReviewInfoOpen(false)}
            >
              <CircleHelp className="h-4 w-4" aria-hidden="true" />
            </button>
            {isReviewInfoOpen && (
              <div
                role="tooltip"
                className="absolute right-0 top-8 z-20 w-64 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs leading-5 text-gray-700 shadow-lg"
              >
                {tSort("reviewHelp")}
              </div>
            )}
          </div>
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
): "relevance" | "newest" | "price_asc" | "price_desc" | "review" {
  if (!value) return "relevance"
  if (value === "price-asc") return "price_asc"
  if (value === "price-desc") return "price_desc"
  if (value === "newest") return "newest"
  if (value === "price_asc") return "price_asc"
  if (value === "price_desc") return "price_desc"
  if (value === "review") return "review"
  return "relevance"
}
