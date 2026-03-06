"use server"
import { revalidateTag } from "next/cache"
import {
  ReviewResponseDto,
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  ToggleReactionDto,
  ToggleReactionResponseDto,
  RatingSummaryResponseDto,
  CreateCommentDto,
  CommentResponseDto,
  RewardPolicyResponseDto,
  ReviewEligibilityResponseDto,
  CreateReviewEligibilityDto,
} from "@/lib/types/dto/ugc"
import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import { api } from "../api"

/**
 * 상품별 리뷰 목록 조회
 */
export const getReviewsByProductId = async ({
  productId,
  rating,
  sort,
  page,
  limit,
}: ReviewListQueryDto): Promise<PaginatedResponseDto<ReviewResponseDto>> => {
  const params: Record<string, string> = {
    productId,
  }

  if (rating) params.rating = rating
  if (sort) params.sort = sort
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  const queryString = new URLSearchParams(params).toString()

  return await api("ugc", `/reviews?${queryString}`, {
    method: "GET",
    withAuth: false,
  })
}

/**
 * 상품별 레이팅 요약 조회
 */
export const getRatingSummary = async (
  productId: string
): Promise<RatingSummaryResponseDto> => {
  return await api("ugc", `/reviews/rating-summary`, {
    method: "GET",
    params: { productId },
    withAuth: false,
    next: { tags: [`rating-summary-${productId}`] },
  })
}

/**
 * 내 리뷰 목록 조회
 */
export const getMyReviews = async ({
  productId,
  sort,
  page,
  limit,
}: {
  productId?: string
  sort?: string
  page?: number
  limit?: number
} = {}): Promise<PaginatedResponseDto<ReviewResponseDto>> => {
  const params: Record<string, string> = {}
  if (productId) params.productId = productId
  if (sort) params.sort = sort
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  return await api("ugc", `/reviews/me`, {
    method: "GET",
    params,
    withAuth: true,
    next: { tags: ["my-reviews"] },
  })
}

/**
 * 내 리뷰 작성 자격 목록 조회
 */
export const getReviewEligibilities = async ({
  status = "available",
  page,
  limit,
}: {
  status?: "available" | "consumed"
  page?: number
  limit?: number
} = {}): Promise<PaginatedResponseDto<ReviewEligibilityResponseDto>> => {
  const params: Record<string, string> = { status }
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  return await api("ugc", `/reviews/eligibilities`, {
    method: "GET",
    params,
    withAuth: true,
    next: { tags: ["review-eligibilities"] },
  })
}

/**
 * 리뷰 작성 자격 생성 (구매 확정 시 호출)
 */
export const createReviewEligibility = async (
  dto: CreateReviewEligibilityDto
): Promise<void> => {
  await api("ugc", `/reviews/eligibilities`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 리워드 정책 조회
 */
export const getRewardPolicies = async (): Promise<
  RewardPolicyResponseDto[]
> => {
  return await api("ugc", `/reviews/reward-policies`, {
    method: "GET",
    withAuth: false,
    next: { tags: ["reward-policies"] },
  })
}

/**
 * 리뷰 생성
 */
export const createReview = async (
  dto: CreateReviewDto
): Promise<ReviewResponseDto> => {
  const result = await api<ReviewResponseDto>("ugc", `/reviews`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
  revalidateTag("review-eligibilities")
  revalidateTag("my-reviews")
  return result
}

/**
 * 리뷰 수정
 */
export const updateReview = async (
  id: string,
  dto: UpdateReviewDto
): Promise<ReviewResponseDto> => {
  const result = await api<ReviewResponseDto>("ugc", `/reviews/${id}`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
  revalidateTag("my-reviews")
  return result
}

/**
 * 리뷰 삭제
 * 소프트 삭제 - status가 'deleted'로 변경됨
 */
export const deleteReview = async (id: string): Promise<void> => {
  await api("ugc", `/reviews/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
  revalidateTag("my-reviews")
}

/**
 * 리뷰 반응 토글
 */
export const toggleReviewReaction = async (
  id: string,
  dto: ToggleReactionDto
): Promise<ToggleReactionResponseDto> => {
  return await api("ugc", `/reviews/${id}/reactions`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 관리자 댓글 작성
 */
export const createReviewComment = async (
  reviewId: string,
  dto: CreateCommentDto
): Promise<CommentResponseDto> => {
  return await api("ugc", `/reviews/${reviewId}/comment`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 관리자 댓글 수정
 */
export const updateReviewComment = async (
  reviewId: string,
  dto: CreateCommentDto
): Promise<CommentResponseDto> => {
  return await api("ugc", `/reviews/${reviewId}/comment`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 관리자 댓글 삭제
 */
export const deleteReviewComment = async (reviewId: string): Promise<void> => {
  return await api("ugc", `/reviews/${reviewId}/comment`, {
    method: "DELETE",
    withAuth: true,
  })
}
