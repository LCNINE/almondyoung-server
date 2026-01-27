// 장바구니 아이템 타입 정의
export interface CartItemProduct {
  name: string
  thumbnail?: string
  basePrice?: number
  membershipPrice?: number
  unitPrice?: number
  brand?: string
  isMembershipOnly?: boolean
}

export interface CartItem {
  id: string
  productId: string
  product: CartItemProduct
  selectedOptions: Record<string, string>
  quantity: number
  isSelected?: boolean
}
