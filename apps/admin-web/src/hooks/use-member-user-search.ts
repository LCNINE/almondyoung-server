'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { userApi } from '@/lib/api/domains/users';

/**
 * memberQ(성함/이메일/로그인ID)로 user-service에서 userId 목록을 조회한다.
 * membership service는 userId 기반 필터만 지원하므로 이 훅으로 먼저 resolve한다.
 */
export function useMemberUserSearch(memberQ: string) {
  const { data, isFetching, isError } = useQuery({
    queryKey: ['admin-users-search', memberQ],
    queryFn: () => userApi.getAdminUsers({ q: memberQ, limit: 1000 }),
    enabled: !!memberQ,
    retry: 1,
  });

  useEffect(() => {
    if (isError) {
      toast.error('고객 정보 조회에 실패했습니다. 권한을 확인해주세요.');
    }
  }, [isError]);

  const resolvedUserIds = memberQ ? (data?.data?.map((u) => u.id) ?? null) : undefined;

  return { resolvedUserIds, isSearchingUsers: isFetching, isUserSearchError: isError };
}
