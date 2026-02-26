import { ReviewRatingFilter, ReviewSortOption, QnaSortOption } from "../common/filter"

// ─── Reviews ───

interface ReviewResponseDto {
  id: string
  userId: string | null
  legacyAuthorName: string | null // 레거시 데이터의 마스킹된 작성자명
  legacy_author_name?: string | null // 서버에서 스네이크 케이스로 올 때 대비
  productId: string
  rating: number
  content: string
  mediaFileIds: string[]
  status: string
  helpfulCount: number
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
  sort?: ReviewSortOption
  page?: number
  limit?: number
}

interface ToggleReactionDto {
  type: "helpful" | "like" | "dislike"
}

interface ToggleReactionResponseDto {
  marked: boolean
  count: number
}

interface CreateCommentDto {
  content: string
}

interface CommentResponseDto {
  id: string
  reviewId: string
  adminUserId: string
  content: string
  createdAt: string
  updatedAt: string
}

// ─── Q&A ───

interface QuestionResponseDto {
  id: string
  userId: string
  productId: string
  title: string
  content: string
  isSecret: boolean
  status: string
  mediaFileIds: string[]
  answer: AnswerResponseDto | null
  createdAt: string
  updatedAt: string
}

interface AnswerResponseDto {
  id: string
  questionId: string
  adminUserId: string
  content: string
  createdAt: string
  updatedAt: string
}

interface CreateQuestionDto {
  productId: string
  title: string
  content: string
  isSecret?: boolean
  mediaFileIds?: string[]
}

interface UpdateQuestionDto {
  title?: string
  content?: string
  isSecret?: boolean
  mediaFileIds?: string[]
}

interface QuestionListQueryDto {
  productId: string
  sort?: QnaSortOption
  page?: number
  limit?: number
}

interface CreateAnswerDto {
  content: string
}

export type {
  ReviewResponseDto,
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  ToggleReactionDto,
  ToggleReactionResponseDto,
  CreateCommentDto,
  CommentResponseDto,
  QuestionResponseDto,
  AnswerResponseDto,
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionListQueryDto,
  CreateAnswerDto,
}
