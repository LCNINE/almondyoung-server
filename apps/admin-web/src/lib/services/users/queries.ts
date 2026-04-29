import { userApi } from '@/lib/api/domains/users';
import { AdminUsersQuery } from '@/lib/types/dto/user';
import {
  keepPreviousData,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { usersQueryKeys } from './query-keys';

export const useAdminUsers = (query: AdminUsersQuery) => {
  return useQuery({
    queryKey: usersQueryKeys.list(query),
    queryFn: () => userApi.getAdminUsers(query),
    staleTime: 30 * 1000, // 30초
    placeholderData: keepPreviousData,
  });
};

export const useAdminUser = (id: string) => {
  return useSuspenseQuery({
    queryKey: usersQueryKeys.user(id),
    queryFn: () => userApi.getUserById(id),
    staleTime: 30 * 1000,
  });
};

export const useOptionalAdminUser = (id: string | null | undefined) => {
  return useQuery({
    queryKey: usersQueryKeys.user(id ?? ''),
    queryFn: () => userApi.getUserById(id!),
    staleTime: 30 * 1000,
    enabled: !!id,
  });
};

export const useUserRoles = (userId: string) => {
  return useSuspenseQuery({
    queryKey: usersQueryKeys.userRolesById(userId),
    queryFn: () => userApi.getUserRoles(userId),
    staleTime: 30 * 1000,
  });
};

/**
 * 사용자 ID 목록으로 배치 조회 (작성자명 lookup용)
 */
export const useAdminUsersByIds = (ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  return useQuery({
    queryKey: usersQueryKeys.batch(uniqueIds),
    queryFn: () =>
      userApi.getAdminUsers({
        ids: uniqueIds.join(','),
        limit: uniqueIds.length,
      }),
    enabled: uniqueIds.length > 0,
    staleTime: 60 * 1000,
  });
};
