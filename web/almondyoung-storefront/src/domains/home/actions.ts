"use server"

import type { HttpTypes } from "@medusajs/types"
import { listProducts } from "@/lib/api/medusa/products"
import { getBestProductRankings } from "@/lib/api/analytics"

type Params = {
  pimCategoryId: string
  fallbackCategoryId: string
  regionId?: string
  limit?: number
}

/**
 * 카테고리별 베스트 상품을 랭킹 순서대로 반환.
 * 1) analytics에서 masterId 랭킹을 받아옴
 * 2) masterId(=Medusa handle)로 상품 일괄 조회
 * 3) 랭킹 순서대로 재정렬
 * 4) 랭킹이 비어있으면 카테고리 기본 목록으로 fallback
 */
export async function getBestProductsByCategory({
  pimCategoryId,
  fallbackCategoryId,
  regionId,
  limit = 10,
}: Params): Promise<HttpTypes.StoreProduct[]> {
  const rankings = await getBestProductRankings({
    categoryId: pimCategoryId,
    limit,
  })

  const masterIds = rankings.map((r) => r.masterId)

  const {
    response: { products },
  } = masterIds.length
    ? await listProducts({
        queryParams: { handle: masterIds, limit: masterIds.length },
        regionId,
      })
    : await listProducts({
        queryParams: { category_id: [fallbackCategoryId], limit },
        regionId,
      })

  if (!masterIds.length) return products

  const byHandle = new Map(products.map((p) => [p.handle, p]))
  return masterIds
    .map((id) => byHandle.get(id))
    .filter((p): p is HttpTypes.StoreProduct => Boolean(p))
}
