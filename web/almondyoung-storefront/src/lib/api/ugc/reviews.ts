"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import {
  ReviewResponseDto,
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
  ToggleReactionDto,
  ToggleReactionResponseDto,
  CreateCommentDto,
  CommentResponseDto,
} from "@/lib/types/dto/ugc"
import { getAccessToken, getCookies } from "@/lib/data/cookies"

const UGC_BASE_URL = "http://localhost:8090"

const getAuthHeaders = async () => {
  const accessToken = await getAccessToken()
  const cookieString = await getCookies()

  if (!accessToken) {
    throw new Error("인증이 필요합니다")
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    Cookie: cookieString,
  }
}

/**
 * 상품별 리뷰 목록 조회 (공개 API)
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

  // todo: 임시 - 로컬 직접 호출
  const result = await fetch(`${UGC_BASE_URL}/reviews?${queryString}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 생성 (인증 필요)
 */
export const createReview = async (
  dto: CreateReviewDto
): Promise<ReviewResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/reviews`, {
    method: "POST",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 수정 (인증 필요, 작성자만 가능)
 */
export const updateReview = async (
  id: string,
  dto: UpdateReviewDto
): Promise<ReviewResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/reviews/${id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 삭제 (인증 필요, 작성자만 가능)
 * 소프트 삭제 - status가 'deleted'로 변경됨
 */
export const deleteReview = async (id: string): Promise<void> => {
  const headers = await getAuthHeaders()

  await fetch(`${UGC_BASE_URL}/reviews/${id}`, {
    method: "DELETE",
    headers,
  })
}

/**
 * 리뷰 반응 토글 (인증 필요)
 */
export const toggleReviewReaction = async (
  id: string,
  dto: ToggleReactionDto
): Promise<ToggleReactionResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/reviews/${id}/reactions`, {
    method: "POST",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 관리자 댓글 작성 (관리자 인증 필요)
 */
export const createReviewComment = async (
  reviewId: string,
  dto: CreateCommentDto
): Promise<CommentResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/reviews/${reviewId}/comment`, {
    method: "POST",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 관리자 댓글 수정 (관리자 인증 필요)
 */
export const updateReviewComment = async (
  reviewId: string,
  dto: CreateCommentDto
): Promise<CommentResponseDto> => {
  const headers = await getAuthHeaders()

  const result = await fetch(`${UGC_BASE_URL}/reviews/${reviewId}/comment`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(dto),
  })

  const data = await result.json()

  return data
}

/**
 * 리뷰 관리자 댓글 삭제 (관리자 인증 필요)
 */
export const deleteReviewComment = async (reviewId: string): Promise<void> => {
  const headers = await getAuthHeaders()

  await fetch(`${UGC_BASE_URL}/reviews/${reviewId}/comment`, {
    method: "DELETE",
    headers,
  })
}
