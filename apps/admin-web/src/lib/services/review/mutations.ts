'use client';

import { reviewApi } from '@/lib/api/domains/review';
import {
  AdminCreateReviewDto,
  CreateReviewCommentDto,
  UpdateReviewStatusDto,
} from '@/lib/types/dto/review';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useUpdateReviewStatus = (reviewId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdateReviewStatusDto) =>
      reviewApi.updateStatus(reviewId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reviewQueryKeys.review(reviewId),
      });
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useUpdateReviewStatus.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useCreateReviewComment = (reviewId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateReviewCommentDto) =>
      reviewApi.createComment(reviewId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reviewQueryKeys.review(reviewId),
      });
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useCreateReviewComment.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useUpdateReviewComment = (reviewId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateReviewCommentDto) =>
      reviewApi.updateComment(reviewId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reviewQueryKeys.review(reviewId),
      });
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useUpdateReviewComment.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useDeleteReviewComment = (reviewId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => reviewApi.deleteComment(reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reviewQueryKeys.review(reviewId),
      });
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useDeleteReviewComment.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useDeleteReview = (reviewId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => reviewApi.deleteReview(reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: reviewQueryKeys.review(reviewId),
      });
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useDeleteReview.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useCreateAdminReview = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: AdminCreateReviewDto) => reviewApi.createByAdmin(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewQueryKeys.all });
    },
  });
};
useCreateAdminReview.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;
