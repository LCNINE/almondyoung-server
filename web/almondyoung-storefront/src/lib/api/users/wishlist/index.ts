"use server"

import { revalidateTag } from "next/cache"
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
 */
export const getWishlist = async (): Promise<WishlistResponse[]> => {
  return api<WishlistResponse[]>("users", "/wishlist", {
    method: "GET",
    withAuth: true,
  })
}

/**
 * 상품을 위시리스트에 추가/제거합니다 (토글)
 */
export const toggleWishlist = async (
  productId: string
): Promise<WishlistToggleResult> => {
  const result = await api<WishlistToggleResult>("users", "/wishlist", {
    method: "POST",
    body: { productId },
    withAuth: true,
  })
  revalidateTag("wishlist")
  return result
}

/**
 * 위시리스트에 상품이 있는지 확인합니다
 */
export const getWishlistByProductId = async (
  productId: string
): Promise<WishlistResponse | null> => {
  const [data] = await api<WishlistResponse[]>(
    "users",
    `/wishlist/${productId}`,
    {
      method: "GET",
      withAuth: true,
      next: { tags: ["wishlist"] },
    }
  )

  return data || []
}
