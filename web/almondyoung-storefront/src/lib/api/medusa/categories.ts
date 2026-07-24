"use server"

import { sdk } from "@/lib/config/medusa"
import { HttpTypes } from "@medusajs/types"

const sortCategoriesByRank = (
  categories: HttpTypes.StoreProductCategory[]
): HttpTypes.StoreProductCategory[] => {
  return categories
    .map((category) => ({
      ...category,
      category_children: category.category_children
        ? sortCategoriesByRank(category.category_children)
        : [],
    }))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

export const listCategories = async (query?: Record<string, any>) => {
  const limit = query?.limit || 100

  return sdk.client
    .fetch<{ product_categories: HttpTypes.StoreProductCategory[] }>(
      "/store/product-categories",
      {
        query: {
          fields:
            "*category_children, *parent_category, *parent_category.parent_category",
          // 메가메뉴 3단(대분류→중분류→소분류)용으로 전체 하위 트리 로드.
          // (중첩 fields `*category_children.category_children` 는 손자를 안 채움 — 이 옵션이 필요)
          include_descendants_tree: true,
          limit,
          ...query,
        },
        cache: "no-store",
      }
    )
    .then(({ product_categories }) => sortCategoriesByRank(product_categories))
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  // segments의 마지막이 실제 카테고리 handle (예: ["clothing", "shirts"] → "shirts")
  const handle = categoryHandle[categoryHandle.length - 1]

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          // fields: "*category_children, *products",
          fields: "*category_children",
          include_descendants_tree: true,
          handle,
        },
        cache: "no-store",
      }
    )
    .then(({ product_categories }) => product_categories[0])
}
