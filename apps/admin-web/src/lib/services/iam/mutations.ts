'use client';

import { iamApi } from '@/lib/api/domains/iam';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import type { CreatePiiAccessReviewInput } from '@/lib/types/dto/iam';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { iamQueryKeys } from './query-keys';

/** 접속기록 점검 완료 — 기간·점검자·메모가 남는다. */
export const useCreatePiiAccessReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePiiAccessReviewInput) => iamApi.createPiiAccessReview(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: iamQueryKeys.piiAccessReviews() }),
  });
};
useCreatePiiAccessReview.permission = [
  'iam.pii_access_log.read',
] as const satisfies PermissionRequirement;
