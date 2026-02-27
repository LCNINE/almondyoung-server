"use client"

import Link from "next/link"
import { ProductGrid } from "@/components/products/product-grid"
import ProductFilterSidebar from "@/components/products/product-filter-sidebar"
import ProductSortToolbar from "@/components/products/product-sort-toolbar"
import CustomDropdown from "@components/dropdown"
import type { StoreProductCategoryTree } from "@lib/types/medusa-category"
import type { ProductCardProps } from "@lib/types/ui/product"

export interface CategoryInfo {
  title: string
  description?: string
}

interface CategorySubPageClientProps {
  subSlug: string
  categoryInfo: CategoryInfo
  categoryData: StoreProductCategoryTree
  initialProducts?: ProductCardProps[]
  initialTotal?: number
  countryCode: string
}

export function CategorySubPageClient({
  subSlug,
  categoryInfo,
  categoryData,
  initialProducts = [],
  // initialTotal = 0,
  countryCode,
}: CategorySubPageClientProps) {
  const paginatedProducts = initialProducts

  // 하위 카테고리가 있는지 확인
  const hasChildren =
    categoryData.category_children && categoryData.category_children.length > 0

  return (
    <main className="">
      <div className="container mx-auto max-w-[1360px]">
        <div className="flex px-4 py-6 md:gap-[40px] md:px-[40px]">
          <aside className="hidden w-[233px] shrink-0 md:block">
            <ProductFilterSidebar />
          </aside>
          <div className="min-w-0 flex-1">
            {/* 카테고리 헤더 */}
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

            {/* 하위 카테고리 탭 */}
            {hasChildren && (
              <section className="mb-8">
                <nav aria-label="하위 카테고리" className="w-full">
                  <ul className="scrollbar-hide flex flex-nowrap items-center gap-[5px] overflow-x-auto md:flex-wrap md:gap-1.5 md:overflow-x-visible">
                    {categoryData.category_children!.map((child) => {
                      const isActive = child.handle === subSlug
                      // 재귀적으로 하위 카테고리를 표시하기 위해 현재 카테고리의 handle 사용
                      const parentHandle = categoryData.handle ?? subSlug
                      const childHandle = child.handle ?? ""
                      const href = `/${countryCode}/category/${parentHandle}/${childHandle}`

                      return (
                        <li key={child.id} className="flex-shrink-0">
                          <Link
                            href={href}
                            className={`flex items-center justify-center gap-2.5 rounded-full border-gray-200 px-2.5 py-1 font-['Pretendard'] text-sm whitespace-nowrap outline outline-[0.50px] outline-offset-[-0.50px] transition-colors md:px-3.5 md:py-2 md:text-base ${isActive
                                ? "bg-black font-normal text-zinc-100 outline-black md:bg-zinc-800 md:font-bold md:outline-zinc-800"
                                : "outline-Grays-Gray-3 text-Grays-Gray font-normal hover:bg-gray-100"
                              } `}
                            aria-pressed={isActive}
                          >
                            {child.name}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </nav>
              </section>
            )}

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

            <section>
              {/* Product Grid */}
              {paginatedProducts.length > 0 && (
                <ProductGrid
                  products={paginatedProducts}
                  className="grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                  countryCode={countryCode}
                />
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
