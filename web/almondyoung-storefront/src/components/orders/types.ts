/**
 * 주문 관련 타입 정의
 */

export interface Order {
  id: string
  date: string
  status: OrderStatus
  deliveryDate?: string
  guaranteeLabel?: string
  isSeparateDelivery?: boolean
  products: ShippingProduct[]
}

export type OrderStatus = 
  | "preparing"
  | "shipping" 
  | "completed" 
  | "cancelled"

export interface ShippingProduct {
  id: number
  image: string
  title: string
  price: string
  quantity: string
  options?: string[]
}

export interface GroupedOrders {
  [date: string]: Order[]
}
