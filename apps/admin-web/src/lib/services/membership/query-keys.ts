import { AdminMembersQuery, AdminBillingHistoryQuery } from '@/lib/api/domains/membership';

export const membershipQueryKeys = {
  all: ['membership'] as const,
  members: () => [...membershipQueryKeys.all, 'members'] as const,
  memberList: (query: AdminMembersQuery) => [...membershipQueryKeys.members(), query] as const,
  membersSummary: () => [...membershipQueryKeys.members(), 'summary'] as const,
  membersInsights: () => [...membershipQueryKeys.members(), 'insights'] as const,
  memberAxisList: (axis: string, query: Record<string, unknown>) =>
    [...membershipQueryKeys.members(), 'axis', axis, query] as const,
  memberArrears: (userId: string) => [...membershipQueryKeys.all, 'memberArrears', userId] as const,
  memberDetail: (userId: string) => [...membershipQueryKeys.all, 'memberDetail', userId] as const,
  billingEvents: (userId: string) =>
    [...membershipQueryKeys.all, 'billingEvents', userId] as const,
  contractEvents: (userId: string) =>
    [...membershipQueryKeys.all, 'contractEvents', userId] as const,
  billingHistory: (query: AdminBillingHistoryQuery) =>
    [...membershipQueryKeys.all, 'billingHistory', query] as const,
  cancellationQuote: (contractId: string) =>
    [...membershipQueryKeys.all, 'cancellationQuote', contractId] as const,
  tiersWithPlans: () => [...membershipQueryKeys.all, 'tiersWithPlans'] as const,
  recurringBilling: () => [...membershipQueryKeys.all, 'recurringBilling'] as const,
  recurringBillingOverview: () => [...membershipQueryKeys.all, 'recurringBilling', 'overview'] as const,
  recurringBillingFinance: (month: string, months: number) =>
    [...membershipQueryKeys.all, 'recurringBilling', 'finance', month, months] as const,
  upcomingBilling: (days: number) => [...membershipQueryKeys.all, 'recurringBilling', 'upcoming', days] as const,
  recurringBillingList: (query: Record<string, unknown>) => [...membershipQueryKeys.all, 'recurringBilling', 'list', query] as const,
};
