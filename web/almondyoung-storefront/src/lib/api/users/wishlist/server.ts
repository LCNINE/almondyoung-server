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
  try {
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

    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      console.error("Wishlist API returned non-JSON response:", {
        status: response.status,
        contentType,
      })
      return [] // 빈 배열 반환 (에러 페이지 방지)
    }

    const data = await response.json()

    if (!response.ok) {
      console.error("Failed to get wishlist:", data)

      if (response.status === 401) {
        // 인증 에러는 조용히 처리 (빈 배열 반환)
        return []
      }

      // 다른 에러도 빈 배열 반환 (페이지 크래시 방지)
      return []
    }

    // API 응답이 배열인 경우 그대로 반환, 아닌 경우 data 필드 확인
    return Array.isArray(data) ? data : data.data || []
  } catch (error) {
    console.error("Wishlist fetch error:", error)
    return [] // 모든 에러는 빈 배열 반환 (페이지 크래시 방지)
  }
}

/**
 * 위시리스트에 상품을 추가합니다 (토글 API 사용)
 */
export const addToWishlist = async (productId: string): Promise<void> => {
  try {
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

    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      console.error("Wishlist API returned non-JSON response:", {
        status: response.status,
        contentType,
      })
      throw new Error("Failed to add to wishlist")
    }

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
  } catch (error) {
    // JSON 파싱 에러 등 모든 에러 재발생
    if (error instanceof ApiAuthError) {
      throw error
    }
    throw new Error(
      error instanceof Error ? error.message : "Failed to add to wishlist"
    )
  }
}

/**
 * 위시리스트에서 상품을 제거합니다 (토글 API 사용)
 * @param wishlistId - 위시리스트 항목 ID (실제로는 productId로 토글)
 */
export const removeFromWishlist = async (wishlistId: string): Promise<void> => {
  try {
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

    const contentType = response.headers.get("content-type")
    if (!contentType || !contentType.includes("application/json")) {
      console.error("Wishlist API returned non-JSON response:", {
        status: response.status,
        contentType,
      })
      throw new Error("Failed to remove from wishlist")
    }

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
  } catch (error) {
    // JSON 파싱 에러 등 모든 에러 재발생
    if (error instanceof ApiAuthError) {
      throw error
    }
    throw new Error(
      error instanceof Error ? error.message : "Failed to remove from wishlist"
    )
  }
}
