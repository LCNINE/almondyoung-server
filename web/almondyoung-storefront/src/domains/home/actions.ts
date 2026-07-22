"use server"

import type { HttpTypes } from "@medusajs/types"
import { getCategoryByHandle } from "@/lib/api/medusa/categories"
import { listProducts } from "@/lib/api/medusa/products"
import { collectCategoryIds } from "@/lib/utils/collect-category-ids"

type Params = {
  handle: string
  regionId?: string
  limit?: number
}

/**
 * 카테고리별 베스트 상품 목록.
 */
export async function getBestProductsByCategory({
  handle,
  regionId,
  limit = 10,
}: Params): Promise<HttpTypes.StoreProduct[]> {
  const category = await getCategoryByHandle([handle])

  // 카테고리를 못 찾으면(비활성/삭제) 빈 목록. category_id 를 빼고 조회하면
  // 필터가 통째로 무시돼 전 카테고리 상품이 섞여 나온다.
  if (!category) {
    return []
  }

  const {
    response: { products },
  } = await listProducts({
    queryParams: { category_id: collectCategoryIds(category), limit },
    regionId,
  })

  return products
}
