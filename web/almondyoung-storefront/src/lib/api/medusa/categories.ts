"use server"

import { sdk } from "@/lib/config/medusa"
import { HttpTypes } from "@medusajs/types"
// eslint-disable-next-line no-restricted-imports
import { getCacheOptions } from "@/lib/data/cookies"

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
  const next = {
    ...(await getCacheOptions("categories")),
  }

  const limit = query?.limit || 100

  return sdk.client
    .fetch<{ product_categories: HttpTypes.StoreProductCategory[] }>(
      "/store/product-categories",
      {
        query: {
          fields:
            // "*category_children, *products, *parent_category, *parent_category.parent_category",
            "*category_children, *parent_category, *parent_category.parent_category",
          limit,
          ...query,
        },
        next,
        cache: "force-cache",
      }
    )
    .then(({ product_categories }) => sortCategoriesByRank(product_categories))
}

export const getCategoryByHandle = async (categoryHandle: string[]) => {
  // segments의 마지막이 실제 카테고리 handle (예: ["clothing", "shirts"] → "shirts")
  const handle = categoryHandle[categoryHandle.length - 1]

  const next = {
    ...(await getCacheOptions("categories")),
  }

  return sdk.client
    .fetch<HttpTypes.StoreProductCategoryListResponse>(
      `/store/product-categories`,
      {
        query: {
          // fields: "*category_children, *products",
          fields: "*category_children",
          handle,
        },
        next,
        cache: "force-cache",
      }
    )
    .then(({ product_categories }) => product_categories[0])
}
