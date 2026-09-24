'use client';

import { logoContestApi } from '@/lib/api/domains/logo-contest';
import { UpdateLogoContestEntryStatusDto } from '@/lib/types/dto/logo-contest';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logoContestQueryKeys } from './query-keys';

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

export const useDesignateLogoContestWinner = (entryId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => logoContestApi.designateWinner(entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: logoContestQueryKeys.all });
    },
  });
};
