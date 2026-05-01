import type { HttpTypes } from "@medusajs/types"

export type StoreProductCategoryTree = HttpTypes.StoreProductCategory & {
  category_children?: StoreProductCategoryTree[]
}
