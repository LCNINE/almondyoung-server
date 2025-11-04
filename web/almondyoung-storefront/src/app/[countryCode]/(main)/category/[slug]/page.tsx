"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { useCategories } from "@lib/providers/category-provider"
import { ProductCard } from "@lib/types/ui/product"
import { BasicProductCard } from "@components/products/product-card"
import LoadingState from "@components/common/components/loading-state"

// 더미 데이터 import
import hairListData from "@lib/data/dummy/get-hair-list.json"
import nailListData from "@lib/data/dummy/get-nail-list.json"
import skinListData from "@lib/data/dummy/get-skin-list.json"
import semiListData from "@lib/data/dummy/get-semi-permanent-list.json"
import waxingListData from "@lib/data/dummy/get-waxing-list.json"
import CategoryBannerSlide from "@components/category-banner-slides"
import ProductFilterSidebar from "../../../../../components/product-filter-sidebar"
import { CategorySubList } from "@components/category-sub-list"
import ProductSortToolbar from "@components/product-sort-toolbar"

// 카테고리별 더미 데이터 매핑
const CATEGORY_DATA_MAP: Record<string, any> = {
  hair: hairListData,
  nail: nailListData,
  skin: skinListData,
  semi: semiListData,
  waxing: waxingListData,
}

export default function CategoryPage() {
  const params = useParams()
  const slug = params?.slug as string
  const countryCode = params?.countryCode as string

  const { categories } = useCategories()
  const [products, setProducts] = useState<ProductCard[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalPages, setTotalPages] = useState(1)

  // 현재 카테고리 정보
  const currentCategory = categories.find((cat) => cat.slug === slug)

  // 더미 데이터 로드
  useEffect(() => {
    if (!slug) return

    try {
      setLoading(true)

      // 더미 JSON에서 데이터 가져오기
      const categoryData = CATEGORY_DATA_MAP[slug]

      if (categoryData?.data) {
        // 서버 데이터를 그대로 전달 (ProductCard가 내부에서 처리)
        setProducts(categoryData.data)
        setTotalPages(Math.ceil(categoryData.data.length / pageSize))
      } else {
        setProducts([])
        setTotalPages(1)
      }
    } catch (error) {
      console.error("데이터 로드 실패:", error)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }, [slug, pageSize])

  // 페이지네이션된 상품 목록
  const paginatedProducts = products.slice(
    (page - 1) * pageSize,
    page * pageSize
  )

  // 로딩 상태
  if (loading) {
    return <LoadingState message="상품 목록을 불러오는 중..." />
  }

  // 카테고리를 찾을 수 없는 경우
  if (!currentCategory) {
    return (
      <div className="container mx-auto max-w-[1360px] px-[40px] py-16">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">
          카테고리를 찾을 수 없습니다
        </h1>
        <p className="mb-8 text-gray-600">요청한 카테고리: {slug}</p>
        <Link
          href={`/${countryCode}`}
          className="text-blue-600 underline hover:text-blue-800"
        >
          홈으로 돌아가기
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Main Content */}

      <div className="mx-auto max-w-[1360px] px-[15px] py-2 md:px-[40px] md:py-8">
        <div className="flex gap-6">
          {/* Sidebar - Desktop */}

          <ProductFilterSidebar />

          {/* Product Grid */}
          <main className="flex-1">
            <CategorySubList />
            {/* Sort Bar */}
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
          </main>
        </div>
      </div>
    </div>
  )
}
