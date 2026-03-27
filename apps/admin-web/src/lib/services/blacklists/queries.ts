'use client';

import { blacklistApi } from '@/lib/api/domains/blacklists';
import { useQuery } from '@tanstack/react-query';
import { blacklistQueryKeys } from './query-keys';

export const useBlacklistByUserId = (userId: string) => {
  return useQuery({
    queryKey: blacklistQueryKeys.byUserId(userId),
    queryFn: () => blacklistApi.getBlacklistByUserId(userId),
    enabled: !!userId,
    retry: false,
  });
};
