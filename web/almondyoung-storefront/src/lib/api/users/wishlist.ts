"use client"

import { clientApi } from "@lib/api/client-api"
import { USER_SERVICE_BASE_URL } from "../api.config"

export interface WishlistItem {
  id: string
  userId: string
  productId: string
  createdAt: string
}

export interface AddToWishlistDto {
  productId: string
}

export interface WishlistResponse {
  message: string
}

/**
 * 상품을 위시리스트에 추가합니다
 */
export const addToWishlist = async (
  productId: string
): Promise<WishlistResponse> => {
  try {
    return await clientApi<WishlistResponse>(
      USER_SERVICE_BASE_URL + "/wishlist",
      {
        method: "POST",
        body: JSON.stringify({ productId }),
      }
    )
  } catch (error) {
    console.error("위시리스트 추가 실패:", error)
    throw error
  }
}

/**
 * 사용자의 위시리스트를 조회합니다
 */
export const getWishlist = async (): Promise<WishlistItem[]> => {
  try {
    return await clientApi<WishlistItem[]>(USER_SERVICE_BASE_URL + "/wishlist")
  } catch (error) {
    console.error("위시리스트 조회 실패:", error)
    throw error
  }
}

/**
 * 위시리스트에서 상품을 제거합니다
 */
export const removeFromWishlist = async (
  wishlistId: string
): Promise<WishlistResponse> => {
  try {
    return await clientApi<WishlistResponse>(
      USER_SERVICE_BASE_URL + "/wishlist" + `/${wishlistId}`,
      {
        method: "DELETE",
      }
    )
  } catch (error) {
    console.error("위시리스트 제거 실패:", error)
    throw error
  }
}

/**
 * 특정 상품이 위시리스트에 있는지 확인합니다
 */
export const isProductInWishlist = async (
  productId: string
): Promise<boolean> => {
  try {
    const wishlist = await getWishlist()
    return wishlist.some((item) => item.productId === productId)
  } catch (error) {
    console.error("위시리스트 확인 실패:", error)
    return false
  }
}
