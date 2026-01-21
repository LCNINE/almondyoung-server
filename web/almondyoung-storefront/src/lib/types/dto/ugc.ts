interface ReviewResponseDto {
  id: string
  userId: string | null
  legacyAuthorName: string | null // 레거시 데이터의 마스킹된 작성자명
  productId: string
  rating: number
  content: string
  mediaFileIds: string[]
  status: string
  createdAt: string
  updatedAt: string
}

interface CreateReviewDto {
  productId: string
  rating: number // 1~5
  content: string
  mediaFileIds?: string[] // 최대 5개
}

interface UpdateReviewDto {
  rating?: number // 1~5
  content?: string
  mediaFileIds?: string[] // 최대 5개
}

interface ReviewListQueryDto {
  productId: string
  rating?: ReviewRatingFilter
  page?: number
  limit?: number
}

type ReviewRatingFilter = "1" | "2" | "3" | "4" | "5" | "positive" | "negative"

export type { ReviewResponseDto, CreateReviewDto, UpdateReviewDto, ReviewListQueryDto, ReviewRatingFilter }
