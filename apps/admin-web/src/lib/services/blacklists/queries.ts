'use client';

import { blacklistApi, BlacklistListQuery } from '@/lib/api/domains/blacklists';
import { useQuery } from '@tanstack/react-query';
import { blacklistQueryKeys } from './query-keys';

export const useBlacklists = (query?: BlacklistListQuery) => {
  return useQuery({
    queryKey: blacklistQueryKeys.list(query),
    queryFn: () => blacklistApi.getBlacklists(query),
  });
};

export const useBlacklistByUserId = (userId: string) => {
  return useQuery({
    queryKey: blacklistQueryKeys.byUserId(userId),
    queryFn: () => blacklistApi.getBlacklistByUserId(userId),
    enabled: !!userId,
    retry: false,
  });
};
