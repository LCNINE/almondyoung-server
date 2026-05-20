'use client';

import { reviewApi } from '@/lib/api/domains/review';
import {
  CreateReviewCommentDto,
  UpdateReviewStatusDto,
} from '@/lib/types/dto/review';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewQueryKeys } from './query-keys';

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
