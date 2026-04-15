import { AdminMembersQuery } from '@/lib/api/domains/membership';

export const membershipQueryKeys = {
  all: ['membership'] as const,
  members: () => [...membershipQueryKeys.all, 'members'] as const,
  memberList: (query: AdminMembersQuery) =>
    [...membershipQueryKeys.members(), query] as const,
};
