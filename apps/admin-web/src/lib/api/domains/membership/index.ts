'use client';

import { MEMBERSHIP_SERVICE_BASE_URL } from '@/const';
import { AdminRecurringContractSummary } from '@/lib/types/dto/membership';
import { client } from '../../client';

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  /** ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status?: string;
  /** userId partial search */
  q?: string;
  /** filter by resolved userIds (from user-service lookup) */
  userIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  dateCriteria?: 'createdAt' | 'cancelledAt';
}

export interface AdminMemberListItem {
  contractId: string;
  userId: string;
  /** Computed: ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status: string;
  tierCode: string;
  tierPriority: number;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  autoRenewal: boolean;
  cancellationReasonCode: string | null;
  recurringCancellationReasonCode: string | null;
}

export interface AdminMembersResponse {
  data: AdminMemberListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminMemberDetail {
  contractId: string;
  userId: string;
  status: string;
  tierCode: string;
  tierPriority: number;
  planId: string;
  planDurationDays: number;
  billingDate: string;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
  createdAt: string;
  cancelledAt: string | null;
  autoRenewal: boolean;
  pauseCount: number;
  firstContractCreatedAt: string;
}

export interface BillingEventItem {
  id: string;
  contractId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ContractEventItem {
  id: number;
  contractId: string;
  eventType: string;
  userId: string;
  causedBy: string;
  causedByUserId: string | null;
  createdAt: string;
}

export interface AdminTier {
  id: string;
  code: string;
  priorityLevel: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPlan {
  id: string;
  tierId: string;
  price: number;
  durationDays: number;
  currency: string;
  trialDays: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTierWithPlans {
  tier: AdminTier;
  plans: AdminPlan[];
}

export interface AdminBillingHistoryQuery {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  contractId?: string;
  userId?: string;
  eventType?: string;
}

export interface AdminBillingHistoryItem {
  id: string;
  contractId: string;
  userId: string;
  eventType: string;
  attemptNo: number | null;
  amount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AdminBillingHistoryResponse {
  data: AdminBillingHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((v) => params.append(key, String(v)));
    } else {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const membershipApi = {
  getAdminMembers: async (
    query: AdminMembersQuery
  ): Promise<AdminMembersResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getMemberDetail: async (userId: string): Promise<AdminMemberDetail> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  getMemberBillingEvents: async (
    userId: string
  ): Promise<BillingEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-events?userId=${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  getMemberContractEvents: async (
    userId: string
  ): Promise<ContractEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contract-events?userId=${encodeURIComponent(userId)}`
    );
    return res.data;
  },

  setAutoRenewal: async (
    contractId: string,
    autoRenewal: boolean
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contracts/${encodeURIComponent(contractId)}/auto-renewal`,
      { autoRenewal }
    );
  },

  adjustEntitlement: async (
    userId: string,
    days: number,
    reason: string
  ): Promise<void> => {
    await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/entitlements/adjust`,
      {
        userId,
        days,
        reason,
      }
    );
  },

  getAllTiersWithPlans: async (): Promise<AdminTierWithPlans[]> => {
    const res = await client.get(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers`);
    return res.data;
  },

  createTier: async (body: {
    code: string;
    priorityLevel: number;
  }): Promise<void> => {
    await client.post(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers`, body);
  },

  updateTier: async (
    tierId: string,
    body: { priorityLevel?: number }
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/tiers/${encodeURIComponent(tierId)}`,
      body
    );
  },

  createPlan: async (body: {
    tierId: string;
    price: number;
    durationDays: number;
    currency?: string;
    trialDays?: number;
  }): Promise<void> => {
    await client.post(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans`, body);
  },

  updatePlan: async (
    planId: string,
    body: {
      price?: number;
      durationDays?: number;
      trialDays?: number;
    }
  ): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}`,
      body
    );
  },

  deactivatePlan: async (planId: string, reason: string): Promise<void> => {
    await client.delete(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}`,
      {
        data: { reason },
      }
    );
  },

  getAllBillingHistory: async (
    query: AdminBillingHistoryQuery
  ): Promise<AdminBillingHistoryResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-history${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  forceCancelSubscription: async (
    contractId: string,
    body: {
      reason: string;
      refundType: 'FULL' | 'PARTIAL' | 'NONE';
      refundAmount?: number;
      adminNote?: string;
    }
  ): Promise<{
    refundStatus: 'COMPLETED' | 'FAILED' | 'PENDING' | 'NOT_APPLICABLE';
  }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/subscriptions/${encodeURIComponent(contractId)}/force-cancel`,
      body
    );
    return res.data;
  },

  activatePlan: async (planId: string): Promise<void> => {
    await client.patch(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/plans/${encodeURIComponent(planId)}/activate`
    );
  },

  adminSubscribeUser: async (body: {
    userId: string;
    planId: string;
    billingMode: 'one_time' | 'recurring';
  }): Promise<{ contractId: string; entitlementId: string }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/subscribe`,
      body
    );
    return res.data;
  },

  retryBilling: async (contractId: string): Promise<void> => {
    await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing/retry/${encodeURIComponent(contractId)}`
    );
  },

  grantSubscriptionByDays: async (
    userId: string,
    days: number,
    memo?: string
  ): Promise<void> => {
    await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/${encodeURIComponent(userId)}/grant`,
      {
        days,
        memo,
      }
    );
  },

  getRecurringContractsByIds: async (
    contractIds: string[]
  ): Promise<AdminRecurringContractSummary[]> => {
    if (!contractIds.length) return [];
    const params = new URLSearchParams();
    contractIds.forEach((id) => params.append('contractId', id));
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/recurring-contracts/by-ids?${params.toString()}`
    );
    return res.data;
  },

  getRecurringContracts: async (query: {
    page?: number;
    limit?: number;
    userId?: string;
    contractId?: string;
    status?: string;
    dateType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<
    import('@/lib/types/dto/membership').AdminRecurringContractsResponse
  > => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.userId) params.set('userId', query.userId);
    if (query.contractId) params.set('contractId', query.contractId);
    if (query.status) params.set('status', query.status);
    if (query.dateType) params.set('dateType', query.dateType);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    const qs = params.toString();
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/recurring-contracts${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getStuckBillingContracts: async (
    thresholdHours = 48
  ): Promise<
    import('@/lib/types/dto/membership').StuckBillingContractsResponse
  > => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/stuck-billing-contracts?thresholdHours=${thresholdHours}`
    );
    return res.data;
  },

  resetBillingInProgress: async (
    contractId: string,
    reason: string
  ): Promise<{ contractId: string; reset: boolean }> => {
    const res = await client.post(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contracts/${encodeURIComponent(contractId)}/reset-billing-progress`,
      { reason }
    );
    return res.data;
  },
};
