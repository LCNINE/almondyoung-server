"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
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
} from "@/lib/types/dto/ugc"
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
 * 리뷰 생성
 */
export const createReview = async (
  dto: CreateReviewDto
): Promise<ReviewResponseDto> => {
  return await api("ugc", `/reviews`, {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 수정
 */
export const updateReview = async (
  id: string,
  dto: UpdateReviewDto
): Promise<ReviewResponseDto> => {
  return await api("ugc", `/reviews/${id}`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 삭제
 * 소프트 삭제 - status가 'deleted'로 변경됨
 */
export const deleteReview = async (id: string): Promise<void> => {
  return await api("ugc", `/reviews/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
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
