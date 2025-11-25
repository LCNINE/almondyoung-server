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

export type FilterStatus = "all" | "new" | "used"

export interface DigitalAssetLicense {
  id: string
  digital_asset_id: string
  customer_id: string
  order_item_id: string
  is_exercised: boolean
  digital_asset: {
    id: string
    name: string
    file_name: string
    file_size: number
    file_type: string
    file_url: string | null // is_exercised가 false면 null로나옴
    thumbnail_url?: string
    created_at: string
  }
}

export interface DigitalAssetsResponse {
  success: boolean
  data: {
    licenses: DigitalAssetLicense[]
    count: number
    skip: number
    take: number
  }
}
