import type { HttpTypes } from "@medusajs/types"

/*───────────────────────────
 * Medusa 그룹 인터페이스
 *──────────────────────────*/
interface CustomerGroup {
  id: string
  name?: string | null
  metadata?: Record<string, any> | null
  created_by?: string | null
  created_at?: string | null
  updated_at?: string | null
  deleted_at?: string | null
}

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
      groups: CustomerGroup[]
    }
  }
}

/*───────────────────────────
 * Medusa 고객 응답
 *──────────────────────────*/
interface CustomerResponseDto {
  customer: HttpTypes.StoreCustomer & {
    groups: CustomerGroup[]
  }
}

type StoreCustomerWithGroupsResDto = HttpTypes.StoreCustomer & {
  groups?: CustomerGroup[]
}

export type {
  ProductsResponseDto,
  CartResponseDto,
  CustomerResponseDto,
  CustomerGroup,
  StoreCustomerWithGroupsResDto,
}
