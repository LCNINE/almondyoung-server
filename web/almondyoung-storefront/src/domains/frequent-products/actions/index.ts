"use server"

import { getFrequentlyPurchased } from "@/lib/api/analytics"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import type { FrequentProductItem } from "@/lib/types/ui/frequent-products"

/**
 * 자주 산 상품 아이템 조회
 * @param countryCode - 국가 코드
 * @param limit - 조회할 최대 개수
 */
export async function fetchFrequentProducts(
  countryCode: string,
  limit: number = 100
): Promise<FrequentProductItem[]> {
  const frequentData = await getFrequentlyPurchased(limit)

  if (!frequentData || frequentData.length === 0) {
    return []
  }

  // channelProductId가 있는 항목만 필터링
  const validItems = frequentData.filter((item) => item.channelProductId)
  if (validItems.length === 0) {
    return []
  }

  const productIds = validItems.map((item) => item.channelProductId as string)
  const region = await getRegion(countryCode)

  if (!region) {
    return []
  }

  const { response } = await listProducts({
    countryCode,
    regionId: region.id,
    queryParams: {
      id: productIds,
      limit: productIds.length,
    },
  })

  // 구매 정보를 Map으로 변환 (빠른 조회)
  const purchaseMap = new Map(
    validItems.map((item) => [item.channelProductId, item])
  )

  const items: FrequentProductItem[] = response.products.map((product) => {
    const purchaseInfo = purchaseMap.get(product.id)
    return {
      ...product,
      purchaseCount: purchaseInfo?.purchaseCount ?? 0,
      totalQuantity: purchaseInfo?.totalQuantity ?? 0,
      lastPurchasedAt: purchaseInfo?.lastPurchasedAt,
    }
  })

  // 구매 횟수 기준 내림차순 정렬
  items.sort((a, b) => b.purchaseCount - a.purchaseCount)

  return items
}
