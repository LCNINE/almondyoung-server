"use client"

import ProductCard from "@/domains/products/components/product-card"
import { Spinner } from "@/components/shared/spinner"
import { useInfiniteScroll } from "@/hooks/ui/use-infinite-scroll"
import CustomDropdown from "@components/dropdown"
import { SearchHistory } from "@components/search/search-history"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import { listProducts } from "@lib/api/medusa/products"
import { searchProducts } from "@lib/api/pim/search"
import type { SearchProductResult } from "../containers/search-container"
import type { HttpTypes } from "@medusajs/types"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { SearchEmptyState } from "./search-empty-state"
import { getProductPrice } from "@/lib/utils/get-product-price"

interface SearchPageClientProps {
  isMembership: boolean
  isLoggedIn: boolean
  keyword: string
  searchResult: SearchProductResult
  countryCode: string
  regionId?: string
}

function getProductSortPrice(
  product: HttpTypes.StoreProduct,
  isMembership: boolean
): number {
  const { cheapestPrice } = getProductPrice({ product })
  if (!cheapestPrice) return 0

  const membershipPrice = product.variants?.[0]?.metadata
    ?.membershipPrice as number

  if (
    isMembership &&
    typeof membershipPrice === "number" &&
    membershipPrice > 0
  ) {
    return membershipPrice
  }

  return (
    cheapestPrice.original_price_number ||
    cheapestPrice.calculated_price_number ||
    0
  )
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
  isLoggedIn,
  countryCode,
  regionId,
}: SearchPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()
  const currentSort = normalizeSearchSort(searchParams.get("sort"))
  const currentSize = searchResult.pagination.size || 20
  const urlPage = Math.max(1, Number(searchParams.get("page")) || 1)

  const categoryIds = useMemo(
    () => normalizeQueryList(searchParams.getAll("categoryIds")),
    [searchParams]
  )
  const brands = useMemo(
    () => normalizeQueryList(searchParams.getAll("brands")),
    [searchParams]
  )
  const minPrice = useMemo(
    () => parseNumberParam(searchParams.get("minPrice")),
    [searchParams]
  )
  const maxPrice = useMemo(
    () => parseNumberParam(searchParams.get("maxPrice")),
    [searchParams]
  )

  const [items, setItems] = useState<HttpTypes.StoreProduct[]>(
    searchResult.items
  )
  const [total, setTotal] = useState(searchResult.pagination.total)
  const [currentPage, setCurrentPage] = useState(urlPage)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const isLoadingMoreRef = useRef(false)
  const isFetchingRef = useRef(false)

  const hasKeyword = keyword.length > 0
  const hasResults = items.length > 0
  const totalPages = Math.max(1, Math.ceil(total / currentSize))
  const hasMore = items.length < total

  const sortedItems = useMemo(() => {
    if (currentSort !== "price_asc" && currentSort !== "price_desc") {
      return items
    }

    const sorted = [...items]
    if (currentSort === "price_asc") {
      sorted.sort(
        (a, b) =>
          getProductSortPrice(a, isMembership) -
            getProductSortPrice(b, isMembership) ||
          (a.id ?? "").localeCompare(b.id ?? "")
      )
      return sorted
    }

    sorted.sort(
      (a, b) =>
        getProductSortPrice(b, isMembership) -
          getProductSortPrice(a, isMembership) ||
        (a.id ?? "").localeCompare(b.id ?? "")
    )
    return sorted
  }, [currentSort, isMembership, items])

  const fetchSearchPage = useCallback(
    async (page: number) => {
      const searchApiResult = await searchProducts({
        q: keyword,
        page,
        size: currentSize,
        sort: currentSort,
        categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
        brands: brands.length > 0 ? brands : undefined,
        minPrice: minPrice ?? undefined,
        maxPrice: maxPrice ?? undefined,
      })

      if (!("data" in searchApiResult) || !searchApiResult.data) {
        throw new Error("검색 API 응답이 비어 있습니다.")
      }

      const searchData = searchApiResult.data
      const masterIds = searchData.items.map((item) => item.productId)
      if (masterIds.length === 0) {
        return {
          items: [] as HttpTypes.StoreProduct[],
          total: searchData.pagination.total,
        }
      }

      const medusaResult = await listProducts({
        queryParams: {
          handle: masterIds,
          limit: masterIds.length,
        },
        regionId,
      })
      const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
      const sortedProducts = [...medusaResult.response.products].sort(
        (a, b) => {
          const orderA = orderMap.get(a.handle ?? "") ?? Infinity
          const orderB = orderMap.get(b.handle ?? "") ?? Infinity
          return orderA - orderB
        }
      )

      return {
        items: sortedProducts,
        total: searchData.pagination.total,
      }
    },
    [
      brands,
      categoryIds,
      currentSize,
      currentSort,
      keyword,
      maxPrice,
      minPrice,
      regionId,
    ]
  )

  useEffect(() => {
    if (isFetchingRef.current) {
      return
    }

    if (!hasKeyword) {
      setItems([])
      setTotal(0)
      setCurrentPage(1)
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
      return
    }

    if (urlPage === 1) {
      setItems(searchResult.items)
      setTotal(searchResult.pagination.total)
      setCurrentPage(1)
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
      return
    }

    isLoadingMoreRef.current = false
    setIsLoadingMore(false)
    isFetchingRef.current = true

    let cancelled = false
    const hydratePages = async () => {
      try {
        const pages = Array.from({ length: urlPage }, (_, index) => index + 1)
        const results = await Promise.all(
          pages.map((page) => fetchSearchPage(page))
        )
        if (cancelled) return

        const merged = results.flatMap((result) => result.items)
        const last = results[results.length - 1]
        setItems(merged)
        setTotal(last?.total ?? 0)
        setCurrentPage(urlPage)
      } catch (error) {
        console.error("검색 목록 로드 실패:", error)
      } finally {
        isLoadingMoreRef.current = false
        setIsLoadingMore(false)
        isFetchingRef.current = false
      }
    }

    void hydratePages()

    return () => {
      cancelled = true
    }
  }, [
    fetchSearchPage,
    hasKeyword,
    searchResult.items,
    searchResult.pagination.total,
    urlPage,
  ])

  const setUrlPage = useCallback((page: number) => {
    if (typeof window === "undefined") return

    const params = new URLSearchParams(window.location.search)
    if (page <= 1) {
      params.delete("page")
    } else {
      params.set("page", page.toString())
    }
    const query = params.toString()
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
    window.history.replaceState(window.history.state, "", nextUrl)
  }, [])

  const loadMore = useCallback(async () => {
    if (
      isLoadingMoreRef.current ||
      isFetchingRef.current ||
      !hasMore ||
      !hasKeyword
    )
      return

    isLoadingMoreRef.current = true
    setIsLoadingMore(true)

    try {
      const nextPage = currentPage + 1
      const next = await fetchSearchPage(nextPage)
      setItems((prev) => [...prev, ...next.items])
      setTotal(next.total)
      setCurrentPage(nextPage)
      setUrlPage(nextPage)
    } catch (error) {
      console.error("검색 상품 추가 로드 실패:", error)
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [currentPage, fetchSearchPage, hasKeyword, hasMore, setUrlPage])

  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    isLoading: isLoadingMore,
    onLoadMore: () => {
      void loadMore()
    },
  })

  const handleSortChange = useCallback(
    (sortId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (sortId === "relevance") {
        params.delete("sort")
      } else {
        params.set("sort", sortId)
      }
      params.delete("page")
      router.push(`/${countryCode}/search?${params.toString()}`)
    },
    [router, searchParams, countryCode]
  )

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
            {total.toLocaleString()}
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
          {sortedItems.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isMembership={isMembership}
              isMembershipOnly={product.metadata?.isMembershipOnly === true}
              isLoggedIn={isLoggedIn}
              countryCode={countryCode}
            />
          ))}
        </div>

        <div ref={sentinelRef} className="h-10 w-full" />

        {isLoadingMore && (
          <div className="flex justify-center">
            <Spinner size="sm" color="gray" />
          </div>
        )}
      </section>
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

function normalizeQueryList(values: string[]): string[] {
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .sort()
}

function parseNumberParam(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
