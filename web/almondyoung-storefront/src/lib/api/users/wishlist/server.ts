"use server"

import { ApiAuthError } from "@lib/api/api-error"
import { getAccessToken, getCookies } from "@lib/data/cookies"
import { WishlistDto } from "./types"

// WishlistItem 타입 export
export interface WishlistItem {
  id: string
  userId: string
  productId: string
  createdAt: string
  updatedAt?: string
}

/**
 * 사용자의 위시리스트를 조회합니다
 */
export const getWishlist = async (): Promise<WishlistItem[]> => {
  const cookies = await getAccessToken()

  if (!cookies) {
    return []
  }

  const response = await fetch(`${process.env.APP_URL}/api/users/wishlist`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
  })
  const data = await response.json()

  if (!response.ok) {
    console.error("Failed to get wishlist:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new Error(data.message || "Failed to get wishlist")
  }

  // API 응답이 배열인 경우 그대로 반환, 아닌 경우 data 필드 확인
  return Array.isArray(data) ? data : data.data || []
}

/**
 * 위시리스트에 상품을 추가합니다 (토글 API 사용)
 */
export const addToWishlist = async (productId: string): Promise<void> => {
  const cookies = await getAccessToken()

  if (!cookies) {
    throw new ApiAuthError("Unauthorized", 401, "로그인이 필요합니다.", {})
  }

  const response = await fetch(`${process.env.APP_URL}/api/users/wishlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({ productId }),
  })

  const data = await response.json()

  if (!response.ok) {
    console.error("Failed to add to wishlist:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new Error(data.message || "Failed to add to wishlist")
  }
}

/**
 * 위시리스트에서 상품을 제거합니다 (토글 API 사용)
 * @param wishlistId - 위시리스트 항목 ID (실제로는 productId로 토글)
 */
export const removeFromWishlist = async (wishlistId: string): Promise<void> => {
  // 위시리스트에서 해당 항목의 productId를 찾아서 토글해야 함
  // 먼저 현재 위시리스트를 조회해서 productId를 찾음
  const wishlist = await getWishlist()
  const item = wishlist.find((w) => w.id === wishlistId)

  if (!item) {
    throw new Error("위시리스트 항목을 찾을 수 없습니다.")
  }

  const cookies = await getAccessToken()

  if (!cookies) {
    throw new ApiAuthError("Unauthorized", 401, "로그인이 필요합니다.", {})
  }

  const response = await fetch(`${process.env.APP_URL}/api/users/wishlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
    },
    body: JSON.stringify({ productId: item.productId }),
  })

  const data = await response.json()

  if (!response.ok) {
    console.error("Failed to remove from wishlist:", data)

    if (response.status === 401) {
      throw new ApiAuthError(
        "Unauthorized",
        response.status,
        data.message,
        data
      )
    }

    throw new Error(data.message || "Failed to remove from wishlist")
  }
}
