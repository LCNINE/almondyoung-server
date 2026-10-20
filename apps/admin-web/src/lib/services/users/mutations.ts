// src/lib/services/users/mutations.ts

/**
 * 어드민 관련 뮤테이션
 *
 */
'use client';

import { userApi } from '@/lib/api/domains/users';
import {
  CreateAdminAccountDto,
  UpdateMyProfileDto,
} from '@/lib/types/dto/user';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth';
import { usersQueryKeys } from './query-keys';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import type { StaffAssignmentInput } from '@/lib/types/dto/iam';
import { iamQueryKeys } from '../iam/query-keys';
import { rolesQueryKeys } from '../roles/query-keys';

export const useUpdateMyProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpdateMyProfileDto) => userApi.updateMyProfile(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authQueryKeys.me() });
    },
  });
};
useUpdateMyProfile.permission = 'self' as const satisfies PermissionRequirement;

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
useChangePassword.permission = 'self' as const satisfies PermissionRequirement;

// 어드민(master 전용) - 관리자 계정 생성. 목록/카운트 등 users 관련 쿼리를 전부 무효화한다.
export const useCreateAdminAccount = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateAdminAccountDto) => userApi.createAdminAccount(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    },
  });
};
// 계정을 만들며 첫 역할을 준다 — 계정 관리와 역할 부여를 모두 가져야 한다
useCreateAdminAccount.permission = {
  allOf: [['iam.admin_user.write'], ['iam.role.assign']],
} as const satisfies PermissionRequirement;

/** 직원 역할만 교체(종료일 포함). 고객 역할은 그대로 둔다. */
export const useReplaceStaffRoles = (userId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignments: StaffAssignmentInput[]) => userApi.replaceStaffRoles(userId, assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: rolesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: iamQueryKeys.all });
    },
  });
};
useReplaceStaffRoles.permission = ['iam.role.assign'] as const satisfies PermissionRequirement;
