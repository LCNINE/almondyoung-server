"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ProductGrid } from "@/components/products/product-grid"
import { SearchHistory } from "@components/search/search-history"
import { useSearchHistory } from "@hooks/ui/use-search-history"
import CustomDropdown from "@components/dropdown"
import type { ProductCardProps, SearchProductResult } from "@lib/types/ui/product"
import { SearchEmptyState } from "./search-empty-state"
import { useUser } from "@/contexts/user-context"
import { useMembershipPricing } from "@/hooks/use-membership-pricing"
import { useInfiniteScroll } from "@/hooks/ui/use-infinite-scroll"
import { getListCacheSnapshot, useListCache } from "@/hooks/ui/use-list-cache"
import { searchProducts } from "@lib/api/pim/search"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { Spinner } from "@/components/shared/spinner"

interface SearchPageClientProps {
  keyword: string
  searchResult: SearchProductResult
  countryCode: string
  regionId?: string
}

const SORT_OPTIONS = [
  { id: "relevance", label: "관련도순" },
  { id: "price_asc", label: "낮은가격순" },
  { id: "price_desc", label: "높은가격순" },
  { id: "newest", label: "최신순" },
]
const CACHE_TTL_MS = 0

export function SearchPageClient({
  keyword,
  searchResult,
  countryCode,
  regionId,
}: SearchPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { keywords: historyKeywords } = useSearchHistory()
  const { user } = useUser()
  const { isMembershipPricing } = useMembershipPricing()
  const isLoggedIn = !!user
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

  const cacheKey = useMemo(
    () =>
      [
        "search-products",
        countryCode,
        regionId ?? "region-none",
        keyword || "keyword-none",
        currentSort,
        String(currentSize),
        categoryIds.join(",") || "category-none",
        brands.join(",") || "brand-none",
        minPrice?.toString() ?? "min-none",
        maxPrice?.toString() ?? "max-none",
      ].join("|"),
    [
      brands,
      categoryIds,
      countryCode,
      currentSize,
      currentSort,
      keyword,
      maxPrice,
      minPrice,
      regionId,
    ]
  )

  const cachedSnapshot = useMemo(
    () => getListCacheSnapshot<ProductCardProps>(cacheKey, CACHE_TTL_MS),
    [cacheKey]
  )

  const [items, setItems] = useState<ProductCardProps[]>(() => {
    if (cachedSnapshot?.items?.length) {
      return cachedSnapshot.items
    }
    return searchResult.items
  })
  const [total, setTotal] = useState(() => {
    if (cachedSnapshot) {
      return cachedSnapshot.total
    }
    return searchResult.pagination.total
  })
  const [currentPage, setCurrentPage] = useState(() => {
    if (cachedSnapshot) {
      return Math.max(cachedSnapshot.currentPage, urlPage)
    }
    return urlPage
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const isLoadingMoreRef = useRef(false)

  const hasKeyword = keyword.length > 0
  const hasResults = items.length > 0
  const totalPages = Math.max(1, Math.ceil(total / currentSize))
  const hasMore = items.length < total

  const sortedItems = useMemo(() => {
    if (currentSort !== "price_asc" && currentSort !== "price_desc") {
      return items
    }

    const getSortPrice = (item: ProductCardProps) => {
      const regularPrice = item.originalPrice > 0 ? item.originalPrice : item.price
      const membershipPrice = item.debugPrices?.membershipPrice

      if (
        isMembershipPricing &&
        typeof membershipPrice === "number" &&
        membershipPrice > 0
      ) {
        return membershipPrice
      }

      return regularPrice
    }

    const sorted = [...items]
    if (currentSort === "price_asc") {
      sorted.sort(
        (a, b) => getSortPrice(a) - getSortPrice(b) || a.id.localeCompare(b.id)
      )
      return sorted
    }

    sorted.sort(
      (a, b) => getSortPrice(b) - getSortPrice(a) || a.id.localeCompare(b.id)
    )
    return sorted
  }, [currentSort, isMembershipPricing, items])

  useListCache({
    cacheKey,
    ttlMs: CACHE_TTL_MS,
    items,
    total,
    currentPage,
    scrollYToRestore: cachedSnapshot?.scrollY,
  })

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
          items: [] as ProductCardProps[],
          total: searchData.pagination.total,
        }
      }

      const medusaResult = await getProductList({
        handle: masterIds,
        limit: masterIds.length,
        region_id: regionId,
        includeFullVariants: true,
      })
      const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
      const sortedProducts = [...medusaResult.products].sort((a, b) => {
        const orderA = orderMap.get(a.handle ?? "") ?? Infinity
        const orderB = orderMap.get(b.handle ?? "") ?? Infinity
        return orderA - orderB
      })

      return {
        items: mapStoreProductsToCardProps(sortedProducts),
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
    if (!hasKeyword) {
      setItems([])
      setTotal(0)
      setCurrentPage(1)
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
      return
    }

    const cached = getListCacheSnapshot<ProductCardProps>(cacheKey, CACHE_TTL_MS)
    if (cached?.items?.length) {
      setItems(cached.items)
      setTotal(cached.total)
      setCurrentPage(Math.max(cached.currentPage, urlPage))
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

    let cancelled = false
    const hydratePages = async () => {
      try {
        const pages = Array.from({ length: urlPage }, (_, index) => index + 1)
        const results = await Promise.all(pages.map((page) => fetchSearchPage(page)))
        if (cancelled) return

        const merged = results.flatMap((result) => result.items)
        const last = results[results.length - 1]
        setItems(merged)
        setTotal(last?.total ?? 0)
        setCurrentPage(urlPage)
        isLoadingMoreRef.current = false
        setIsLoadingMore(false)
      } catch (error) {
        console.error("검색 목록 로드 실패:", error)
        isLoadingMoreRef.current = false
        setIsLoadingMore(false)
      }
    }

    void hydratePages()

    return () => {
      cancelled = true
    }
  }, [cacheKey, fetchSearchPage, hasKeyword, searchResult.items, searchResult.pagination.total, urlPage])

  const setUrlPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page <= 1) {
        params.delete("page")
      } else {
        params.set("page", page.toString())
      }
      const query = params.toString()
      router.replace(query ? `/${countryCode}/search?${query}` : `/${countryCode}/search`, {
        scroll: false,
      })
    },
    [countryCode, router, searchParams]
  )

  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore || !hasKeyword) return

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
    return <SearchEmptyState keyword={keyword} historyKeywords={historyKeywords} />
  }

  return (
    <div className="flex flex-col">
      <div className="mb-6">
        <h1 className="mb-2 text-xl font-bold text-gray-900 md:text-2xl">
          <span className="text-olive-600">&apos;{keyword}&apos;</span> 검색결과
        </h1>
        <p className="text-sm text-gray-500">
          총 <span className="font-semibold text-gray-700">{total.toLocaleString()}</span>개의 상품
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
        <ProductGrid
          products={sortedItems}
          showQuickActions
          className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
          countryCode={countryCode}
          isLoggedIn={isLoggedIn}
        />

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

function normalizeSearchSort(value: string | null): "relevance" | "newest" | "price_asc" | "price_desc" {
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
