"use client"

import { CategoryCircleTabs } from "@/components/category/category-circle-tabs"
import { BannerCarousel } from "@/components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  TimeSaleProductCard,
} from "@components/products/product-card"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import ProductSortToolbar from "@/components/products/product-sort-toolbar"
import { SectionSliderHorizontal } from "@components/section-sliders-horizontal"
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "./mobile-filter-sheet"
import CustomDropdown from "@components/dropdown"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"
import type { ProductCard } from "@lib/types/ui/product"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"
import { getProductList } from "@lib/api/medusa/products"
import { mapMedusaProductsToCards } from "@lib/utils/map-medusa-product-card"

// 프론트 전용 타입(CategoryInfo)을 별도로 쓰기보다
// 가능하면 DTO나 간단한 인터페이스로 유지하는 것이 좋습니다.
export interface CategoryInfo {
  title: string
  description?: string
  banners?: { id: string; image: { src: string; alt: string } }[]
}

// 정렬 옵션 매핑 (UI id -> Medusa order param)
const SORT_OPTIONS = {
  ranking: undefined, // 기본 정렬 (Medusa 기본)
  "price-asc": "variants.calculated_price", // 가격 낮은순
  "price-desc": "-variants.calculated_price", // 가격 높은순
  sales: undefined, // 판매량순 (Medusa에서 지원하지 않으면 클라이언트 정렬 필요)
  newest: "-created_at", // 최신순
} as const

const ITEMS_PER_PAGE = 20

interface CategoryPageClientProps {
  slug: string
  categoryInfo: CategoryInfo
  categoryData: StoreProductCategoryTree // null 가능성 제거 (Container에서 처리함)
  initialProducts?: ProductCard[] // 서버에서 로드한 초기 상품 목록
  initialTotal?: number // 전체 상품 수
  countryCode: string
  categoryIds?: string[] // 카테고리 ID 목록
  regionId?: string // 지역 ID
}

