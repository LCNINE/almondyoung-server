"use server"

import { getBestProductRankings } from "@lib/api/analytics"
import { listProducts } from "@/lib/api/medusa/products"
import { HttpTypes } from "@medusajs/types"

type GetCategoryBestProductsParams = {
  categoryId: string
  regionId?: string
  limit?: number
}

export async function getCategoryBestProducts({
  categoryId,
  regionId,
  limit = 10,
}: GetCategoryBestProductsParams): Promise<HttpTypes.StoreProduct[]> {
  // 엘라스틱에서 베스트 상품 랭킹 조회
  const bestRankings = await getBestProductRankings({
    categoryId,
    limit,
  })

  if (!bestRankings.length) {
    return []
  }

  // masterId(handle)들로 Medusa 상품 조회
  const handles = bestRankings.map((item) => item.masterId)

  const {
    response: { products },
  } = await listProducts({
    queryParams: {
      handle: handles,
      limit: handles.length,
    },
    regionId,
  })

  // 엘라스틱 랭킹 순서대로 정렬
  const handleOrder = new Map(handles.map((handle, index) => [handle, index]))
  const sortedProducts = [...products].sort((a, b) => {
    const orderA = handleOrder.get(a.handle ?? "") ?? Infinity
    const orderB = handleOrder.get(b.handle ?? "") ?? Infinity
    return orderA - orderB
  })

  return sortedProducts
}
