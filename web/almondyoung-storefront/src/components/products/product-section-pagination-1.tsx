"use client"

import { BasicProductCard } from "@components/products/product-card"
import { addToCart } from "@lib/data/cart"
import type { ProductCard } from "@lib/types/ui/product"
import { useState, useEffect } from "react"
import { ProductQuery, useProductList } from "@hooks/api/use-product-list"
import Pagination from "@components/common/pagination"
import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"

type Props = {
  sectionTitle?: string
  sectionDescription?: string
  query: ProductQuery
  pageable: boolean
  showMoreLink?: string
}

export default function ProductCatalogPagination1({
  sectionTitle,
  sectionDescription,
  query,
  pageable,
  showMoreLink = "/",
}: Props) {
  const [currentPage, setCurrentPage] = useState(1)
  const [responsiveItemsPerPage, setResponsiveItemsPerPage] = useState(5)
  const { items, total, loading, error, params, update } = useProductList(
    query,
    /*syncUrl*/ false
  )

  // 화면 크기에 따른 반응형 itemsPerPage 설정
  useEffect(() => {
    const updateItemsPerPage = () => {
      if (window.innerWidth >= 1024) {
        // lg 이상: 5열 그리드
        setResponsiveItemsPerPage(5)
      } else if (window.innerWidth >= 768) {
        // md: 3열 그리드
        setResponsiveItemsPerPage(6)
      } else {
        // 모바일: 가로스크롤 (모든 상품 표시)
        setResponsiveItemsPerPage(query.limit ?? 12)
      }
    }

    updateItemsPerPage()
    window.addEventListener("resize", updateItemsPerPage)

    return () => window.removeEventListener("resize", updateItemsPerPage)
  }, [query.limit ?? 12])

  const handleAddToCart = async (product: ProductCard) => {
    try {
      // TODO: 실제 variant ID를 사용해야 함. 현재는 mock 데이터이므로 임시로 product.id 사용
      await addToCart({
        variantId: product.id, // 실제로는 product.variantId를 사용해야 함
        quantity: 1,
        countryCode: "kr", // 또는 동적으로 가져와야 함
      })
    } catch (error) {
      console.error("Failed to add to cart:", error)
    }
  }

  // 페이지네이션 계산
  const totalPages = Math.max(
    0,
    Math.ceil((total ?? 0) / Math.max(1, responsiveItemsPerPage))
  )
  const startIndex = (currentPage - 1) * responsiveItemsPerPage
  const endIndex = startIndex + responsiveItemsPerPage
  const currentProducts = items.slice(startIndex, endIndex)

  // 상품이 없는 경우 처리
  if (!items || items.length === 0) {
    return (
      <div>
        <div className="flex items-center justify-between pb-4">
          <div>
            <span className="mb-8 text-[18px] font-bold md:text-[24px]">
              {sectionTitle}
            </span>
            {sectionDescription && (
              <p className="mt-1 text-sm text-gray-600 lg:text-base">
                {sectionDescription}
              </p>
            )}
          </div>
        </div>
        <div className="py-8 text-center text-gray-500">
          <p>상품이 없습니다.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between pb-6">
        <div>
          <span className="mb-8 text-[18px] font-bold md:text-[24px]">
            {sectionTitle}
          </span>
          {sectionDescription && (
            <p className="mt-1 text-sm text-gray-600 lg:text-base">
              {sectionDescription}
            </p>
          )}
        </div>
        <div>
          <Link
            href={showMoreLink}
            className="text-base hover:font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            더보기
          </Link>
        </div>
      </div>

      {/* Mobile: 가로스크롤 한줄 */}
      <div className="block md:hidden">
        <div className="relative">
          <div className="scrollbar-hide scroll-container flex gap-2 overflow-x-auto pb-2">
            {items.map((product) => {
              return <BasicProductCard key={product.id} product={product} />
            })}
          </div>
          {/* 좌측 스크롤 버튼 */}
          <button
            className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full bg-white p-2 shadow-lg"
            onClick={() => {
              const container = document.querySelector(".scroll-container")
              if (container)
                container.scrollBy({ left: -200, behavior: "smooth" })
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* 우측 스크롤 버튼 */}
          <button
            className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full bg-white p-2 shadow-lg"
            onClick={() => {
              const container = document.querySelector(".scroll-container")
              if (container)
                container.scrollBy({ left: 200, behavior: "smooth" })
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Desktop: 페이지네이션 */}
      <div className="hidden md:block">
        {/* 상품 그리드 */}
        <div className="grid grid-cols-3 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {currentProducts.map((product) => {
            return <BasicProductCard key={product.id} product={product} />
          })}
        </div>

        {/* 페이지네이션 버튼 */}
        {totalPages > 1 && pageable && (
          <Pagination
            showPageNumbers={true}
            totalPages={totalPages}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  )
}