export function CategoryPageClient({
  slug,
  categoryInfo,
  categoryData,
  initialProducts = [],
  initialTotal = 0,
  countryCode,
  categoryIds = [],
  regionId,
}: CategoryPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  // URL에서 페이지와 정렬 파라미터 읽기
  const currentPage = Number(searchParams.get("page")) || 1
  const currentSort = searchParams.get("sort") || "ranking"

  // 상품 목록 상태
  const [products, setProducts] = useState<ProductCard[]>(initialProducts)
  const [total, setTotal] = useState(initialTotal)
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  // URL 파라미터 업데이트 함수
  const updateParams = useCallback(
    (params: { page?: number; sort?: string }) => {
      const newParams = new URLSearchParams(searchParams.toString())

      if (params.page !== undefined) {
        if (params.page === 1) {
          newParams.delete("page")
        } else {
          newParams.set("page", String(params.page))
        }
      }

      if (params.sort !== undefined) {
        if (params.sort === "ranking") {
          newParams.delete("sort")
        } else {
          newParams.set("sort", params.sort)
        }
        // 정렬 변경 시 페이지 1로 초기화
        newParams.delete("page")
      }

      const queryString = newParams.toString()
      router.push(queryString ? `?${queryString}` : window.location.pathname, {
        scroll: false,
      })
    },
    [router, searchParams]
  )

  // 페이지/정렬 변경 시 데이터 로드
  useEffect(() => {
    // 초기 로드 시에는 서버에서 받은 데이터 사용
    if (currentPage === 1 && currentSort === "ranking") {
      setProducts(initialProducts)
      setTotal(initialTotal)
      return
    }

    startTransition(async () => {
      try {
        const sortOrder =
          SORT_OPTIONS[currentSort as keyof typeof SORT_OPTIONS]
        const result = await getProductList({
          page: currentPage,
          limit: ITEMS_PER_PAGE,
          categoryId: categoryIds,
          region_id: regionId,
          order: sortOrder,
        })
        setProducts(mapMedusaProductsToCards(result.products))
        setTotal(result.count)
      } catch (error) {
        console.error("상품 목록 로드 실패:", error)
      }
    })
  }, [
    currentPage,
    currentSort,
    categoryIds,
    regionId,
    initialProducts,
    initialTotal,
  ])

  const timeSaleProducts = products
    .filter((product) => product.isTimeSale && product.timeSaleEndTime)
    .map((product) => ({
      ...product,
      timer: product.timeSaleEndTime
        ? getTimerFromEndTime(product.timeSaleEndTime)
        : undefined,
    }))

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
            <ProductFilterSidebar />
          </aside>
          <div className="min-w-0 flex-1">
            {/* 카테고리 헤더(타이틀/설명/배너) */}
            <div className="mb-8">
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
                onSelect={() => {}}
                countryCode={countryCode}
                parentSlug={slug}
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

            {/* 타임 세일 섹션 */}
            {timeSaleProducts.length > 0 && (
              <SectionSliderHorizontal
                title={`${categoryInfo.title} 타임 세일`}
                itemCount={timeSaleProducts.length}
              >
                {timeSaleProducts.map((product) => (
                  <div key={product.id} className="w-48 shrink-0 snap-start">
                    <TimeSaleProductCard product={product} minWidth={192} />
                  </div>
                ))}
              </SectionSliderHorizontal>
            )}
            <section>
              {/* 상품 수 및 정렬 정보 */}
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  총{" "}
                  <span className="font-semibold text-gray-900">{total}</span>개
                  상품
                </p>
              </div>

              {/* 모바일: 필터 버튼 + 정렬 툴바 */}
              <div className="mb-4 flex justify-end gap-4 md:hidden">
                <div>
                  <CustomDropdown
                    items={[
                      { id: "ranking", label: "인기순" },
                      { id: "price-asc", label: "낮은가격순" },
                      { id: "price-desc", label: "높은가격순" },
                      { id: "sales", label: "판매량순" },
                      { id: "newest", label: "최신순" },
                    ]}
                    defaultValue={currentSort}
                    onSelect={(id) => updateParams({ sort: id })}
                  />
                </div>
                <button
                  onClick={openMobileFilter}
                  className="flex h-10 items-center gap-2 font-['Pretendard'] text-sm font-medium text-gray-700 transition-colors"
                  aria-label="필터 열기"
                >
                  필터
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>

              {/* 데스크톱: 정렬 툴바만 */}
              <div className="hidden md:block">
                <ProductSortToolbar
                  activeSort={currentSort}
                  onSortChange={(sort) => updateParams({ sort })}
                />
              </div>
            </section>
            <section className="relative">
              {/* 로딩 오버레이 */}
              {isPending && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
                </div>
              )}

              {/* Product Grid */}
              {products.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {products.map((product, idx) => (
                      <BasicProductCard
                        key={`${product.id}-${idx}`}
                        product={product}
                      />
                    ))}
                  </div>

                  {/* 페이지네이션 */}
                  {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-center gap-2">
                      <button
                        onClick={() =>
                          updateParams({ page: Math.max(1, currentPage - 1) })
                        }
                        disabled={currentPage === 1}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="이전 페이지"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>

                      {/* 페이지 번호 */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        // 현재 페이지 중심으로 5개 페이지 표시
                        let pageNum: number
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (currentPage <= 3) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => updateParams({ page: pageNum })}
                            className={`flex h-10 w-10 items-center justify-center rounded-lg text-sm font-medium ${
                              currentPage === pageNum
                                ? "bg-blue-500 text-white"
                                : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                            }`}
                          >
                            {pageNum}
                          </button>
                        )
                      })}

                      <button
                        onClick={() =>
                          updateParams({
                            page: Math.min(totalPages, currentPage + 1),
                          })
                        }
                        disabled={currentPage === totalPages}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="다음 페이지"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
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

const getTimerFromEndTime = (endTime: string) => {
  const end = new Date(endTime).getTime()
  if (Number.isNaN(end)) {
    return { hours: 0, minutes: 0, seconds: 0 }
  }

  const now = Date.now()
  const diff = Math.max(end - now, 0)

  const totalSeconds = Math.floor(diff / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return { hours, minutes, seconds }
}
