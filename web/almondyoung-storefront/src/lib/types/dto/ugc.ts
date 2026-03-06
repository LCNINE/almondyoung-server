import {
  ReviewRatingFilter,
  ReviewSortOption,
  QnaSortOption,
} from "../common/filter"

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
  eligibilityId: string
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

interface RatingSummaryResponseDto {
  productId: string
  averageRating: number
  totalCount: number
  ratingDistribution: Record<number, number>
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

// ─── Review Eligibility ───

interface ReviewEligibilityResponseDto {
  id: string
  userId: string
  productId: string
  orderId: string
  orderLineId: string
  eligibleAt: string
  consumedAt: string | null
  consumedByReviewId: string | null
  createdAt: string
  expiresAt: string
}

interface CreateReviewEligibilityDto {
  orderId: string
  items: Array<{ productId: string; orderLineId: string }>
}

// ─── Reward Policy ───

type ReviewRewardType = "TEXT" | "PHOTO"

interface RewardPolicyResponseDto {
  reviewType: ReviewRewardType
  rewardAmount: number
  minContentLength: number
  minMediaCount: number
}

// ─── Q&A ───

type QuestionStatus = "active" | "answered" | "deleted"

interface QuestionResponseDto {
  id: string
  userId: string
  nickname: string
  productId: string
  title: string
  content: string
  isSecret: boolean
  status: QuestionStatus
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
  nickname: string
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

interface QnaSummaryResponseDto {
  productId: string
  totalCount: number
  answeredCount: number
  unansweredCount: number
}

export type {
  ReviewResponseDto,
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  ToggleReactionDto,
  ToggleReactionResponseDto,
  RatingSummaryResponseDto,
  CreateCommentDto,
  CommentResponseDto,
  QuestionResponseDto,
  AnswerResponseDto,
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionListQueryDto,
  CreateAnswerDto,
  QuestionStatus,
  QnaSummaryResponseDto,
  RewardPolicyResponseDto,
  ReviewRewardType,
  ReviewEligibilityResponseDto,
  CreateReviewEligibilityDto,
}
