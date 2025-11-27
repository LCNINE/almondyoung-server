"use server"

import { ApiAuthError } from "@lib/api/api-error"
import { getAccessToken, getCookies } from "@lib/data/cookies"
import { WishlistDto } from "./types"

/**
 * 사용자의 위시리스트를 조회합니다
 */
export const getWishlist = async (): Promise<WishlistDto> => {
  const cookies = await getAccessToken()

  if (!cookies) {
    return {
      success: false,
      data: [],
    }
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

  return data
}
