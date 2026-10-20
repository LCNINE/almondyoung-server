'use client';

import { roleApi } from '@/lib/api/domains/roles';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { rolesQueryKeys } from './query-keys';

/** 역할 목록(고객 역할 포함 — `audience` 로 구분). */
export const useAdminRoles = () => {
  return useSuspenseQuery({
    queryKey: rolesQueryKeys.list(),
    queryFn: () => roleApi.listRoles(),
    staleTime: 60 * 1000,
  });
};

export const useRoleDetail = (roleId: string) =>
  useQuery({
    queryKey: rolesQueryKeys.detail(roleId),
    queryFn: () => roleApi.getRole(roleId),
  });

export const useRoleMembers = (
  roleId: string,
  options: { enabled?: boolean } = {}
) =>
  useQuery({
    queryKey: rolesQueryKeys.members(roleId),
    queryFn: () => roleApi.listMembers(roleId),
    enabled: options.enabled ?? true,
  });
