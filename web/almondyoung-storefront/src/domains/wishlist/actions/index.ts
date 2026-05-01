"use server"

import { listProducts } from "@/lib/api/medusa/products"
import { getRegion } from "@/lib/api/medusa/regions"
import { getWishlist } from "@/lib/api/users/wishlist"
import type { WishlistProductItem } from "@/lib/types/ui/wishlist"

/**
 * 위시리스트 아이템 조회
 * @param countryCode - 국가 코드
 * @param searchQuery - 검색어 (서버 필터링)
 */
export async function fetchWishlistItems(
  countryCode: string,
  searchQuery?: string
): Promise<WishlistProductItem[]> {
  const wishlistData = await getWishlist()

  if (!wishlistData || wishlistData.length === 0) {
    return []
  }

  const productIds = wishlistData.map((item) => item.productId)
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
      ...(searchQuery?.trim() && { q: searchQuery.trim() }),
    },
  })

  const wishlistMap = new Map(
    wishlistData.map((item) => [item.productId, item])
  )

  const items: WishlistProductItem[] = response.products.map((product) => {
    const meta = wishlistMap.get(product.id)
    return {
      ...product,
      wishlistId: meta?.id,
      wishlistCreatedAt: meta?.createdAt,
    }
  })

  items.sort((a, b) => {
    if (!a.wishlistCreatedAt || !b.wishlistCreatedAt) return 0
    return (
      new Date(b.wishlistCreatedAt).getTime() -
      new Date(a.wishlistCreatedAt).getTime()
    )
  })

  return items
}
