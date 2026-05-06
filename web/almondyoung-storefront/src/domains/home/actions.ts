"use server"

import type { HttpTypes } from "@medusajs/types"
import { listProducts } from "@/lib/api/medusa/products"

type Params = {
  categoryId: string
  regionId?: string
  limit?: number
}

/**
 * 카테고리별 베스트 상품 목록 — Medusa product_category id 로 직접 조회.
 */
export async function getBestProductsByCategory({
  categoryId,
  regionId,
  limit = 10,
}: Params): Promise<HttpTypes.StoreProduct[]> {
  const {
    response: { products },
  } = await listProducts({
    queryParams: { category_id: [categoryId], limit },
    regionId,
  })

  return products
}
