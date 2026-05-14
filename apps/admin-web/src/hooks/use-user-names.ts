'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { userApi } from '@/lib/api/domains/users';

export interface UserInfo {
  username: string;
  loginId: string;
  roles: string[];
}

export function useUserNames(userIds: string[]): Record<string, UserInfo> {
  const results = useQueries({
    queries: userIds.map((userId) => ({
      queryKey: ['admin-user-name', userId],
      queryFn: () => userApi.getUserById(userId),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
  });

  return useMemo(() => {
    return userIds.reduce<Record<string, UserInfo>>((acc, userId, i) => {
      const data = results[i]?.data;
      if (data) acc[userId] = { username: data.username ?? '', loginId: data.loginId ?? '', roles: data.roles ?? [] };
      return acc;
    }, {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIds, results]);
}
