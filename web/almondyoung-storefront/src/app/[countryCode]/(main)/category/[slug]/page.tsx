"use client"

import { useState } from "react"
import skinProducts from "@lib/data/dummy/get-skin-list.json"
import { CategoryCircleTabs } from "@components/category-circle-tabs"
import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  TimeSaleProductCard,
} from "@components/products/product-card"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar"
import { SectionSliderHorizontal } from "@components/section-sliders-horizontal"
import hairListData from "@lib/data/dummy/get-hair-list.json"
import { SlidersHorizontal } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "../class/components"
import CustomDropdown from "@components/dropdown"
export const CATEGORY_DATA = {
  hair: {
    title: "헤어",
    description: "뷰티샵을 위한 전문 헤어 제품",
  },
  semi: {
    title: "반영구",
    description: "안전하고 검증된 반영구 화장 제품",
  },
  nail: {
    title: "네일",
    description: "프로페셔널 네일 케어 제품",
  },
  lash: {
    title: "속눈썹",
    description: "속눈썹 연장 및 케어 전문 제품",
  },
  waxing: {
    title: "왁싱",
    description: "피부에 안전한 왁싱 제품",
  },
  skin: {
    title: "피부미용",
    description: "전문가용 스킨케어 제품",
  },
  tattoo: {
    title: "타투",
    description: "타투 아티스트를 위한 전문 용품",
  },
  makeup: {
    title: "메이크업",
    description: "뷰티샵을 위한 전문 메이크업 제품",
  },
} as const

type CategorySlug = keyof typeof CATEGORY_DATA

interface CategoryPageProps {
  params: Promise<{
    countryCode: string
    slug: string
  }>
}

export default async function CategoryPage({ params }: CategoryPageProps) {
  const { slug } = await params
  const categoryInfo = CATEGORY_DATA[slug as CategorySlug] || {
    title: "카테고리",
    description: "전문 뷰티 제품",
  }

  return <CategoryPageClient slug={slug} categoryInfo={categoryInfo} />
}

function CategoryPageClient({
  slug,
  categoryInfo,
}: {
  slug: string
  categoryInfo: { title: string; description: string }
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchParams, setSearchParams] = useState({})
  const [selectedCategory, setSelectedCategory] = useState("makeup-base")

  // 더미 카테고리 데이터
  const categoryData = {
    id: "makeup",
    name: "메이크업",
    slug: "makeup",
    description: "뷰티샵을 위한 전문 메이크업 제품을 만나보세요",
    imageUrl:
      "https://i.pinimg.com/736x/7e/22/6b/7e226b3fb7b79951eceaa10bd91fbe71.jpg",
    children: [
      {
        id: "makeup-base",
        name: "베이스메이크업",
        slug: "base",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
      },
      {
        id: "makeup-lip",
        name: "립메이크업",
        slug: "lip",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
      },
      {
        id: "makeup-eye",
        name: "아이메이크업",
        slug: "eye",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
      },
      {
        id: "makeup-cheek",
        name: "치크",
        slug: "cheek",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
      },
      {
        id: "makeup-brush",
        name: "메이크업 브러쉬",
        slug: "brush",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
      },
      {
        id: "makeup-tool",
        name: "메이크업 도구",
        slug: "tool",
        imageUrl:
          "https://almondyoung.com/web/product/medium/202502/db90e9f1a6ccdf71d4aa82ed1d405981.png",
      },
    ],
  }

  // 페이지네이션된 상품
  const startIndex = (page - 1) * pageSize
  const paginatedProducts = hairListData.data.slice(
    startIndex,
    startIndex + pageSize
  )
  // 모바일 필터 열기
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

            <CategoryCircleTabs
              items={categoryData.children.map((child) => ({
                id: child.id,
                name: child.name,
                imageUrl: child.imageUrl,
              }))}
              selectedId={selectedCategory}
              onSelect={setSelectedCategory}
            />

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
