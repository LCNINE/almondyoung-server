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

/** 권한은 백엔드 사본과 같은 30초 주기로 따라온다. 창으로 돌아오면 다시 읽는다. */
export const useMyPermissions = () => {
  return useQuery({
    queryKey: authQueryKeys.myPermissions(),
    queryFn: () => userApi.getMyPermissions(),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
};
