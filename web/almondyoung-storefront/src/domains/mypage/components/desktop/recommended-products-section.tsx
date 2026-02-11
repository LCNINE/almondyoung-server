"use client"

import type { ProductCardProps } from "@lib/types/ui/product"
import { ProductGrid } from "@/components/products/product-grid"
import { useEffect, useState } from "react"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"

function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex w-full animate-pulse flex-col gap-2"
        >
          <div className="aspect-square w-full rounded-2xl bg-gray-200" />
          <div className="flex flex-col gap-1.5">
            <div className="h-4 w-3/4 rounded bg-gray-200" />
            <div className="h-5 w-1/2 rounded bg-gray-200" />
            <div className="h-3 w-1/3 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RecommendedProductsSection() {
  const [products, setProducts] = useState<ProductCardProps[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRecommendedProducts = async () => {
      try {
        // 인기 상품 또는 추천 상품 조회
        const productsResult = await getProductList({
          limit: 6,
          // TODO: 실제로는 추천 알고리즘이나 인기 상품 태그로 필터링
        })

        const mappedProducts = mapStoreProductsToCardProps(productsResult.products)
        setProducts(mappedProducts)
      } catch (error) {
        console.error("추천 상품 조회 실패:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchRecommendedProducts()
  }, [])

  if (isLoading) {
    return (
      <section
        aria-labelledby="recommended-products-heading"
        className="rounded-[10px] bg-white p-6"
      >
        <h3
          id="recommended-products-heading"
          className="mb-4 text-[18px] font-bold"
        >
          원장님을 위한 추천제품
        </h3>
        <ProductGridSkeleton count={6} />
      </section>
    )
  }

  if (products.length === 0) {
    return null
  }

  return (
    <section
      aria-labelledby="recommended-products-heading"
      className="rounded-[10px] bg-white p-6"
    >
      <h3
        id="recommended-products-heading"
        className="mb-4 text-[18px] font-bold"
      >
        원장님을 위한 추천제품
      </h3>
      <ProductGrid
        products={products}
        className="grid-cols-3 lg:grid-cols-6"
        countryCode="kr"
      />
    </section>
  )
}
