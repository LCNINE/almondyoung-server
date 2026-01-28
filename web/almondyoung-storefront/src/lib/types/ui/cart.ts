// 장바구니 아이템 타입 정의
interface CartItemProduct {
  name: string
  thumbnail?: string
  basePrice?: number
  membershipPrice?: number
  unitPrice?: number
  brand?: string
  isMembershipOnly?: boolean
}

interface CartItem {
  id: string
  productId: string
  product: CartItemProduct
  selectedOptions: Record<string, string>
  quantity: number
  isSelected?: boolean
}

interface CartTotals {
  currency_code: string
  item_subtotal: number
  shipping: number
  discount_subtotal: number
  membershipDiscount: number
  pointsUsed: number
  totalDiscount: number
  finalTotal: number
}

interface ShippingInfo {
  amount: number
  name: string
  description: string
}

export type { CartItemProduct, CartItem, CartTotals, ShippingInfo }
