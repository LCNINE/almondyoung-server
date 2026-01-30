"use client"

import type { ProductCard } from "@lib/types/ui/product"
import { BasicProductCard, ProductCardSkeleton } from "@components/products/product-card"
import { useEffect, useState } from "react"
import { getProductList } from "@lib/api/medusa/products"
import { mapMedusaProductsToCards } from "@lib/utils/map-medusa-product-card"

export function RecommendedProductsSection() {
  const [products, setProducts] = useState<ProductCard[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchRecommendedProducts = async () => {
      try {
        // 인기 상품 또는 추천 상품 조회
        const productsResult = await getProductList({
          limit: 6,
          // TODO: 실제로는 추천 알고리즘이나 인기 상품 태그로 필터링
        })

        const mappedProducts = mapMedusaProductsToCards(productsResult.products)
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
        <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
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
      <div className="grid grid-cols-3 gap-4 lg:grid-cols-6">
        {products.map((product) => (
          <BasicProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  )
}
