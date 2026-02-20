"use server"

import { revalidateTag } from "next/cache"
import {
  createReview as createReviewApi,
  updateReview as updateReviewApi,
  deleteReview as deleteReviewApi,
} from "@/lib/api/ugc"
import type { ReviewInfo, WritableReview } from "../types"

const REVIEWS_CACHE_TAG = "reviews"

function toCreateDto(review: WritableReview, data: ReviewInfo) {
  return {
    productId: review.productId,
    rating: data.rating,
    content: data.text,
  }
}

function toUpdateDto(data: ReviewInfo) {
  return {
    rating: data.rating,
    content: data.text,
  }
}

/**
 * 리뷰 생성 (작성 가능한 리뷰에서 신규 작성)
 */
export async function createReviewAction(
  review: WritableReview,
  data: ReviewInfo
) {
  const dto = toCreateDto(review, data)
  const result = await createReviewApi(dto)
  revalidateTag(REVIEWS_CACHE_TAG)
  return result
}

/**
 * 리뷰 수정 (내가 작성한 리뷰에서 수정)
 */
export async function updateReviewAction(
  reviewId: string,
  data: ReviewInfo
) {
  const dto = toUpdateDto(data)
  const result = await updateReviewApi(reviewId, dto)
  revalidateTag(REVIEWS_CACHE_TAG)
  return result
}

/**
 * 리뷰 삭제 (소프트 삭제)
 */
export async function deleteReviewAction(reviewId: string) {
  await deleteReviewApi(reviewId)
  revalidateTag(REVIEWS_CACHE_TAG)
}
