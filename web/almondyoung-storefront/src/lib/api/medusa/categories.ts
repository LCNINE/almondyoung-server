"use server"

import { sdk } from "@/lib/config/medusa"
import type { StoreProductCategoryTree } from "@/lib/types/medusa-category"

const findCategoryByHandle = (
  categories: StoreProductCategoryTree[],
  handle: string
): StoreProductCategoryTree | null => {
  for (const category of categories) {
    if (category.handle === handle) {
      return category
    }

    if (category.category_children?.length) {
      const found = findCategoryByHandle(category.category_children, handle)
      if (found) {
        return found
      }
    }
  }

  return null
}

const findCategoryById = (
  categories: StoreProductCategoryTree[],
  id: string
): StoreProductCategoryTree | null => {
  for (const category of categories) {
    if (category.id === id) {
      return category
    }

    if (category.category_children?.length) {
      const found = findCategoryById(category.category_children, id)
      if (found) {
        return found
      }
    }
  }

  return null
}

export const getCategoryTree = async (): Promise<StoreProductCategoryTree[]> => {
  const { product_categories } = await sdk.store.category.list(
    {
      parent_category_id: null,
      include_descendants_tree: true,
      fields:
        "id,name,handle,description,metadata,category_children.id,category_children.name,category_children.handle,category_children.description,category_children.metadata,category_children.parent_category_id,category_children.category_children",
    },
    {
      next: {
        tags: ["product-categories"],
      },
    }
  )

  return product_categories as StoreProductCategoryTree[]
}

export const getCategoryByHandle = async (
  handle: string
): Promise<StoreProductCategoryTree | null> => {
  const categories = await getCategoryTree()
  // handle로 먼저 찾고, 없으면 id로 찾기 (PIM 카테고리 id 지원)
  return findCategoryByHandle(categories, handle) || findCategoryById(categories, handle)
}

export const getCategoryById = async (
  id: string
): Promise<StoreProductCategoryTree | null> => {
  const categories = await getCategoryTree()
  return findCategoryById(categories, id)
}
