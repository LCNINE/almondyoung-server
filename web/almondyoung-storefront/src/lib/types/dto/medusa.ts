import type { StoreProduct } from "@medusajs/types"

/*───────────────────────────
 * Medusa 상품 목록 응답
 *──────────────────────────*/
interface ProductsResponseDto {
  products: StoreProduct[]
  count: number
  categoryId?: string
  totalPages: number
  currentPage: number
}

export type { ProductsResponseDto }
