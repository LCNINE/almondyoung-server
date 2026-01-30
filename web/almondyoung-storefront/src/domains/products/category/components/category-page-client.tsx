"use client"

import { CategoryCircleTabs } from "@/components/category/category-circle-tabs"
import { BannerCarousel } from "@/components/layout/components/banner/banner-carousel"
import { ProductGrid } from "@/components/products/product-grid"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import { SharedPagination } from "@/components/shared/pagination"
import { SlidersHorizontal, ChevronDown } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "./mobile-filter-sheet"
import CustomDropdown from "@components/dropdown"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"
import type { ProductCardProps } from "@lib/types/ui/product"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useState, useTransition } from "react"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { cn } from "@lib/utils"
import { useUser } from "@/contexts/user-context"

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
  sales: "-metadata.salesCount", // 판매량순
  newest: "-created_at", // 최신순
} as const

const SORT_LABELS = [
  { id: "ranking", label: "아몬드영 랭킹 순" },
  { id: "price-asc", label: "낮은가격순" },
  { id: "price-desc", label: "높은가격순" },
  { id: "sales", label: "판매량순" },
  { id: "newest", label: "최신순" },
]

const ITEMS_PER_PAGE_OPTIONS = [
  { value: "20", label: "20개씩 보기" },
  { value: "40", label: "40개씩 보기" },
  { value: "60", label: "60개씩 보기" },
]

const DEFAULT_ITEMS_PER_PAGE = 20

interface CategoryPageClientProps {
  slug: string
  categoryInfo: CategoryInfo
  categoryData: StoreProductCategoryTree // null 가능성 제거 (Container에서 처리함)
  initialProducts?: ProductCardProps[] // 서버에서 로드한 초기 상품 목록
  initialTotal?: number // 전체 상품 수
  countryCode: string
  categoryIds?: string[] // 카테고리 ID 목록
  regionId?: string // 지역 ID
  allCategories?: StoreProductCategoryTree[] // 전체 카테고리 트리
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
  allCategories = [],
}: CategoryPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const { user } = useUser()
  const isLoggedIn = !!user

  // URL에서 페이지, 정렬, 개수 파라미터 읽기
  const currentPage = Number(searchParams.get("page")) || 1
  const currentSort = searchParams.get("sort") || "ranking"
  const currentLimit = Number(searchParams.get("limit")) || DEFAULT_ITEMS_PER_PAGE

  // 상품 목록 상태
  const [products, setProducts] = useState<ProductCardProps[]>(initialProducts)
  const [total, setTotal] = useState(initialTotal)
  const totalPages = Math.ceil(total / currentLimit)

  // URL 파라미터 업데이트 함수
  const updateParams = useCallback(
    (params: { page?: number; sort?: string; limit?: number }) => {
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

      if (params.limit !== undefined) {
        if (params.limit === DEFAULT_ITEMS_PER_PAGE) {
          newParams.delete("limit")
        } else {
          newParams.set("limit", String(params.limit))
        }
        // 개수 변경 시 페이지 1로 초기화
        newParams.delete("page")
      }

      const queryString = newParams.toString()
      router.push(queryString ? `?${queryString}` : window.location.pathname, {
        scroll: false,
      })
    },
    [router, searchParams]
  )

  // 페이지/정렬/개수 변경 시 데이터 로드
  useEffect(() => {
    // 초기 로드 시에는 서버에서 받은 데이터 사용 (기본 설정일 때만)
    if (currentPage === 1 && currentSort === "ranking" && currentLimit === DEFAULT_ITEMS_PER_PAGE) {
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
          limit: currentLimit,
          categoryId: categoryIds,
          region_id: regionId,
          order: sortOrder,
        })
        setProducts(mapStoreProductsToCardProps(result.products))
        setTotal(result.count)
      } catch (error) {
        console.error("상품 목록 로드 실패:", error)
      }
    })
  }, [
    currentPage,
    currentSort,
    currentLimit,
    categoryIds,
    regionId,
    initialProducts,
    initialTotal,
  ])

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
                    onSelect={(id) => updateParams({ sort: id })}
                  />
                  <button
                    onClick={openMobileFilter}
                    className="flex h-10 items-center gap-2 font-['Pretendard'] text-sm font-medium text-gray-700 transition-colors"
                    aria-label="필터 열기"
                  >
                    필터
                    <SlidersHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 데스크톱: 정렬 툴바 + n개씩 보기 */}
              <div className="mb-5 hidden items-center justify-between bg-gray-100 px-3.5 py-2.5 md:flex">
                {/* 정렬 옵션 */}
                <div className="flex items-center divide-x divide-gray-300">
                  {SORT_LABELS.map((option, index) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateParams({ sort: option.id })}
                      className={cn(
                        "font-['Pretendard'] text-base",
                        index > 0 ? "pl-4" : "",
                        index < SORT_LABELS.length - 1 ? "pr-4" : "",
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

                {/* n개씩 보기 드롭다운 */}
                <div className="relative">
                  <select
                    value={currentLimit}
                    onChange={(e) => updateParams({ limit: Number(e.target.value) })}
                    className="appearance-none bg-transparent pr-6 font-['Pretendard'] text-base font-normal text-gray-700 focus:outline-none"
                  >
                    {ITEMS_PER_PAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-500" />
                </div>
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
                  <ProductGrid
                    products={products}
                    showQuickActions
                    className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4"
                    countryCode={countryCode}
                    isLoggedIn={isLoggedIn}
                  />

                  {/* 페이지네이션 */}
                  <SharedPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={(page) => updateParams({ page })}
                    className="mt-8"
                  />
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
