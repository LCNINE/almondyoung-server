'use client';

import { qnaApi } from '@/lib/api/domains/qna';
import { CreateAnswerDto } from '@/lib/types/dto/qna';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qnaQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useCreateAnswer = (questionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateAnswerDto) => qnaApi.createAnswer(questionId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qnaQueryKeys.question(questionId),
      });
      queryClient.invalidateQueries({ queryKey: qnaQueryKeys.all });
    },
  });
};
useCreateAnswer.permission = ['cs.inquiry.write'] as const satisfies PermissionRequirement;

export const useUpdateAnswer = (questionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateAnswerDto) => qnaApi.updateAnswer(questionId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qnaQueryKeys.question(questionId),
      });
      queryClient.invalidateQueries({ queryKey: qnaQueryKeys.all });
    },
  });
};
useUpdateAnswer.permission = ['cs.inquiry.write'] as const satisfies PermissionRequirement;

export const useDeleteAnswer = (questionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => qnaApi.deleteAnswer(questionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qnaQueryKeys.question(questionId),
      });
      queryClient.invalidateQueries({ queryKey: qnaQueryKeys.all });
    },
  });
};
useDeleteAnswer.permission = ['cs.inquiry.write'] as const satisfies PermissionRequirement;

export const useDeleteQuestion = (questionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => qnaApi.deleteQuestion(questionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: qnaQueryKeys.question(questionId),
      });
      queryClient.invalidateQueries({ queryKey: qnaQueryKeys.all });
    },
  });
};
useDeleteQuestion.permission = ['cs.inquiry.write'] as const satisfies PermissionRequirement;
