"use server"

import { cache } from "react"
import type { WishlistResponse } from "@lib/types/dto/users"
import { api } from "../../api"

type WishlistToggleAction = "added" | "removed"

export interface WishlistToggleResult {
  action: WishlistToggleAction
  message?: string
  data?: WishlistResponse
}

/**
 * 사용자의 위시리스트를 조회합니다
 *
 * 홈 한 화면에서 섹션마다 호출해 같은 응답을 4번까지 받아오던 걸 요청 단위로 묶는다.
 * 수명은 요청 하나의 렌더 패스이며 요청 간에는 공유되지 않는다.
 */
const getWishlistOnce = cache(
  async (): Promise<WishlistResponse[]> =>
    api<WishlistResponse[]>("users", "/wishlist", {
      method: "GET",
      withAuth: true,
    })
)

// "use server" 파일은 async 함수만 export 할 수 있어 cache() 결과를 직접 내보내지
// 못한다. 얇은 async 래퍼로 감싸 호출부를 그대로 두고 메모이제이션만 얹는다.
export const getWishlist = async (): Promise<WishlistResponse[]> =>
  getWishlistOnce()

/**
 * 상품을 위시리스트에 추가/제거합니다 (토글)
 */
export const toggleWishlist = async (
  productId: string
): Promise<WishlistToggleResult> => {
  return api<WishlistToggleResult>("users", "/wishlist", {
    method: "POST",
    body: { productId },
    withAuth: true,
  })
}

/**
 * 위시리스트에 상품이 있는지 확인합니다
 */
export const getWishlistByProductId = cache(
  async (productId: string): Promise<WishlistResponse | null> => {
    const [data] = await api<WishlistResponse[]>(
      "users",
      `/wishlist/${productId}`,
      {
        method: "GET",
        withAuth: true,
        cache: "no-store",
      }
    )

    return data || null
  }
)
