import type { CartItem } from "@lib/types/ui/cart"

export interface DerivedCartItemPricing {
  quantity: number
  baseUnitPrice: number
  memberUnitPrice: number
  displayUnitPrice: number
  hasMembershipPrice: boolean
  isMembershipApplied: boolean
  discountRate: number
}

export const deriveCartItemPricing = (
  item: CartItem,
  isMembershipPricing: boolean
): DerivedCartItemPricing => {
  const quantity = item.quantity || 1
  const baseUnitPrice = item.product.basePrice || item.product.unitPrice || 0
  const cartUnitPrice = item.product.unitPrice || baseUnitPrice
  const hasMembershipPrice = cartUnitPrice > 0 && cartUnitPrice < baseUnitPrice
  const memberUnitPrice = cartUnitPrice
  const displayUnitPrice = cartUnitPrice
  const membershipSavingsPerUnit = Math.max(0, baseUnitPrice - memberUnitPrice)
  const isMembershipApplied = isMembershipPricing && membershipSavingsPerUnit > 0
  const discountRate =
    membershipSavingsPerUnit > 0 && baseUnitPrice > 0
      ? Math.round((membershipSavingsPerUnit / baseUnitPrice) * 100)
      : 0

  return {
    quantity,
    baseUnitPrice,
    memberUnitPrice,
    displayUnitPrice,
    hasMembershipPrice,
    isMembershipApplied,
    discountRate,
  }
}
