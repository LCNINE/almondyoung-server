// src/lib/services/users/mutations.ts

/**
 * 어드민 관련 뮤테이션
 *
 */
'use client';

import { userApi } from '@/lib/api/domains/users';
import { ReplaceUserRolesDto } from '@/lib/types/dto/user';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersQueryKeys } from './query-keys';

export const useReplaceUserRoles = (userId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: ReplaceUserRolesDto) =>
      userApi.replaceUserRoles(userId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: usersQueryKeys.userRolesById(userId),
      });
    },
  });
};
