"use server"

import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { getRecentViews } from "@/lib/api/users/recent-views"
import type { RecentViewProductItem } from "@/lib/types/ui/recent-views"

/**
 * 최근 본 상품 아이템 조회
 * @param countryCode - 국가 코드
 * @param limit - 조회 개수 (기본 20)
 */
export async function fetchRecentViewItems(
  countryCode: string,
  limit: number = 20
): Promise<RecentViewProductItem[]> {
  const recentViewsData = await getRecentViews(limit)

  if (!recentViewsData || recentViewsData.length === 0) {
    return []
  }

  const productIds = recentViewsData.map((item) => item.productId)
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

  const recentViewsMap = new Map(
    recentViewsData.map((item) => [item.productId, item])
  )

  const items: RecentViewProductItem[] = response.products.map((product) => {
    const meta = recentViewsMap.get(product.id)
    return {
      ...product,
      recentViewId: meta?.id,
      recentViewCreatedAt: meta?.createdAt,
    }
  })

  // 최근 본 순서대로 정렬 (최신 먼저)
  items.sort((a, b) => {
    if (!a.recentViewCreatedAt || !b.recentViewCreatedAt) return 0
    return (
      new Date(b.recentViewCreatedAt).getTime() -
      new Date(a.recentViewCreatedAt).getTime()
    )
  })

  return items
}
