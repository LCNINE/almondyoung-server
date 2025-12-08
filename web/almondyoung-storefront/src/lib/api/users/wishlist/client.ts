import { ApiAuthError, HttpApiError } from "@lib/api/api-error"

export interface WishlistItem {
  id: string
  userId: string
  productId: string
  createdAt: string
  updatedAt?: string
}

/**
 * 위시리스트 목록을 조회합니다
 */
export const getWishlist = async (): Promise<WishlistItem[]> => {
  const response = await fetch(`/api/users/wishlist`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to get wishlist",
      response.status,
      response.statusText,
      data
    )
  }

  // API 응답이 배열인 경우 그대로 반환, 아닌 경우 data 필드 확인
  return Array.isArray(data) ? data : data.data || []
}

/**
 * 상품을 위시리스트에 추가/제거합니다 (토글)
 */
export const toggleWishlist = async (productId: string) => {
  const response = await fetch(`/api/users/wishlist`, {
    method: "POST",
    body: JSON.stringify({ productId }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  })

  const data = await response.json()

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new HttpApiError(
      data.message || "Failed to add product to wishlist",
      response.status,
      response.statusText,
      data
    )
  }

  return data
}

/**
 * 위시리스트에 상품을 추가합니다 (토글 API 사용)
 */
export const addToWishlist = async (productId: string): Promise<void> => {
  await toggleWishlist(productId)
}

/**
 * 위시리스트에서 상품을 제거합니다 (토글 API 사용)
 * @param wishlistId - 위시리스트 항목 ID
 */
export const removeFromWishlist = async (wishlistId: string): Promise<void> => {
  // 위시리스트에서 해당 항목의 productId를 찾아서 토글
  const wishlist = await getWishlist()
  const item = wishlist.find((w) => w.id === wishlistId)

  if (!item) {
    throw new Error("위시리스트 항목을 찾을 수 없습니다.")
  }

  await toggleWishlist(item.productId)
}
