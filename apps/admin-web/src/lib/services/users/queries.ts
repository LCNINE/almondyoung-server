import { userApi } from '@/lib/api/domains/users';
import { AdminUsersQuery } from '@/lib/types/dto/user';
import { useQuery } from '@tanstack/react-query';
import { usersQueryKeys } from './query-keys';

export const useAdminUsers = (query: AdminUsersQuery) => {
  return useQuery({
    queryKey: usersQueryKeys.list(query),
    queryFn: () => userApi.getAdminUsers(query),
    staleTime: 30 * 1000, // 30초
  });
};
