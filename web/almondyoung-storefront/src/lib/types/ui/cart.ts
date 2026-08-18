// 장바구니 아이템 타입 정의
interface CartItemProduct {
  name: string
  thumbnail?: string
  basePrice?: number
  membershipPrice?: number
  unitPrice?: number
  brand?: string
  isMembershipOnly?: boolean
  isWelcomeMembership?: boolean
}

interface CartItem {
  id: string
  productId: string
  productHandle?: string
  variantId?: string
  selectedOptionText?: string
  product: CartItemProduct
  selectedOptions: Record<string, string>
  quantity: number
  isSelected?: boolean
  manageInventory?: boolean
  inventoryQuantity?: number
}

interface CartTotals {
  currency_code: string
  item_subtotal: number
  original_item_subtotal: number
  shipping: number
  /** 배송비 그룹당 1개인 배송 방법별 금액. 2개 이상일 때만 배송비 아래에 나눠 보여준다. */
  shippingBreakdown?: { id: string; name: string; amount: number }[]
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
