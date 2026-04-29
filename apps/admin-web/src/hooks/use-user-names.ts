'use client';

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { userApi } from '@/lib/api/domains/users';

export function useUserNames(userIds: string[]): Record<string, string> {
  const results = useQueries({
    queries: userIds.map((userId) => ({
      queryKey: ['admin-user-name', userId],
      queryFn: () => userApi.getUserById(userId),
      staleTime: 5 * 60 * 1000,
      retry: 1,
    })),
  });

  return useMemo(() => {
    return userIds.reduce<Record<string, string>>((acc, userId, i) => {
      const name = results[i]?.data?.username;
      if (name) acc[userId] = name;
      return acc;
    }, {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIds, results]);
}
