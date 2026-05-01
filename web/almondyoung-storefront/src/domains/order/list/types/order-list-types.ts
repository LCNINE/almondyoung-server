export type OrderStatus = "preparing" | "shipping" | "completed" | "cancelled"

export interface OrderProduct {
  id: number
  image: string
  title: string
  price: string
  quantity: string
  options?: string[]
}

export interface Order {
  id: string
  date: string
  status: OrderStatus
  deliveryDate?: string
  guaranteeLabel?: string
  isSeparateDelivery?: boolean
  products: OrderProduct[]
}

export interface FilterOptions {
  year: string
  month: string
}
