import { VariantPrice } from "@/lib/types/common/price"
import { HttpTypes } from "@medusajs/types"

export type SelectedItem = {
  variantId: string
  quantity: number
  variant: HttpTypes.StoreProductVariant
  price: VariantPrice
  label: string
}
