"use client"

import { CategoryCircleTabs } from "@/components/category/category-circle-tabs"
import { BannerCarousel } from "@/components/layout/components/banner/banner-carousel"
import { ProductGrid } from "@/components/products/product-grid"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import { SlidersHorizontal } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "./mobile-filter-sheet"
import CustomDropdown from "@components/dropdown"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"
import type { ProductCardProps } from "@lib/types/ui/product"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { cn } from "@lib/utils"
import { useUser } from "@/contexts/user-context"
import { Spinner } from "@/components/shared/spinner"
import Link from "next/link"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

// 프론트 전용 타입(CategoryInfo)을 별도로 쓰기보다
// 가능하면 DTO나 간단한 인터페이스로 유지하는 것이 좋습니다.
export interface CategoryInfo {
  title: string
  description?: string
  banners?: { id: string; image: { src: string; alt: string } }[]
}

// 정렬 옵션 매핑 (UI id -> Medusa order param)
const SORT_OPTIONS = {
  newest: "-created_at",
  price_asc: "variants.calculated_price",
  price_desc: "-variants.calculated_price",
} as const

const LEGACY_SORT_OPTIONS: Record<string, keyof typeof SORT_OPTIONS> = {
  "price-asc": "price_asc",
  "price-desc": "price_desc",
  ranking: "newest",
  sales: "newest",
}

const DEFAULT_SORT: keyof typeof SORT_OPTIONS = "newest"

const SORT_LABELS: Array<{ id: keyof typeof SORT_OPTIONS; label: string }> = [
  { id: "newest", label: "최신순" },
  { id: "price_asc", label: "낮은가격순" },
  { id: "price_desc", label: "높은가격순" },
]

const DEFAULT_ITEMS_PER_PAGE = 20
const CACHE_TTL_MS = 30 * 60 * 1000

const getApiOrderForSort = (sort: keyof typeof SORT_OPTIONS) => {
  if (sort === "newest") {
    return SORT_OPTIONS.newest
  }

  // Medusa Store API의 order는 상품 엔티티 필드 기준 정렬이라
  // 계산 가격 정렬은 클라이언트에서 처리한다.
  return undefined
}

const sortProductsByOption = (
  items: ProductCardProps[],
  sort: keyof typeof SORT_OPTIONS
) => {
  if (sort === "newest") {
    return items
  }

  const sorted = [...items]
  if (sort === "price_asc") {
    sorted.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
    return sorted
  }

  sorted.sort((a, b) => b.price - a.price || a.id.localeCompare(b.id))
  return sorted
}

type CategoryListCache = {
  ts: number
  products?: ProductCardProps[]
  total: number
  currentPage: number
  scrollY: number
}

const memoryCache = new Map<string, CategoryListCache>()

interface CategoryPageClientProps {
  pathSegments: string[]
  categoryInfo: CategoryInfo
  categoryData: StoreProductCategoryTree // null 가능성 제거 (Container에서 처리함)
  initialProducts?: ProductCardProps[] // 서버에서 로드한 초기 상품 목록
  initialTotal?: number // 전체 상품 수
  countryCode: string
  categoryIds?: string[] // 카테고리 ID 목록
  regionId?: string // 지역 ID
  allCategories?: StoreProductCategoryTree[] // 전체 카테고리 트리
  categoryPath?: StoreProductCategoryTree[]
}

