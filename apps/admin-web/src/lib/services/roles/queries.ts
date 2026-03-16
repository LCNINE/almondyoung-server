'use client';

import { roleApi } from '@/lib/api/domains/roles';
import { useSuspenseQuery } from '@tanstack/react-query';
import { rolesQueryKeys } from './query-keys';

export const useAdminRoles = () => {
  return useSuspenseQuery({
    queryKey: rolesQueryKeys.list(),
    queryFn: () => roleApi.listRoles(),
    staleTime: 60 * 1000,
  });
};
