import type { StoreProduct } from "@medusajs/types"

export interface FrequentProductItem extends StoreProduct {
  purchaseCount: number
  totalQuantity: number
  lastPurchasedAt?: string | null
}

export interface FrequentProductsPage {
  items: FrequentProductItem[]
  total: number
  page: number
  limit: number
}
