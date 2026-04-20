"use server"

import { getFrequentlyPurchased } from "@/lib/api/analytics"
import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import type {
  FrequentProductItem,
  FrequentProductsPage,
} from "@/lib/types/ui/frequent-products"

/**
 * 자주 산 상품 페이지 조회 (서버 페이지네이션)
 */
export async function fetchFrequentProducts(
  countryCode: string,
  page: number = 1,
  limit: number = 12
): Promise<FrequentProductsPage> {
  const paginated = await getFrequentlyPurchased(page, limit)

  const empty: FrequentProductsPage = {
    items: [],
    total: paginated.total,
    page: paginated.page,
    limit: paginated.limit,
  }

  if (!paginated.data || paginated.data.length === 0) {
    return empty
  }

  const validItems = paginated.data.filter((item) => item.channelProductId)
  if (validItems.length === 0) {
    return empty
  }

  const productIds = validItems.map((item) => item.channelProductId as string)
  const region = await getRegion(countryCode)

  if (!region) {
    return empty
  }

  const { response } = await listProducts({
    countryCode,
    regionId: region.id,
    queryParams: {
      id: productIds,
      limit: productIds.length,
    },
  })

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

  items.sort((a, b) => b.purchaseCount - a.purchaseCount)

  return {
    items,
    total: paginated.total,
    page: paginated.page,
    limit: paginated.limit,
  }
}
