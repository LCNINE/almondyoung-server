import { MEMBERSHIP_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';

export interface AdminMembersQuery {
  page?: number;
  limit?: number;
  /** ACTIVE | PAUSED | CANCELLED | EXPIRED */
  status?: string;
  /** userId partial search */
  q?: string;
  dateFrom?: string;
  dateTo?: string;
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

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const membershipApi = {
  getAdminMembers: async (query: AdminMembersQuery): Promise<AdminMembersResponse> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members${qs ? `?${qs}` : ''}`,
    );
    return res.data;
  },

  getMemberDetail: async (userId: string): Promise<AdminMemberDetail> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/members/${encodeURIComponent(userId)}`,
    );
    return res.data.data;
  },

  getMemberBillingEvents: async (contractId: string): Promise<BillingEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/billing-events?contractId=${encodeURIComponent(contractId)}`,
    );
    return res.data.data;
  },

  getMemberContractEvents: async (contractId: string): Promise<ContractEventItem[]> => {
    const res = await client.get(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contract-events?contractId=${encodeURIComponent(contractId)}`,
    );
    return res.data.data;
  },

  setAutoRenewal: async (contractId: string, autoRenewal: boolean): Promise<void> => {
    await client.put(
      `${MEMBERSHIP_SERVICE_BASE_URL}/admin/contracts/${encodeURIComponent(contractId)}/auto-renewal`,
      { autoRenewal },
    );
  },

  adjustEntitlement: async (userId: string, days: number, reason: string): Promise<void> => {
    await client.post(`${MEMBERSHIP_SERVICE_BASE_URL}/admin/entitlements/adjust`, {
      userId,
      days,
      reason,
    });
  },
};
