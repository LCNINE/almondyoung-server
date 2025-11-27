export interface WishlistItem {
  id: string
  userId: string
  productId: string
  createdAt: string
}

/**
 * 상품을 위시리스트에 추가/제거합니다
 */
export const toggleWishlist = async (productId: string) => {
  const response = await fetch(`/api/users/wishlist`, {
    method: "POST",
    body: JSON.stringify({ productId }),
    headers: {
      "Content-Type": "application/json",
    },
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.message || "Failed to add product to wishlist")
  }

  return data
}
