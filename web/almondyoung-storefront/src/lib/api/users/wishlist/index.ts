"use server"

import { api } from "@lib/api/api"
import { WishlistResponse } from "@lib/types/dto/users"

/**
 * 사용자의 위시리스트를 조회합니다
 */
export const getWishlist = async (): Promise<WishlistResponse[]> => {
  const data = await api<WishlistResponse[]>("users", "/wishlist", {
    method: "GET",
    withAuth: true,
  })

  return data
}

/**
 * 상품을 위시리스트에 추가/제거합니다 (토글)
 */
export const toggleWishlist = async (productId: string) => {
  const data = await api<WishlistResponse[]>("users", "/wishlist", {
    method: "POST",
    withAuth: true,
    body: { productId },
  })

  return data
}


/**
 * 위시리스트에 상품이 있는지 확인합니다
 */
export const getWishlistByProductId = async (productId: string): Promise<WishlistResponse | null> => {
  const data = await api<WishlistResponse[]>("users", `/wishlist/${productId}`, {
    method: "GET",
    withAuth: true,
  })

  return data[0] || null
}