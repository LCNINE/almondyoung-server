'use client';

import { logoContestApi } from '@/lib/api/domains/logo-contest';
import { UpdateLogoContestEntryStatusDto } from '@/lib/types/dto/logo-contest';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logoContestQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

export const useUpdateLogoContestEntryStatus = (entryId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdateLogoContestEntryStatusDto) =>
      logoContestApi.updateEntryStatus(entryId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logoContestQueryKeys.all });
    },
  });
};
useUpdateLogoContestEntryStatus.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;

export const useDesignateLogoContestWinner = (entryId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => logoContestApi.designateWinner(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logoContestQueryKeys.all });
    },
  });
};
useDesignateLogoContestWinner.permission = ['cs.review.moderate'] as const satisfies PermissionRequirement;
