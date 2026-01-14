import type { StoreProduct } from "@medusajs/types"

/*───────────────────────────
 * Medusa 상품 목록 응답
 *──────────────────────────*/
export interface ProductsResponseDto {
  products: (StoreProduct & {
    metadata?: Record<string, any> | null
  })[]
  count: number
  categoryId?: string
  totalPages: number
  currentPage: number
}
