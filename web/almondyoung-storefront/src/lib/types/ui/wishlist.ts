import type { StoreProduct } from "@medusajs/types"

export interface WishlistProductItem extends StoreProduct {
  wishlistId?: string
  wishlistCreatedAt?: string
}
