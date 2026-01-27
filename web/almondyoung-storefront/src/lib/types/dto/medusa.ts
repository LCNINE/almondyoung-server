import type { HttpTypes } from "@medusajs/types"

/*───────────────────────────
 * Medusa 상품 목록 응답
 *──────────────────────────*/
interface ProductsResponseDto {
  products: HttpTypes.StoreProduct[]
  count: number
  categoryId?: string
  totalPages: number
  currentPage: number
}

/*───────────────────────────
 * Medusa 카트 응답
 *──────────────────────────*/
interface CartResponseDto {
  cart: HttpTypes.StoreCart & {
    customer: {
      groups: {
        id: string
        email: string
        created_at: string
        created_by: string
        deleted_at: string
        updated_at: string
        metadata: Record<string, any>
        name: string
      }[]
    }
  }
}

export type { ProductsResponseDto, CartResponseDto }