export function CategoryPageClient({
  pathSegments,
  categoryInfo,
  categoryData,
  initialProducts = [],
  initialTotal = 0,
  countryCode,
  categoryIds = [],
  regionId,
  allCategories = [],
  categoryPath = [],
}: CategoryPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const { user } = useUser()
  const isLoggedIn = !!user
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const isLoadingMoreRef = useRef(false)

  const currentSort = useMemo(() => {
    const sort = searchParams.get("sort")
    if (!sort) return DEFAULT_SORT
    if (sort in SORT_OPTIONS) {
      return sort as keyof typeof SORT_OPTIONS
    }
    return LEGACY_SORT_OPTIONS[sort] ?? DEFAULT_SORT
  }, [searchParams])
  const currentLimit = Number(searchParams.get("limit")) || DEFAULT_ITEMS_PER_PAGE
  const urlPage = Math.max(1, Number(searchParams.get("page")) || 1)

  const cacheKey = useMemo(() => {
    return [
      "category-products",
      pathSegments.join("/"),
      currentSort,
      String(currentLimit),
      regionId ?? "region-none",
      categoryIds.join(",") || "category-none",
    ].join("|")
  }, [categoryIds, currentLimit, currentSort, pathSegments, regionId])

  // 스크롤 복원 대상 (useState 초기화 시 설정)
  const scrollTargetRef = useRef(0)

  const [products, setProducts] = useState<ProductCardProps[]>(() => {
    const cached = memoryCache.get(cacheKey)
    if (cached?.products?.length && Date.now() - cached.ts <= CACHE_TTL_MS) {
      scrollTargetRef.current = cached.scrollY
      return cached.products
    }
    return initialProducts
  })
  const [total, setTotal] = useState(() => {
    const cached = memoryCache.get(cacheKey)
    if (cached && Date.now() - cached.ts <= CACHE_TTL_MS) {
      return cached.total
    }
    return initialTotal
  })
  const [currentPage, setCurrentPage] = useState(() => {
    const cached = memoryCache.get(cacheKey)
    if (cached && Date.now() - cached.ts <= CACHE_TTL_MS) {
      return Math.max(cached.currentPage, urlPage)
    }
    return urlPage
  })
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const hasMore = useMemo(() => products.length < total, [products.length, total])
  const showOverlay = isPending && products.length === 0
  const breadcrumbs = useMemo(
    () =>
      categoryPath.map((node, index) => ({
        id: node.id,
        name: node.name,
        href: `/${countryCode}/category/${categoryPath
          .slice(0, index + 1)
          .map((item) => item.handle || item.id)
          .join("/")}`,
      })),
    [categoryPath, countryCode]
  )
  const showBreadcrumb = breadcrumbs.length > 1
  const showMobileEllipsis = breadcrumbs.length > 3
  const mobileBreadcrumbs = showMobileEllipsis
    ? [breadcrumbs[breadcrumbs.length - 2], breadcrumbs[breadcrumbs.length - 1]]
    : breadcrumbs

  // URL 파라미터 업데이트 함수
  const updateParams = useCallback(
    (params: { sort?: keyof typeof SORT_OPTIONS; limit?: number }) => {
      const newParams = new URLSearchParams(searchParams.toString())

      if (params.sort !== undefined) {
        if (params.sort === DEFAULT_SORT) {
          newParams.delete("sort")
        } else {
          newParams.set("sort", params.sort)
        }
        newParams.delete("page")
      }

      if (params.limit !== undefined) {
        if (params.limit === DEFAULT_ITEMS_PER_PAGE) {
          newParams.delete("limit")
        } else {
          newParams.set("limit", String(params.limit))
        }
        newParams.delete("page")
      }

      const queryString = newParams.toString()
      router.push(queryString ? `?${queryString}` : window.location.pathname, {
        scroll: false,
      })
    },
    [router, searchParams]
  )

  const setUrlPage = useCallback(
    (page: number) => {
      const newParams = new URLSearchParams(searchParams.toString())

      if (page <= 1) {
        newParams.delete("page")
      } else {
        newParams.set("page", String(page))
      }

      const queryString = newParams.toString()
      router.replace(queryString ? `?${queryString}` : window.location.pathname, {
        scroll: false,
      })
    },
    [router, searchParams]
  )

  const fetchProductsPage = useCallback(
    async (page: number) => {
      const sortOrder = getApiOrderForSort(currentSort)
      const result = await getProductList({
        page,
        limit: currentLimit,
        categoryId: categoryIds,
        region_id: regionId,
        order: sortOrder,
      })

      const mappedProducts = mapStoreProductsToCardProps(result.products)
      return {
        products: sortProductsByOption(mappedProducts, currentSort),
        total: result.count,
      }
    },
    [categoryIds, currentLimit, currentSort, regionId]
  )

  // 스크롤 위치 복원 (memoryCache에서 초기화된 경우)
  useEffect(() => {
    const scrollY = scrollTargetRef.current
    if (scrollY <= 0) return

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: "auto" })
        scrollTargetRef.current = 0
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 정렬/개수/카테고리 변경 시 데이터 로드
  useEffect(() => {
    // memoryCache에 유효한 데이터가 있으면 복원 (뒤로 가기, 정렬 복귀 등)
    // ref 대신 직접 확인 → StrictMode 이중 호출에도 안전
    const cached = memoryCache.get(cacheKey)
    if (cached?.products?.length && Date.now() - cached.ts <= CACHE_TTL_MS) {
      setProducts(cached.products)
      setTotal(cached.total)
      setCurrentPage(Math.max(cached.currentPage, urlPage))
      return
    }

    // 기본 설정이면 서버 초기 데이터 사용
    if (
      currentSort === DEFAULT_SORT &&
      currentLimit === DEFAULT_ITEMS_PER_PAGE &&
      urlPage === 1 &&
      initialProducts.length > 0
    ) {
      setProducts(initialProducts)
      setTotal(initialTotal)
      setCurrentPage(1)
      return
    }

    isLoadingMoreRef.current = false
    setIsLoadingMore(false)

    startTransition(async () => {
      try {
        if (urlPage > 1) {
          const pages = Array.from({ length: urlPage }, (_, index) => index + 1)
          const results = await Promise.all(
            pages.map((page) => fetchProductsPage(page))
          )
          const merged = results.flatMap((result) => result.products)
          const last = results[results.length - 1]
          setProducts(sortProductsByOption(merged, currentSort))
          setTotal(last?.total ?? 0)
          setCurrentPage(urlPage)
        } else {
          const { products: nextProducts, total: nextTotal } =
            await fetchProductsPage(1)
          setProducts(nextProducts)
          setTotal(nextTotal)
          setCurrentPage(1)
        }
      } catch (error) {
        console.error("상품 목록 로드 실패:", error)
      }
    })
  }, [
    cacheKey,
    currentSort,
    currentLimit,
    categoryIds,
    regionId,
    fetchProductsPage,
    initialProducts,
    initialTotal,
    urlPage,
  ])

  // 스크롤 위치, 로드된 목록? 캐시 저장
  useEffect(() => {
    if (typeof window === "undefined") return

    let rafId = 0
    const saveCache = (scrollY: number) => {
      const payload: CategoryListCache = {
        ts: Date.now(),
        products,
        total,
        currentPage,
        scrollY,
      }
      memoryCache.set(cacheKey, payload)
      try {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(payload))
      } catch {
        const minimalPayload: CategoryListCache = {
          ts: Date.now(),
          total,
          currentPage,
          scrollY,
        }
        memoryCache.set(cacheKey, minimalPayload)
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify(minimalPayload))
        } catch {

        }
      }
    }

    const onScroll = () => {
      if (rafId) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        saveCache(window.scrollY)
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })

    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId)
      }
      window.removeEventListener("scroll", onScroll)
      saveCache(window.scrollY)
    }
  }, [cacheKey, currentPage, products, total])

  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMore) return

    isLoadingMoreRef.current = true
    setIsLoadingMore(true)

    try {
      const nextPage = currentPage + 1
      const { products: nextProducts, total: nextTotal } =
        await fetchProductsPage(nextPage)

      setProducts((prev) =>
        sortProductsByOption([...prev, ...nextProducts], currentSort)
      )
      setTotal(nextTotal)
      setCurrentPage(nextPage)
      setUrlPage(nextPage)
    } catch (error) {
      console.error("상품 추가 로드 실패:", error)
    } finally {
      isLoadingMoreRef.current = false
      setIsLoadingMore(false)
    }
  }, [currentPage, currentSort, fetchProductsPage, hasMore, setUrlPage])

  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !hasMore) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore()
        }
      },
      { rootMargin: "200px 0px" }
    )

    observer.observe(target)

    return () => {
      observer.disconnect()
    }
  }, [hasMore, loadMore])

  const openMobileFilter = () => {
    overlay.open(({ isOpen, close, unmount }) => (
      <MobileFilterSheet isOpen={isOpen} close={close} exit={unmount} />
    ))
  }

  return (
    <main className="">
      <div className="container mx-auto max-w-[1360px]">
        <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
          <aside className="hidden w-[233px] shrink-0 md:block">
            <ProductFilterSidebar
              categories={allCategories}
              currentCategoryId={categoryData.id}
              countryCode={countryCode}
            />
          </aside>
          <div className="min-w-0 flex-1">
            {/* 카테고리 헤더(타이틀/설명/배너) */}
            <div className="mb-8">
              {showBreadcrumb && (
                <>
                  <Breadcrumb className="mb-2 hidden md:block">
                    <BreadcrumbList>
                      {breadcrumbs.map((crumb, index) => {
                        const isLast = index === breadcrumbs.length - 1
                        return (
                          <Fragment key={crumb.id}>
                            {index > 0 && (
                              <BreadcrumbSeparator className="mx-1 text-gray-500" />
                            )}
                            <BreadcrumbItem>
                              {isLast ? (
                                <BreadcrumbPage className="font-semibold text-gray-900">
                                  {crumb.name}
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink asChild className="text-gray-600 hover:text-gray-900">
                                  <Link href={crumb.href}>{crumb.name}</Link>
                                </BreadcrumbLink>
                              )}
                            </BreadcrumbItem>
                          </Fragment>
                        )
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>

                  <Breadcrumb className="mb-2 md:hidden">
                    <BreadcrumbList>
                      {showMobileEllipsis && (
                        <>
                          <BreadcrumbItem>
                            <BreadcrumbLink asChild className="text-gray-600 hover:text-gray-900">
                              <Link href={breadcrumbs[0].href}>{breadcrumbs[0].name}</Link>
                            </BreadcrumbLink>
                          </BreadcrumbItem>
                          <BreadcrumbSeparator className="text-gray-500" />
                          <BreadcrumbItem>
                            <BreadcrumbEllipsis className="h-auto w-auto text-gray-500" />
                          </BreadcrumbItem>
                          <BreadcrumbSeparator className="text-gray-500" />
                        </>
                      )}
                      {mobileBreadcrumbs.map((crumb, index) => {
                        const isLast = index === mobileBreadcrumbs.length - 1
                        return (
                          <Fragment key={crumb.id}>
                            {index > 0 && <BreadcrumbSeparator className="text-gray-500" />}
                            <BreadcrumbItem>
                              {isLast ? (
                                <BreadcrumbPage className="font-semibold text-gray-900">
                                  {crumb.name}
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink asChild className="text-gray-600 hover:text-gray-900">
                                  <Link href={crumb.href}>{crumb.name}</Link>
                                </BreadcrumbLink>
                              )}
                            </BreadcrumbItem>
                          </Fragment>
                        )
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>
                </>
              )}

              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="flex-1">
                  <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {categoryInfo.title}
                  </h1>

                  {categoryInfo.description ? (
                    <p className="text-sm leading-relaxed text-gray-600 md:text-base">
                      {categoryInfo.description}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {categoryData.category_children &&
              categoryData.category_children.length > 0 && (
                <CategoryCircleTabs
                  items={categoryData.category_children}
                  selectedId=""
                  onSelect={() => { }}
                  countryCode={countryCode}
                  parentSegments={categoryPath.map((node) => node.handle || node.id)}
                />
              )}

            {categoryInfo.banners && categoryInfo.banners.length > 0 && (
              <section className="my-4">
                <BannerCarousel
                  slides={categoryInfo.banners}
                  height="120px"
                  autoPlay={true}
                  autoPlayInterval={6000}
                  className="lg:overflow-hidden lg:rounded-2xl"
                />
              </section>
            )}

            <section>
              {/* 모바일: 필터 버튼 + 정렬 툴바 */}
              <div className="mb-4 flex items-center justify-between md:hidden">
                <p className="text-sm text-gray-600">
                  총{" "}
                  <span className="font-semibold text-gray-900">{total}</span>개
                </p>
                <div className="flex items-center gap-3">
                  <CustomDropdown
                    items={SORT_LABELS}
                    defaultValue={currentSort}
                    onSelect={(id) =>
                      updateParams({ sort: (id in SORT_OPTIONS
                        ? (id as keyof typeof SORT_OPTIONS)
                        : DEFAULT_SORT) })
                    }
                  />
                  <button
                    onClick={openMobileFilter}
                    className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap font-['Pretendard'] text-sm font-medium text-gray-700 transition-colors"
                    aria-label="필터 열기"
                  >
                    필터
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 데스크톱: 정렬 툴바 */}
              <div className="mb-5 hidden bg-gray-100 px-3.5 py-2.5 md:block">
                {/* 정렬 옵션 */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap lg:divide-x lg:divide-gray-300">
                  {SORT_LABELS.map((option, index) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateParams({ sort: option.id })}
                      className={cn(
                        "shrink-0 whitespace-nowrap font-['Pretendard'] text-base",
                        index > 0 ? "lg:pl-4" : "",
                        index < SORT_LABELS.length - 1 ? "lg:pr-4" : "",
                        currentSort === option.id
                          ? "font-bold text-stone-900"
                          : "font-normal text-gray-500 hover:text-stone-900"
                      )}
                      aria-pressed={currentSort === option.id}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="relative">
              {/* 로딩 오버레이 */}
              {showOverlay && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                  <Spinner size="md" color="blue" />
                </div>
              )}

              {/* Product Grid */}
              {products.length > 0 ? (
                <>
                  <ProductGrid
                    products={products}
                    showQuickActions
                    className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
                    countryCode={countryCode}
                    isLoggedIn={isLoggedIn}
                  />

                  {/* 페이지네이션 */}
                  <div ref={sentinelRef} className="h-10 w-full" />

                  {isLoadingMore && (
                    <div className="mt-6 flex items-center justify-center">
                      <Spinner size="sm" color="gray" />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-[200px] items-center justify-center">
                  <p className="text-gray-500">상품이 없습니다.</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
