"use server"

import { unstable_cache } from "next/cache"
import { getBestOrderMetricsByCategory } from "@/lib/api/analytics"
import { getProductList } from "@/lib/api/medusa/products"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { ProductCardProps } from "@/lib/types/ui/product"
import {
  mapStoreProductsToCardProps,
  type ReviewSummary,
} from "@/lib/utils/product-card"

const fetchCategoryBestProducts = async (
  categoryId: string
): Promise<ProductCardProps[]> => {
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
        // handle이 PIM의 masterId(UUID)이므로 이것을 사용
        productId: product.handle || product.id,
      })
    )
  )

  // 리뷰 데이터 변환
  const reviewsMap = new Map<string, ReviewSummary>()
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

  return mapStoreProductsToCardProps(bestProducts.products, reviewsMap)
}

export const getCategoryBestProducts = async (
  categoryId: string
): Promise<ProductCardProps[]> => {
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

const fetchCategoryProducts = async (
  categoryId: string,
  regionId?: string,
  limit = 12
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  const list = await getProductList({
    categoryId,
    region_id: regionId,
    limit,
  })

  if (!list?.products || list.products.length === 0) {
    const fallbackList = await getProductList({
      region_id: regionId,
      limit,
    })
    return mapStoreProductsToCardProps(fallbackList.products || [])
  }

  return mapStoreProductsToCardProps(list.products)
}

export const getCategoryProducts = async (
  categoryId: string,
  regionId?: string,
  limit = 12
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  return unstable_cache(
    () => fetchCategoryProducts(categoryId, regionId, limit),
    [`category-products-${categoryId}-${regionId || "default"}-${limit}`],
    {
      tags: ["category-products", `category-products-${categoryId}`],
      revalidate: 900, // 15분
    }
  )()
}
