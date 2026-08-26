"use client"

import ProductCard from "@/domains/products/components/product-card"
import {
  ProductSortTabs,
  type ProductSortTabOption,
} from "@/components/products/product-sort-tabs"
import { toGaCurrency, trackEvent } from "@/lib/analytics/gtag"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { getIsMembershipOnly } from "@/lib/utils/product-card"
import type { HttpTypes } from "@medusajs/types"
import { SearchHistory } from "@components/search/search-history"
import { SharedPagination } from "@/components/shared/pagination"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import type { SearchProductResult } from "../data/search-results"
import { useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { SearchEmptyState } from "../components/search-empty-state"
import { useEffect } from "react"

interface SearchResultsProps {
  isMembership: boolean
  isLoggedIn: boolean
  keyword: string
  searchResult: SearchProductResult
  countryCode: string
  regionId?: string
  wishlistIds?: string[]
  /** 검색어가 브랜드관 브랜드와 매칭될 때 최상단에 띄우는 카드 */
  brandBanner?: React.ReactNode
  /** 영타 교정 안내 + 연관검색어 */
  correctionNotice?: React.ReactNode
}

export function SearchResults({
  keyword,
  searchResult,
  isMembership,
  countryCode,
  wishlistIds = [],
  brandBanner = null,
  correctionNotice = null,
}: SearchResultsProps) {
  const router = useRouter()
  const t = useTranslations("search.result")
  const tSort = useTranslations("search.sort")
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()



  const currentSort = normalizeSearchSort(searchParams.get("sort"))
  const currentPage = Math.max(1, Number(searchParams.get("page")) || 1)
  const { items, pagination } = searchResult
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.size))

  const hasKeyword = keyword.length > 0
  const hasResults = items.length > 0

  // GA4 향상된 측정의 사이트 검색은 최초 로드 시에만 URL을 보므로 SPA 라우팅 검색이 통째로
  // 누락된다. 검색어당 1회 직접 발생시킨다.
  useEffect(() => {
    if (!hasKeyword) return
    trackEvent("view_search_results", {
      search_term: keyword,
      search_results_count: pagination.total,
    })
  }, [keyword, hasKeyword, pagination.total])

  const handleProductSelect = (
    product: HttpTypes.StoreProduct,
    index: number
  ) => {
    const { cheapestPrice } = getProductPrice({ product })

    trackEvent("select_item", {
      item_list_id: "search_results",
      item_list_name: "Search Results",
      search_term: keyword,
      currency: toGaCurrency(cheapestPrice?.currency_code),
      items: [
        {
          item_id: product.id,
          item_name: product.title,
          price: cheapestPrice?.calculated_price_number ?? 0,
          quantity: 1,
          index: (currentPage - 1) * pagination.size + index,
        },
      ],
    })
  }

  const sortTabOptions: ProductSortTabOption[] = [
    { value: "relevance", label: tSort("relevance") },
    { value: "review", label: tSort("review") },
    { value: "price_asc", label: tSort("priceAsc") },
    { value: "price_desc", label: tSort("priceDesc") },
    { value: "newest", label: tSort("newest") },
  ]

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
      <div className="flex flex-col">
        {brandBanner}
        {correctionNotice}
        <SearchEmptyState keyword={keyword} historyKeywords={historyKeywords} />
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {brandBanner}
      {correctionNotice}
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

      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <ProductSortTabs
            options={sortTabOptions}
            value={currentSort}
            onChange={handleSortChange}
            label={tSort("label")}
          />
        </div>
        <div className="hidden shrink-0 text-sm text-gray-500 md:block">
          {t("pageInfo", { current: currentPage, total: totalPages })}
        </div>
      </div>

      <section className="mb-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              isMembership={isMembership}
              isMembershipOnly={getIsMembershipOnly(product)}
              countryCode={countryCode}
              isWishlisted={wishlistIds.includes(product.id ?? "")}
              onClick={() => handleProductSelect(product, index)}
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
