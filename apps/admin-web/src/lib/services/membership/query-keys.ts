import { AdminMembersQuery, AdminBillingHistoryQuery } from '@/lib/api/domains/membership';

export const membershipQueryKeys = {
  all: ['membership'] as const,
  members: () => [...membershipQueryKeys.all, 'members'] as const,
  memberList: (query: AdminMembersQuery) => [...membershipQueryKeys.members(), query] as const,
  memberDetail: (userId: string) => [...membershipQueryKeys.all, 'memberDetail', userId] as const,
  billingEvents: (userId: string) =>
    [...membershipQueryKeys.all, 'billingEvents', userId] as const,
  contractEvents: (userId: string) =>
    [...membershipQueryKeys.all, 'contractEvents', userId] as const,
  billingHistory: (query: AdminBillingHistoryQuery) =>
    [...membershipQueryKeys.all, 'billingHistory', query] as const,
  tiersWithPlans: () => [...membershipQueryKeys.all, 'tiersWithPlans'] as const,
  recurringBilling: () => [...membershipQueryKeys.all, 'recurringBilling'] as const,
  recurringBillingOverview: () => [...membershipQueryKeys.all, 'recurringBilling', 'overview'] as const,
  recurringBillingList: (query: Record<string, unknown>) => [...membershipQueryKeys.all, 'recurringBilling', 'list', query] as const,
};
