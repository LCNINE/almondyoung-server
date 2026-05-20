'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import {
  AdminCommentDto,
  CreateReviewCommentDto,
  ReviewDto,
  ReviewListQuery,
  ReviewListResponse,
  UpdateReviewStatusDto,
} from '@/lib/types/dto/review';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

function buildQueryString(query: ReviewListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const reviewApi = {
  // 리뷰 목록 조회 (관리자용)
  getReviews: async (query: ReviewListQuery): Promise<ReviewListResponse> => {
    const qs = buildQueryString(query);
    const response: AxiosResponse<ReviewListResponse> = await client.get(
      `${UGC_SERVICE_BASE_URL}/reviews/admin/reviews${qs ? `?${qs}` : ''}`
    );
    return response.data;
  },

  // 리뷰 상세 조회 (관리자용)
  getReview: async (id: string): Promise<ReviewDto> => {
    const response: AxiosResponse<ReviewDto> = await client.get(
      `${UGC_SERVICE_BASE_URL}/reviews/admin/reviews/${id}`
    );
    return response.data;
  },

  // 리뷰 상태 변경 (활성/숨김/삭제)
  updateStatus: async (
    reviewId: string,
    dto: UpdateReviewStatusDto
  ): Promise<ReviewDto> => {
    const response: AxiosResponse<ReviewDto> = await client.patch(
      `${UGC_SERVICE_BASE_URL}/reviews/admin/reviews/${reviewId}/status`,
      dto
    );
    return response.data;
  },

  // 어드민 댓글 작성
  createComment: async (
    reviewId: string,
    dto: CreateReviewCommentDto
  ): Promise<AdminCommentDto> => {
    const response: AxiosResponse<AdminCommentDto> = await client.post(
      `${UGC_SERVICE_BASE_URL}/reviews/${reviewId}/comment`,
      dto
    );
    return response.data;
  },

  // 어드민 댓글 수정
  updateComment: async (
    reviewId: string,
    dto: CreateReviewCommentDto
  ): Promise<AdminCommentDto> => {
    const response: AxiosResponse<AdminCommentDto> = await client.patch(
      `${UGC_SERVICE_BASE_URL}/reviews/${reviewId}/comment`,
      dto
    );
    return response.data;
  },

  // 어드민 댓글 삭제
  deleteComment: async (reviewId: string): Promise<void> => {
    await client.delete(
      `${UGC_SERVICE_BASE_URL}/reviews/${reviewId}/comment`
    );
  },

  // 리뷰 삭제 (관리자, soft delete)
  deleteReview: async (reviewId: string): Promise<void> => {
    await client.delete(
      `${UGC_SERVICE_BASE_URL}/reviews/admin/reviews/${reviewId}`
    );
  },
};
