import { AdminMembersQuery, AdminBillingHistoryQuery } from '@/lib/api/domains/membership';

export const membershipQueryKeys = {
  all: ['membership'] as const,
  members: () => [...membershipQueryKeys.all, 'members'] as const,
  memberList: (query: AdminMembersQuery) => [...membershipQueryKeys.members(), query] as const,
  memberDetail: (userId: string) => [...membershipQueryKeys.all, 'memberDetail', userId] as const,
  billingEvents: (contractId: string) =>
    [...membershipQueryKeys.all, 'billingEvents', contractId] as const,
  contractEvents: (contractId: string) =>
    [...membershipQueryKeys.all, 'contractEvents', contractId] as const,
  billingHistory: (query: AdminBillingHistoryQuery) =>
    [...membershipQueryKeys.all, 'billingHistory', query] as const,
};
