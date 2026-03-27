'use client';

import {
  blacklistApi,
  BlacklistCreateDto,
} from '@/lib/api/domains/blacklists';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { blacklistQueryKeys } from './query-keys';

export const useCreateBlacklist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: BlacklistCreateDto) => blacklistApi.createBlacklist(dto),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: blacklistQueryKeys.byUserId(variables.userId),
      });
    },
  });
};

export const useDeleteBlacklist = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => blacklistApi.deleteBlacklist(userId),
    onSuccess: (_, userId) => {
      queryClient.invalidateQueries({
        queryKey: blacklistQueryKeys.byUserId(userId),
      });
    },
  });
};
