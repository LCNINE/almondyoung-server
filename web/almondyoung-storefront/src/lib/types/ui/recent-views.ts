import type { StoreProduct } from "@medusajs/types"

export interface RecentViewProductItem extends StoreProduct {
  recentViewId?: string
  recentViewCreatedAt?: string
}
