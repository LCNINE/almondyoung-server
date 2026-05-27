'use client';

import { WALLET_SERVICE_BASE_URL } from '@/const';
import {
  PaymentIntentListItem,
  PaymentIntentDetail,
  PaymentIntentListQuery,
  RefundDto,
  RefundListQuery,
  StateTransitionDto,
  PendingBankTransferDto,
  PointsBalanceDto,
  PointsEventDto,
  PointsStatsDto,
  BatchEarnResultDto,
  TopPointUserDto,
  PaginatedResponse,
  AdminRecurringBillingOverview,
  AdminRecurringBillingRow,
  AdminRecurringBillingListQuery,
} from '@/lib/types/dto/wallet';
import { client } from '../../client';

const BASE = WALLET_SERVICE_BASE_URL;

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const walletApi = {
  // ── Payment Intents ──────────────────────────────────────────────────────

  listPaymentIntents: async (
    query: PaymentIntentListQuery
  ): Promise<PaginatedResponse<PaymentIntentListItem>> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${BASE}/v1/admin/payment-intents${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  getPaymentIntentDetail: async (id: string): Promise<PaymentIntentDetail> => {
    const res = await client.get(`${BASE}/v1/admin/payment-intents/${id}`);
    return res.data;
  },

  getStateTransitions: async (id: string): Promise<StateTransitionDto[]> => {
    const res = await client.get(
      `${BASE}/v1/admin/payment-intents/${id}/state-transitions`
    );
    return res.data;
  },

  captureIntent: async (id: string): Promise<void> => {
    await client.post(`${BASE}/v1/admin/payment-intents/${id}/capture`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  cancelIntent: async (id: string): Promise<void> => {
    await client.post(`${BASE}/v1/admin/payment-intents/${id}/cancel`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  refundIntent: async (
    id: string,
    dto: {
      chargeId: string;
      amount: number;
      reasonCode?: string;
      reasonMessage?: string;
    }
  ): Promise<void> => {
    await client.post(`${BASE}/v1/admin/payment-intents/${id}/refund`, dto, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  // ── Refunds ──────────────────────────────────────────────────────────────

  listRefunds: async (
    query: RefundListQuery
  ): Promise<PaginatedResponse<RefundDto>> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(
      `${BASE}/v1/admin/refunds${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  // ── Bank Transfers ───────────────────────────────────────────────────────

  listPendingBankTransfers: async (
    page?: number,
    limit?: number
  ): Promise<PaginatedResponse<PendingBankTransferDto>> => {
    const qs = buildQueryString({ page, limit });
    const res = await client.get(
      `${BASE}/v1/admin/payment-intents/pending-bank-transfers${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  confirmBankTransfer: async (
    id: string,
    depositorNote?: string
  ): Promise<void> => {
    await client.post(
      `${BASE}/v1/admin/payment-intents/${id}/bank-transfer-confirm`,
      { depositorNote },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
  },

  // ── Points ───────────────────────────────────────────────────────────────

  getPointsStats: async (params?: { dateFrom?: string; dateTo?: string }): Promise<PointsStatsDto> => {
    const res = await client.get(`${BASE}/v1/admin/points/stats`, { params });
    return res.data;
  },

  getAllPointsEvents: async (params: {
    page?: number;
    limit?: number;
    userId?: string;
    eventType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PaginatedResponse<PointsEventDto>> => {
    const res = await client.get(`${BASE}/v1/admin/points/events/all`, { params });
    return res.data;
  },

  batchEarnPoints: async (
    userIds: string[],
    amount: number,
    reasonCode?: string,
    expiresAt?: string
  ): Promise<BatchEarnResultDto> => {
    const res = await client.post(`${BASE}/v1/admin/points/earn/batch`, { userIds, amount, reasonCode, expiresAt }, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    return res.data;
  },

  getTopPointUsers: async (limit?: number): Promise<TopPointUserDto[]> => {
    const res = await client.get(`${BASE}/v1/admin/points/users/top`, { params: { limit } });
    return res.data;
  },

  processExpiredPoints: async (): Promise<{ processed: number; cancelled: number }> => {
    const res = await client.post(`${BASE}/v1/admin/points/expire`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    return res.data;
  },

  getPointsBalance: async (userId: string): Promise<PointsBalanceDto> => {
    const res = await client.get(`${BASE}/v1/admin/points/balance`, { params: { user_id: userId } });
    return res.data;
  },

  getPointsEvents: async (
    userId: string,
    page?: number,
    limit?: number
  ): Promise<PaginatedResponse<PointsEventDto>> => {
    const qs = buildQueryString({ userId, page, limit });
    const res = await client.get(
      `${BASE}/v1/admin/points/events${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  earnPoints: async (
    userId: string,
    amount: number,
    reasonCode?: string,
    expiresAt?: string
  ): Promise<void> => {
    await client.post(`${BASE}/v1/admin/points/earn`, { userId, amount, reasonCode, expiresAt }, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  deductPoints: async (
    userId: string,
    amount: number,
    reasonCode?: string
  ): Promise<void> => {
    await client.post(`${BASE}/v1/admin/points/deduct`, { userId, amount, reasonCode }, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  cancelEarnPoints: async (
    userId: string,
    earnEventId: string,
    amount?: number,
    reasonCode?: string
  ): Promise<void> => {
    await client.post(`${BASE}/v1/admin/points/earn-cancel`, {
      userId,
      earnEventId,
      ...(amount !== undefined && { amount }),
      ...(reasonCode && { reasonCode }),
    }, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  },

  // ── Recurring Billing Admin ──────────────────────────────────────────────────

  getRecurringBillingOverview: async (): Promise<AdminRecurringBillingOverview> => {
    const res = await client.get(`${BASE}/v1/admin/recurring-billing/overview`);
    return res.data;
  },

  listRecurringBillingItems: async (query: AdminRecurringBillingListQuery): Promise<PaginatedResponse<AdminRecurringBillingRow>> => {
    const qs = buildQueryString(query as Record<string, unknown>);
    const res = await client.get(`${BASE}/v1/admin/recurring-billing/items${qs ? `?${qs}` : ''}`);
    return res.data;
  },

  pollCmsMember: async (id: string): Promise<AdminRecurringBillingRow> => {
    const res = await client.post(`${BASE}/v1/admin/recurring-billing/providers/cms/members/${id}/poll`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    return res.data;
  },

  pollCmsWithdrawal: async (id: string): Promise<AdminRecurringBillingRow> => {
    const res = await client.post(`${BASE}/v1/admin/recurring-billing/providers/cms/withdrawals/${id}/poll`, undefined, {
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    return res.data;
  },

  getAgreementStateByRefs: async (refs: string[]): Promise<Record<string, import('@/lib/types/dto/membership').AgreementStateEntry | null>> => {
    if (!refs.length) return {};
    const params = new URLSearchParams();
    refs.forEach((r) => params.append('refs', r));
    const res = await client.get(`${BASE}/v1/admin/recurring-billing/agreement-state-by-refs?${params.toString()}`);
    return res.data;
  },
};
