'use client';

import { roleApi } from '@/lib/api/domains/roles';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';
import type { CreateRoleInput, UpdateRoleInput } from '@/lib/types/dto/iam';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { iamQueryKeys } from '../iam/query-keys';
import { usersQueryKeys } from '../users/query-keys';
import { rolesQueryKeys } from './query-keys';

/** 역할·부여가 바뀌면 역할·사람·이력 화면이 모두 다시 읽는다. */
const useInvalidateIam = () => {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: rolesQueryKeys.all });
    queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    queryClient.invalidateQueries({ queryKey: iamQueryKeys.all });
  };
};

export const useCreateRole = () => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => roleApi.createRole(input),
    onSuccess: invalidate,
  });
};
useCreateRole.permission = [
  'iam.role.write',
] as const satisfies PermissionRequirement;

export const useUpdateRole = (roleId: string) => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (input: UpdateRoleInput) => roleApi.updateRole(roleId, input),
    onSettled: invalidate,
  });
};
useUpdateRole.permission = [
  'iam.role.write',
] as const satisfies PermissionRequirement;

export const useReplaceRolePermissions = (roleId: string) => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (input: { permissions: string[]; version: number }) =>
      roleApi.replacePermissions(roleId, input.permissions, input.version),
    onSuccess: invalidate,
  });
};
useReplaceRolePermissions.permission = [
  'iam.role.write',
] as const satisfies PermissionRequirement;

export const useDeleteRole = () => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (input: { roleId: string; version: number }) =>
      roleApi.deleteRole(input.roleId, input.version),
    onSuccess: invalidate,
  });
};
useDeleteRole.permission = [
  'iam.role.write',
] as const satisfies PermissionRequirement;

export const useAddRoleMembers = (roleId: string) => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (input: { userIds: string[]; expiresAt: string | null }) =>
      roleApi.addMembers(roleId, input.userIds, input.expiresAt),
    onSuccess: invalidate,
  });
};
useAddRoleMembers.permission = [
  'iam.role.assign',
] as const satisfies PermissionRequirement;

export const useRemoveRoleMember = (roleId: string) => {
  const invalidate = useInvalidateIam();
  return useMutation({
    mutationFn: (userId: string) => roleApi.removeMember(roleId, userId),
    onSuccess: invalidate,
  });
};
useRemoveRoleMember.permission = [
  'iam.role.assign',
] as const satisfies PermissionRequirement;
