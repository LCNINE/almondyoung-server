"use client"

import { useState } from "react"
import skinProducts from "@lib/data/dummy/get-skin-list.json"
import { CategorySubList } from "@components/category-sub-list"
import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  TimeSaleProductCard,
} from "@components/products/product-card"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar"
const categoryBannerSliderData = [
  {
    id: "1",
    title: "[캄스테라피] 워터물광 트리트먼트",
    subtitle: "신제품 바로 구매하기",
    image:
      "https://murrymall.co.kr/web/product/small/202410/c8e5b6be9d6d2e546387c93ebb73c00c.jpg",
    mobileImage:
      "https://murrymall.co.kr/web/product/small/202410/c8e5b6be9d6d2e546387c93ebb73c00c.jpg",
    link: "/",
  },
  {
    id: "2",
    title: "[밀본] 그랜드 링케이지 모음전",
    subtitle: "모음전 제품보기",
    image:
      "https://murrymall.co.kr/web/product/small/202202/c73670b34fe90bec34040f52ddd7dc2e.jpg",
    mobileImage:
      "https://murrymall.co.kr/web/product/small/202202/c73670b34fe90bec34040f52ddd7dc2e.jpg",
    link: "/",
  },
  {
    id: "3",
    title: "블랙라벨 브랜드 모음전",
    subtitle: "모음전 제품보기",
    image:
      "https://www.makeup8989.co.kr/data/goods/46/4628/61333_1000.view.jpg",
    mobileImage:
      "https://www.makeup8989.co.kr/data/goods/46/4628/61333_1000.view.jpg",
    link: "/",
  },
  {
    id: "4",
    title: "뷰티앞치마 10% 특가전",
    subtitle: "특가전 제품보기",
    image:
      "https://i.pinimg.com/1200x/cb/4f/34/cb4f34ec61dc2c3c50f4ed31cc9ba8a6.jpg",
    mobileImage:
      "https://i.pinimg.com/1200x/cb/4f/34/cb4f34ec61dc2c3c50f4ed31cc9ba8a6.jpg",
    link: "/",
  },
]
export default function MakeupPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [searchParams, setSearchParams] = useState({})

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
  const paginatedProducts = skinProducts.data.slice(
    startIndex,
    startIndex + pageSize
  )

  return (
    <main>
      <div className="container mx-auto max-w-[1360px]">
        <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
          <aside className="hidden w-[233px] flex-shrink-0 md:block">
            <ProductFilterSidebar />
          </aside>
          <div>
            {/* 카테고리 헤더(타이틀/설명/배너) */}
            <div className="mb-8">
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="flex-1">
                  <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    {categoryData?.name}
                  </h1>

                  <p className="text-sm leading-relaxed text-gray-600 md:text-base">
                    {categoryData?.description}
                  </p>
                </div>
              </div>
              {/* 모바일 배너 */}
              {/* {category.heroImage && (
        <div className="md:hidden mt-4">
          <Image
            src={category.heroImage}
            alt={`${category.name} 배너`}
            width={800}
            height={300}
            className="w-full rounded-lg object-cover shadow-sm"
          />
        </div>
      )} */}
            </div>

            <CategorySubList />

            {/* 프로모션 배너 */}
            <section className="my-4">
              <BannerCarousel
                slides={[]}
                height="120px"
                autoPlay={true}
                autoPlayInterval={6000}
                className="lg:overflow-hidden lg:rounded-2xl"
              />
            </section>

            {/* 타임 세일 섹션 */}
            <section className="mb-8">
              <div className="max-w-[1002px] rounded-lg p-6">
                <h3 className="mb-4 text-lg font-bold text-gray-900 md:text-xl">
                  속눈썹 재료 타임 세일!
                </h3>
                <div className="relative">
                  <div className="scrollbar-hide flex gap-4 overflow-x-auto pb-4">
                    {paginatedProducts.slice(0, 8).map((product, index) => (
                      <div key={product.id} className="w-48 flex-shrink-0">
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
                  </div>

                  {/* 왼쪽 버튼 */}
                  <button
                    className="absolute top-1/2 left-0 -translate-x-2 -translate-y-1/2 transition-opacity hover:opacity-80"
                    aria-label="이전 상품"
                  >
                    <svg
                      width={43}
                      height={82}
                      viewBox="0 0 43 82"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-[82px] w-[43px]"
                      preserveAspectRatio="none"
                    >
                      <rect
                        x={43}
                        y={82}
                        width={43}
                        height={82}
                        transform="rotate(-180 43 82)"
                        fill="black"
                        fillOpacity="0.15"
                      />
                      <path
                        d="M27.25 30.5L16.75 41L27.25 51.5"
                        stroke="white"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>

                  {/* 오른쪽 버튼 */}
                  <button
                    className="absolute top-1/2 right-0 translate-x-2 -translate-y-1/2 transition-opacity hover:opacity-80"
                    aria-label="다음 상품"
                  >
                    <svg
                      width={43}
                      height={82}
                      viewBox="0 0 43 82"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-[82px] w-[43px]"
                      preserveAspectRatio="none"
                    >
                      <rect
                        x={0}
                        y={0}
                        width={43}
                        height={82}
                        fill="black"
                        fillOpacity="0.15"
                      />
                      <path
                        d="M15.75 30.5L26.25 41L15.75 51.5"
                        stroke="white"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </section>

            <section>
              <ProductSortToolbar />
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
