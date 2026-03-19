/**
 * 베스트 상품 랭킹 DTO
 * masterId는 Medusa 상품의 handle 값
 */
interface ProductRankingDto {
  masterId: string // Medusa 상품 handle
  ordersCount: number // 해당 제품이 포함된 주문 건수
  quantitySold: number // 주문 전체 판매량
  lastOrderAt?: string | null
}

export type { ProductRankingDto }
