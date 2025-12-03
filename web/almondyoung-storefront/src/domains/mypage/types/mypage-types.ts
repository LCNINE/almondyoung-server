export interface QuickLink {
  label: string
  icon: string
}

export interface MenuItem {
  label: string
  icon: string
  path: string
}

export interface ShippingItem {
  id: string
  status: "preparing" | "shipping"
  productName: string
  price: string
  quantity: number
  orderNumber: string
  imageUrl?: string
  options?: string[]
}

export interface UserInfo {
  name: string
  email?: string
  phone?: string
}
