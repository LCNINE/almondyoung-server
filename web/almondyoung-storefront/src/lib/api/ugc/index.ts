"use server"

import { PaginatedResponseDto } from "@/lib/types/common/pagination"
import {
  ReviewResponseDto,
  CreateReviewDto,
  UpdateReviewDto,
  ReviewListQueryDto,
} from "@/lib/types/dto/ugc"
import { api } from "../api"

/**
 * 상품별 리뷰 목록 조회 (공개 API)
 */
export const getReviewsByProductId = async ({
  productId,
  rating,
  page,
  limit,
}: ReviewListQueryDto): Promise<PaginatedResponseDto<ReviewResponseDto>> => {
  const params: Record<string, string> = {
    productId,
  }

  if (rating) params.rating = rating
  if (page) params.page = String(page)
  if (limit) params.limit = String(limit)

  const queryString = new URLSearchParams(params).toString()

  const result = await fetch(
    `https://ugc-demo.up.railway.app/reviews?${queryString}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  )

  console.log("result::", result)

  const data = await result.json()
  console.log("data::", data)

  return data

  // return await api<PaginatedResponseDto<ReviewResponseDto>>("ugc", "/reviews", {
  //   method: "GET",
  //   params,
  //   withAuth: false,
  // })
}

/**
 * 리뷰 생성 (인증 필요)
 */
export const createReview = async (
  dto: CreateReviewDto
): Promise<ReviewResponseDto> => {
  return await api<ReviewResponseDto>("ugc", "/reviews", {
    method: "POST",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 수정 (인증 필요, 작성자만 가능)
 */
export const updateReview = async (
  id: string,
  dto: UpdateReviewDto
): Promise<ReviewResponseDto> => {
  return await api<ReviewResponseDto>("ugc", `/reviews/${id}`, {
    method: "PATCH",
    body: dto,
    withAuth: true,
  })
}

/**
 * 리뷰 삭제 (인증 필요, 작성자만 가능)
 * 소프트 삭제 - status가 'deleted'로 변경됨
 */
export const deleteReview = async (id: string): Promise<void> => {
  await api<void>("ugc", `/reviews/${id}`, {
    method: "DELETE",
    withAuth: true,
  })
}
