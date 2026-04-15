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
};
