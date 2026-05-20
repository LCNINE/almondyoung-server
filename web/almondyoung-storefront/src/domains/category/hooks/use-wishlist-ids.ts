"use client"

import { getWishlist } from "@/lib/api/users/wishlist/client"
import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

type UseWishlistIdsParams = {
  isLoggedIn: boolean
  initialWishlistIds: string[]
}

/**
 * 로그인 사용자의 위시리스트 productId 집합을 반환함
 * 전체 목록을 한 번에 받아 캐시하므로 어느 상품 목록에서나 동일하게 적용/재사용할 수 있지만,현재는 걍 카테고리 페이지에서만 사용
 * 비로그인 시에는 빈 집합을 반환함.
 */
export function useWishlistIds({
  isLoggedIn,
  initialWishlistIds,
}: UseWishlistIdsParams): Set<string> {
  const { data: wishlistIds } = useQuery<string[]>({
    queryKey: ["wishlist-ids"],
    queryFn: async () => {
      const list = await getWishlist()
      return list.map((item) => item.productId)
    },
    enabled: isLoggedIn,
    initialData: isLoggedIn ? initialWishlistIds : [],
  })

  return useMemo(() => new Set(wishlistIds ?? []), [wishlistIds])
}
