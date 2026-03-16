'use client';

import { roleApi } from '@/lib/api/domains/roles';
import { CreateRoleDto, UpdateRoleDto } from '@/lib/types/dto/user';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { rolesQueryKeys } from './query-keys';

export const useCreateRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateRoleDto) => roleApi.createRole(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKeys.list() });
    },
  });
};

export const useUpdateRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roleId, dto }: { roleId: string; dto: UpdateRoleDto }) =>
      roleApi.updateRole(roleId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKeys.list() });
    },
  });
};

export const useDeleteRole = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (roleId: string) => roleApi.deleteRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKeys.list() });
    },
  });
};
