"use server"

import { unstable_cache } from "next/cache"
import { getBestOrderMetricsByCategory } from "@/lib/api/analytics"
import { getProductList } from "@/lib/api/medusa/products"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { ProductCardProps } from "@/lib/types/ui/product"

const fetchCategoryBestProducts = async (categoryId: string): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  const bestOrderMetrics = await getBestOrderMetricsByCategory(categoryId)
  const masterIds = bestOrderMetrics.map((metric) => metric.masterId)

  if (masterIds.length === 0) {
    return []
  }

  const bestProducts = await getProductList({
    handle: masterIds,
  })

  if (!bestProducts?.products || bestProducts.products.length === 0) {
    return []
  }

  const reviews = await Promise.all(
    bestProducts.products.map((product) =>
      getReviewsByProductId({
        productId: product.id,
      })
    )
  )

  // 리뷰 데이터 변환
  const reviewsMap = new Map<string, { rating: number; reviewCount: number }>()
  reviews.forEach((review) => {
    if (review.data.length > 0) {
      const productId = review.data[0].productId
      const ratings = review.data.map((r) => r.rating || 0).filter((r) => r > 0)
      const averageRating =
        ratings.length > 0
          ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
          : 0

      reviewsMap.set(productId, {
        rating: Math.round(averageRating * 10) / 10,
        reviewCount: review.data.length,
      })
    }
  })

  const transformedProducts: ProductCardProps[] = bestProducts.products
    .map((product) => {
      if (!product.variants || product.variants.length === 0) {
        return null
      }

      const variant = product.variants[0] as any

      const basePrice = (variant.prices?.[0]?.amount as number) || 0
      const membershipPrice =
        (variant.metadata as { membershipPrice?: number })?.membershipPrice ||
        null

      const discount =
        membershipPrice && basePrice > membershipPrice && basePrice > 0
          ? Math.round(((basePrice - membershipPrice) / basePrice) * 100)
          : 0

      const displayPrice = membershipPrice || basePrice
      const imageUrl = product.thumbnail || ""

      const reviewData = reviewsMap.get(product.id)
      const rating = reviewData?.rating || 0
      const reviewCount = reviewData?.reviewCount || 0

      return {
        id: product.id,
        title: product.title || "",
        price: displayPrice,
        originalPrice: basePrice,
        discount,
        rating,
        reviewCount,
        imageSrc: imageUrl,
      }
    })
    .filter((props): props is ProductCardProps => props !== null)

    return transformedProducts
  }

export const getCategoryBestProducts = async (categoryId: string): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  return unstable_cache(
    () => fetchCategoryBestProducts(categoryId),
    [`category-best-products-${categoryId}`],
    {
      tags: [`category-best-${categoryId}`, "category-best"],
      revalidate: 3600, // 1시간
    }
  )()
}

