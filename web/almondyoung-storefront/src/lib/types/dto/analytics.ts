interface ProductOrderMetricDto {
  masterId: string
  ordersCount: number //해당 제품이 포함된 주문 건수
  quantitySold: number // 주문 전체 판매량
  lastOrderAt?: string | null
}

export type { ProductOrderMetricDto }
