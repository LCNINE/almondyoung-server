/**
 * 자주 산 상품 DTO
 */
interface FrequentlyPurchasedDto {
  masterId: string // PIM Master ID
  channelProductId: string | null
  purchaseCount: number // 구매 횟수
  totalQuantity: number // 총 구매 수량
  lastPurchasedAt: string | null // 마지막 구매일
}

export type { FrequentlyPurchasedDto }
