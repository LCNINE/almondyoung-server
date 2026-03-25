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

export const useUserRoles = (userId: string) => {
  return useSuspenseQuery({
    queryKey: usersQueryKeys.userRolesById(userId),
    queryFn: () => userApi.getUserRoles(userId),
    staleTime: 30 * 1000,
  });
};
