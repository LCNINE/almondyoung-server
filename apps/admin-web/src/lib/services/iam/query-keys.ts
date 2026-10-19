import type { IamAuditFilter } from '@/lib/types/dto/iam';

export const iamQueryKeys = {
  all: ['iam'] as const,
  auditLogs: (filter: IamAuditFilter) =>
    [...iamQueryKeys.all, 'audit-logs', filter] as const,
} as const;
