interface ReviewResponseDto {
  id: string
  userId: string
  productId: string
  rating: number
  content: string
  mediaFileIds: string[]
  status: string
  createdAt: string
  updatedAt: string
}

export type { ReviewResponseDto }
