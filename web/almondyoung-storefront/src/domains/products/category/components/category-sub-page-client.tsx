"use client"

import { useState } from "react"
import Link from "next/link"
import { BasicProductCard } from "@components/products/product-card"
import ProductFilterSidebar from "@components/product-filter-sidebar"
import ProductSortToolbar from "@components/product-sort-toolbar"
import CustomDropdown from "@components/dropdown"
import { SlidersHorizontal } from "lucide-react"
import { overlay } from "overlay-kit"
import { MobileFilterSheet } from "./mobile-filter-sheet"
import type { CategoryTreeNode } from "@lib/api/pim/pim-types"
import type { ProductCard } from "@lib/types/ui/product"

export interface CategoryInfo {
  title: string
  description: string
}

interface CategorySubPageClientProps {
  slug: string
  subSlug: string
  categoryInfo: CategoryInfo
  categoryData: CategoryTreeNode
  initialProducts?: ProductCard[]
  initialTotal?: number
  countryCode: string
  parentSlug: string
}

export function CategorySubPageClient({
  slug,
  subSlug,
  categoryInfo,
  categoryData,
  initialProducts = [],
  initialTotal = 0,
  countryCode,
  parentSlug,
}: CategorySubPageClientProps) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const paginatedProducts = initialProducts

  const openMobileFilter = () => {
    overlay.open(({ isOpen, close, unmount }) => (
      <MobileFilterSheet isOpen={isOpen} close={close} exit={unmount} />
    ))
  }

  // 하위 카테고리가 있는지 확인
  const hasChildren = categoryData.children && categoryData.children.length > 0

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
                  <p className="text-sm leading-relaxed text-gray-600 md:text-base">
                    {categoryInfo.description}
                  </p>
                </div>
              </div>
            </div>

            {/* 하위 카테고리 탭 */}
            {hasChildren && (
              <section className="mb-8">
                <nav aria-label="하위 카테고리" className="w-full">
                  <ul className="scrollbar-hide flex flex-nowrap items-center gap-[5px] overflow-x-auto md:flex-wrap md:gap-1.5 md:overflow-x-visible">
                    {categoryData.children!.map((child) => {
                      const isActive = child.slug === subSlug
                      // 재귀적으로 하위 카테고리를 표시하기 위해 현재 카테고리의 slug를 parentSlug로 사용
                      const href = `/${countryCode}/category/${categoryData.slug}/${child.slug}`
                      
                      return (
                        <li key={child.id} className="flex-shrink-0">
                          <Link
                            href={href}
                            className={`
                              flex items-center justify-center gap-2.5 rounded-full 
                              px-2.5 py-1 text-sm 
                              md:px-3.5 md:py-2 md:text-base 
                              outline outline-[0.50px] outline-offset-[-0.50px] 
                              border-gray-200
                              font-['Pretendard'] transition-colors
                              whitespace-nowrap
                              ${
                                isActive
                                  ? "bg-black outline-black text-zinc-100 font-normal md:bg-zinc-800 md:outline-zinc-800 md:font-bold"
                                  : "outline-Grays-Gray-3 text-Grays-Gray font-normal hover:bg-gray-100"
                              }
                            `}
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
              {paginatedProducts.length > 0 && (
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

