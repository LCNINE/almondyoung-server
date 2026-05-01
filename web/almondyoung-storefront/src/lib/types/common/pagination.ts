interface PaginatedResponseDto<T> {
  data: T[]
  total: number
  page: number
  limit: number
}

export type { PaginatedResponseDto }
