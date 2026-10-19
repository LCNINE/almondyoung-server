import type { IamAuditFilter, PiiAccessFilter } from '@/lib/types/dto/iam';

export const iamQueryKeys = {
  all: ['iam'] as const,
  auditLogs: (filter: IamAuditFilter) =>
    [...iamQueryKeys.all, 'audit-logs', filter] as const,
  piiAccessLogs: (filter: PiiAccessFilter) =>
    [...iamQueryKeys.all, 'pii-access-logs', filter] as const,
  piiAccessSummary: (from: string, to: string) =>
    [...iamQueryKeys.all, 'pii-access-summary', from, to] as const,
  piiAccessReviews: () => [...iamQueryKeys.all, 'pii-access-reviews'] as const,
} as const;
