import { userApi } from '@/lib/api/domains/users';
import { useQuery } from '@tanstack/react-query';
import { authQueryKeys } from '.';

/**
 * 어드민 관련 쿼리
 */
export const useMe = () => {
  return useQuery({
    queryKey: authQueryKeys.me(),
    queryFn: () => userApi.getMe(),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5분
    gcTime: 10 * 60 * 1000, // 10분
  });
};

export const useMyRoles = () => {
  return useQuery({
    queryKey: authQueryKeys.myRoles(),
    queryFn: () => userApi.getMyRoles(),
  });
};
