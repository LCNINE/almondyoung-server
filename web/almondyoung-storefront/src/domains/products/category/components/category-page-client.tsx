"use client"

import { useState } from "react"
import hairListData from "@lib/data/dummy/get-hair-list.json"
import { CategoryCircleTabs } from "@components/category-circle-tabs"
import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  TimeSaleProductCard,
} from "@components/products/product-card"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar"
import { SectionSliderHorizontal } from "@components/section-sliders-horizontal"
import { SlidersHorizontal } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "./mobile-filter-sheet"
import CustomDropdown from "@components/dropdown"
import type { CategoryDetailResponse } from "@lib/api/pim/pim-types"

// 프론트 전용 타입(CategoryInfo)을 별도로 쓰기보다
// 가능하면 DTO나 간단한 인터페이스로 유지하는 것이 좋습니다.
export interface CategoryInfo {
  title: string
  description: string
}

interface CategoryPageClientProps {
  slug: string
  categoryInfo: CategoryInfo
  categoryData: CategoryDetailResponse // null 가능성 제거 (Container에서 처리함)
}

export function CategoryPageClient({
  slug,
  categoryInfo,
  categoryData,
}: CategoryPageClientProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 초기 선택 카테고리: 데이터가 있고 자식이 있다면 첫 번째 자식, 아니면 자기 자신 혹은 빈값
  const [selectedCategory, setSelectedCategory] = useState(
    categoryData.children && categoryData.children.length > 0
      ? categoryData.children[0].id
      : ""
  )

  // TODO: 실제 상품 리스트도 API 연동 필요 (현재는 더미 데이터 유지)
  const startIndex = (page - 1) * pageSize
  const paginatedProducts = hairListData.data.slice(
    startIndex,
    startIndex + pageSize
  )

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

                  <p className="text-sm leading-relaxed text-gray-600 md:text-base">
                    {categoryInfo.description}
                  </p>
                </div>
              </div>
            </div>

            {categoryData.children && categoryData.children.length > 0 && (
              <CategoryCircleTabs
                items={categoryData.children} // 서버 DTO 구조 그대로 전달
                selectedId={selectedCategory}
                onSelect={setSelectedCategory}
              />
            )}

            {/* 프로모션 배너 */}
            <section className="my-4">
              <BannerCarousel
                slides={[
                  {
                    id: "1",
                    image: {
                      src: "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
                      alt: "프로모션 배너",
                    },
                  },
                  {
                    id: "2",
                    image: {
                      src: "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
                      alt: "프로모션 배너",
                    },
                  },
                ]}
                height="120px"
                autoPlay={true}
                autoPlayInterval={6000}
                className="lg:overflow-hidden lg:rounded-2xl"
              />
            </section>

            {/* 타임 세일 섹션 */}
            <SectionSliderHorizontal
              title={`${categoryInfo.title} 재료 타임 세일!`}
              itemCount={8}
            >
              {paginatedProducts.slice(0, 8).map((product, index) => (
                <div key={product.id} className="w-48 shrink-0 snap-start">
                  <TimeSaleProductCard
                    product={{
                      ...product,
                      // 💡 서버에서 올 데이터 (고정값 시뮬레이션)
                      basePrice: 30000, // 정가
                      membershipPrice: 9000, // 할인가
                      isMembershipOnly: false,
                      isTimeSale: true,
                      status: "active",
                      timer: { hours: 16, minutes: 1, seconds: 10 },
                    }}
                    minWidth={192}
                  />
                </div>
              ))}
            </SectionSliderHorizontal>
            <section>
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
                <ProductSortToolbar />
              </div>
            </section>
            <section>
              {/* Product Grid */}
              {paginatedProducts.length && (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {paginatedProducts.map((product, idx) => (
                      <BasicProductCard
                        key={`${product.id}-${idx}`}
                        product={product}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
