"use server"

import type { HttpTypes } from "@medusajs/types"
import { listProducts } from "@/lib/api/medusa/products"
import { searchProducts } from "@/lib/api/pim/search"

type Params = {
  pimCategoryId: string
  regionId?: string
  limit?: number
}

/**
 * 카테고리별 베스트 상품 목록.
 * search 서비스에서 카테고리로 상품을 조회한 뒤,
 * 결과의 productId (= Medusa handle) 로 Medusa 상품을 일괄 조회해 검색 순서대로 반환.
 */
export async function getBestProductsByCategory({
  pimCategoryId,
  regionId,
  limit = 10,
}: Params): Promise<HttpTypes.StoreProduct[]> {
  const searchResult = await searchProducts({
    categoryIds: [pimCategoryId],
    size: limit,
  })

  if ("error" in searchResult || !searchResult.data) return []

  const handles = searchResult.data.items.map((item) => item.productId)
  if (handles.length === 0) return []

  const {
    response: { products },
  } = await listProducts({
    queryParams: { handle: handles, limit: handles.length },
    regionId,
  })

  const byHandle = new Map(products.map((p) => [p.handle, p]))
  return handles
    .map((id) => byHandle.get(id))
    .filter((p): p is HttpTypes.StoreProduct => Boolean(p))
}
