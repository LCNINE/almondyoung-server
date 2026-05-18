// src/lib/services/users/mutations.ts

/**
 * 어드민 관련 뮤테이션
 *
 */
'use client';

import { userApi } from '@/lib/api/domains/users';
import { ReplaceUserRolesDto, UpdateMyProfileDto } from '@/lib/types/dto/user';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth';
import { usersQueryKeys } from './query-keys';

export const useUpdateMyProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMyProfileDto) => userApi.updateMyProfile(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me() });
    },
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => userApi.changePassword(currentPassword, newPassword),
  });
};

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
