'use client';

import { useQuery } from '@tanstack/react-query';
import { membershipApi, AdminMembersQuery } from '@/lib/api/domains/membership';
import { membershipQueryKeys } from './query-keys';

export const useMembershipMembers = (query: AdminMembersQuery) => {
  return useQuery({
    queryKey: membershipQueryKeys.memberList(query),
    queryFn: () => membershipApi.getAdminMembers(query),
  });
};
