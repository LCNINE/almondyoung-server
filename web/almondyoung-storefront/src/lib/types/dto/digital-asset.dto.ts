export interface DigitalAssetsResDto {
  licenses: {
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
  }[]
  count: number
  skip: number
  take: number
}
