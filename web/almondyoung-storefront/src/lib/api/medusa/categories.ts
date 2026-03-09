"use server"

import { cache } from "react"
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

const getCategoryTreeInternal = async (): Promise<
  StoreProductCategoryTree[]
> => {
  const limit = 100
  let offset = 0
  const all: StoreProductCategoryTree[] = []

  while (true) {
    const { product_categories, count } = await sdk.client.fetch<{
      product_categories: StoreProductCategoryTree[]
      count: number
    }>(`/store/product-categories`, {
      method: "GET",
      query: {
        limit,
        offset,
        fields: "id,name,handle,description,metadata,parent_category_id,rank",
      },
      next: {
        tags: ["product-categories"],
      },
      cache: "force-cache",
    })

    const page = (product_categories || []) as StoreProductCategoryTree[]
    all.push(...page)

    offset += page.length

    if (page.length === 0 || page.length < limit || offset >= (count ?? 0)) {
      break
    }
  }

  return buildCategoryTree(all)
}

export const getCategoryTree = cache(getCategoryTreeInternal)

const buildCategoryTree = (
  categories: StoreProductCategoryTree[]
): StoreProductCategoryTree[] => {
  const map = new Map<string, StoreProductCategoryTree>()

  for (const category of categories) {
    map.set(category.id, {
      ...category,
      category_children: [],
    })
  }

  const roots: StoreProductCategoryTree[] = []

  for (const category of Array.from(map.values())) {
    const parentId = category.parent_category_id || null

    if (!parentId) {
      roots.push(category)
      continue
    }

    const parent = map.get(parentId)
    if (!parent) {
      roots.push(category)
      continue
    }

    parent.category_children = [
      ...(parent.category_children || []),
      category,
    ].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  }

  return roots.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
}

export const getCategoryByHandle = async (
  handle: string
): Promise<StoreProductCategoryTree | null> => {
  const categories = await getCategoryTree()
  // handle로 먼저 찾고, 없으면 id로 찾기 (PIM 카테고리 id 지원)
  return (
    findCategoryByHandle(categories, handle) ||
    findCategoryById(categories, handle)
  )
}

export const getCategoryById = async (
  id: string
): Promise<StoreProductCategoryTree | null> => {
  const categories = await getCategoryTree()
  return findCategoryById(categories, id)
}
