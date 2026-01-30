"use server"

import { unstable_cache } from "next/cache"
import { getProductList } from "@/lib/api/medusa/products"
import { getCategoryTree } from "@/lib/api/medusa/categories"
import { getReviewsByProductId } from "@/lib/api/ugc"
import { ProductCardProps } from "@/lib/types/ui/product"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"
import { isTimeSaleProduct } from "@/lib/utils/time-sale"
import {
  mapStoreProductsToCardProps,
  type ReviewSummary,
} from "@/lib/utils/product-card"

/**
 * 카테고리와 모든 하위 카테고리의 ID를 수집합니다.
 */
const collectCategoryIds = (category: StoreProductCategoryTree): string[] => {
  const ids: string[] = [category.id]
  if (category.category_children) {
    for (const child of category.category_children) {
      ids.push(...collectCategoryIds(child))
    }
  }
  return ids
}

/**
 * 카테고리 트리에서 특정 ID의 카테고리를 찾습니다.
 */
const findCategoryById = (
  categories: StoreProductCategoryTree[],
  targetId: string
): StoreProductCategoryTree | null => {
  for (const category of categories) {
    if (category.id === targetId) {
      return category
    }
    if (category.category_children) {
      const found = findCategoryById(category.category_children, targetId)
      if (found) return found
    }
  }
  return null
}

const fetchCategoryBestProducts = async (
  categoryId: string,
  regionId?: string
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  // 카테고리 트리를 가져와서 해당 카테고리와 모든 하위 카테고리 ID 수집
  const categoryTree = await getCategoryTree()
  const category = findCategoryById(categoryTree, categoryId)
  const categoryIds = category ? collectCategoryIds(category) : [categoryId]

  const bestProducts = await getProductList({
    categoryId: categoryIds,
    limit: 20,
    region_id: regionId,
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
        // total을 사용하여 실제 총 리뷰 수 표시
        reviewCount: review.total || review.data.length,
      })
    }
  })

  return mapStoreProductsToCardProps(bestProducts.products, reviewsMap)
}

export const getCategoryBestProducts = async (
  categoryId: string,
  regionId?: string
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  return unstable_cache(
    () => fetchCategoryBestProducts(categoryId, regionId).catch(() => []),
    [`category-best-products-${categoryId}-${regionId || "default"}`],
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

const fetchTimeSaleProducts = async (
  categoryId: string,
  regionId?: string,
  limit = 12
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  // 카테고리 트리를 가져와서 해당 카테고리와 모든 하위 카테고리 ID 수집
  const categoryTree = await getCategoryTree()
  const category = findCategoryById(categoryTree, categoryId)
  const categoryIds = category ? collectCategoryIds(category) : [categoryId]

  const list = await getProductList({
    categoryId: categoryIds,
    region_id: regionId,
    limit: Math.max(limit, 24),
  })

  const timeSaleProducts = (list.products || []).filter(isTimeSaleProduct)

  if (timeSaleProducts.length === 0) {
    return []
  }

  return mapStoreProductsToCardProps(timeSaleProducts).slice(0, limit)
}

export const getTimeSaleProducts = async (
  categoryId: string,
  regionId?: string,
  limit = 12
): Promise<ProductCardProps[]> => {
  if (!categoryId) {
    return []
  }

  return unstable_cache(
    () => fetchTimeSaleProducts(categoryId, regionId, limit),
    [`time-sale-products-${categoryId}-${regionId || "default"}-${limit}`],
    {
      tags: ["time-sale-products", `time-sale-products-${categoryId}`],
      revalidate: 300,
    }
  )()
}
