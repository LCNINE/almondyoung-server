'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
import type { IamAuditFilter, IamAuditPage } from '@/lib/types/dto/iam';
import { client } from '../../client';

export const iamApi = {
  auditLogs: async (
    filter: IamAuditFilter,
    cursor: string | null
  ): Promise<IamAuditPage> =>
    (
      await client.get<IamAuditPage>(
        `${USER_SERVICE_BASE_URL}/admin/iam/audit-logs`,
        {
          params: { ...filter, ...(cursor ? { cursor } : {}), limit: 50 },
        }
      )
    ).data,
};
