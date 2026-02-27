"use client"

import { useState } from "react"
import { CategoryCircleTabs } from "@/components/category/category-circle-tabs"
import { BannerCarousel } from "@/components/layout/components/banner/banner-carousel"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import ProductSortToolbar from "@/components/products/product-sort-toolbar"
import { SectionSliderHorizontal } from "@components/section-sliders-horizontal"

// TODO: 서버에서 데이터를 받아서 props로 전달하도록 변경 필요
import CustomDropdown from "@components/dropdown"

export default function ClassPage() {
  // const [page, setPage] = useState(1)
  // const [pageSize, setPageSize] = useState(20)
  const [selectedField, setSelectedField] = useState("nail") // 분야 선택

  // 클래스 분야 데이터
  const classFields = [
    {
      id: "nail",
      name: "네일 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
    },
    {
      id: "hair",
      name: "헤어 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
    },
    {
      id: "permanent",
      name: "반영구 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
    },
    {
      id: "eyelash",
      name: "속눈썹 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
    },
    {
      id: "waxing",
      name: "왁싱 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
    },
    {
      id: "tattoo",
      name: "타투 클래스",
      imageUrl:
        "https://almondyoung.com/web/product/medium/202502/db90e9f1a6ccdf71d4aa82ed1d405981.png",
    },
  ]

  // 지역 데이터
  // const regions = [
  //   { id: "seoul", label: "서울" },
  //   { id: "gyeonggi", label: "경기" },
  //   { id: "incheon", label: "인천" },
  //   { id: "busan", label: "부산" },
  //   { id: "daegu", label: "대구" },
  //   { id: "gwangju", label: "광주" },
  //   { id: "daejeon", label: "대전" },
  //   { id: "ulsan", label: "울산" },
  //   { id: "sejong", label: "세종" },
  //   { id: "gangwon", label: "강원" },
  //   { id: "chungbuk", label: "충북" },
  //   { id: "chungnam", label: "충남" },
  //   { id: "jeonbuk", label: "전북" },
  //   { id: "jeonnam", label: "전남" },
  //   { id: "gyeongbuk", label: "경북" },
  //   { id: "gyeongnam", label: "경남" },
  //   { id: "jeju", label: "제주" },
  // ]

  // TODO: 서버에서 데이터를 받아서 props로 전달하도록 변경 필요
  // const startIndex = (page - 1) * pageSize
  const paginatedProducts: any[] = [] // TODO: props로 받은 데이터 사용

  return (
    <main className="">
      <div className="container mx-auto max-w-[1360px]">
        <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
          {/* 좌측 필터링 사이드바 (데스크톱만) */}
          {/* 데스크톱 필터 사이드바 */}
          <aside className="hidden w-[233px] shrink-0 md:block">
            <ProductFilterSidebar />
          </aside>

          <div className="min-w-0 flex-1">
            {/* 카테고리 헤더(타이틀/설명) */}
            <div className="mb-8">
              <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
                <div className="flex-1">
                  <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-3xl">
                    클래스
                  </h1>
                  <p className="text-sm leading-relaxed text-gray-600 md:text-base">
                    전문가가 되는 첫 걸음, 다양한 뷰티 클래스를 만나보세요
                  </p>
                </div>
              </div>
            </div>

            {/* 원형 탭 - 분야 선택 (데스크톱만) */}
            <div className="mb-6">
              <CategoryCircleTabs
                items={classFields}
                selectedId={selectedField}
                onSelect={setSelectedField}
              />
            </div>

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

            {/* 인기 강의 섹션 */}
            <SectionSliderHorizontal title="🔥 인기 강의" itemCount={8}>
              {paginatedProducts.slice(0, 8).map((product) => (
                <div
                  key={product.id}
                  className="w-[calc(40%-0.375rem)] shrink-0 snap-start sm:w-[45%] md:w-[calc(25%-12px)] lg:w-[calc(20%-12.8px)]"
                >
                  {/* <BasicProductCard
                    product={{
                      ...product,
                      basePrice: 150000,
                      membershipPrice: 120000,
                      isMembershipOnly: false,
                      status: "active",
                    }}
                  /> */}
                </div>
              ))}
            </SectionSliderHorizontal>

            <section>
              {/* 모바일: 필터 버튼 + 정렬 툴바 */}
              <div className="mb-4 flex justify-end gap-4 md:hidden">
                <div>
                  <CustomDropdown
                    items={[
                      { id: "newest", label: "최신순" },
                      { id: "price_asc", label: "낮은가격순" },
                      { id: "price_desc", label: "높은가격순" },
                    ]}
                  />
                </div>
                {/* <button
                  onClick={openMobileFilter}
                  className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap font-['Pretendard'] text-sm font-medium text-gray-700 transition-colors"
                  aria-label="필터 열기"
                >
                  필터
                  <SlidersHorizontal className="h-4 w-4" />
                </button> */}
              </div>

              {/* 데스크톱: 정렬 툴바만 */}
              <div className="hidden md:block">
                <ProductSortToolbar />
              </div>
            </section>

            {/* 전체 강의 섹션 */}
            <section>
              {/* 상품 그리드 */}
              {paginatedProducts.length > 0 && (
                <>
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                    {/* {paginatedProducts.map((product, idx) => (
                      <BasicProductCard
                        key={`${product.id}-${idx}`}
                        product={product}
                      />
                    ))} */}
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
