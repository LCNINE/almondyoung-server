'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewRewardApi } from '@/lib/api/domains/review-reward';
import { UpsertReviewRewardRuleDto } from '@/lib/types/dto/review-reward';
import { reviewRewardQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

const useInvalidateAll = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: reviewRewardQueryKeys.all });
};

export const useCreateReviewRewardRule = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (dto: UpsertReviewRewardRuleDto) => reviewRewardApi.createRule(dto),
    onSuccess: invalidate,
  });
};
useCreateReviewRewardRule.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useUpdateReviewRewardRule = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpsertReviewRewardRuleDto }) =>
      reviewRewardApi.updateRule(id, dto),
    onSuccess: invalidate,
  });
};
useUpdateReviewRewardRule.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useSetReviewRewardRuleActive = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => reviewRewardApi.setRuleActive(id, active),
    onSuccess: invalidate,
  });
};
useSetReviewRewardRuleActive.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useDeleteReviewRewardRule = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => reviewRewardApi.deleteRule(id),
    onSuccess: invalidate,
  });
};
useDeleteReviewRewardRule.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useGenerateBestSelections = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: () => reviewRewardApi.generateBestSelections(),
    onSuccess: invalidate,
  });
};
useGenerateBestSelections.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useConfirmBestSelection = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => reviewRewardApi.confirmBestSelection(id),
    onSuccess: invalidate,
  });
};
useConfirmBestSelection.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;

export const useRejectBestSelection = () => {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => reviewRewardApi.rejectBestSelection(id),
    onSuccess: invalidate,
  });
};
useRejectBestSelection.permission = ['cs.reward_policy.write'] as const satisfies PermissionRequirement;
