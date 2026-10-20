'use client';

import { USER_SERVICE_BASE_URL } from '@/const';
import type {
  CreatePiiAccessReviewInput,
  IamAuditFilter,
  IamAuditPage,
  PiiAccessFilter,
  PiiAccessPage,
  PiiAccessReview,
  PiiAccessSummary,
} from '@/lib/types/dto/iam';
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

  piiAccessLogs: async (
    filter: PiiAccessFilter,
    cursor: string | null
  ): Promise<PiiAccessPage> =>
    (
      await client.get<PiiAccessPage>(
        `${USER_SERVICE_BASE_URL}/admin/iam/pii-access-logs`,
        { params: { ...filter, ...(cursor ? { cursor } : {}), limit: 50 } }
      )
    ).data,
  piiAccessSummary: async (from: string, to: string): Promise<PiiAccessSummary> =>
    (
      await client.get<PiiAccessSummary>(
        `${USER_SERVICE_BASE_URL}/admin/iam/pii-access-logs/summary`,
        { params: { from, to } }
      )
    ).data,
  piiAccessReviews: async (): Promise<PiiAccessReview[]> =>
    (
      await client.get<PiiAccessReview[]>(
        `${USER_SERVICE_BASE_URL}/admin/iam/pii-access-reviews`
      )
    ).data,
  createPiiAccessReview: async (
    input: CreatePiiAccessReviewInput
  ): Promise<PiiAccessReview> =>
    (
      await client.post<PiiAccessReview>(
        `${USER_SERVICE_BASE_URL}/admin/iam/pii-access-reviews`,
        input
      )
    ).data,
};
