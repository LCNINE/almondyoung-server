'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

export interface ReturnRequestItem {
  id: string;
  returnRequestId: string;
  salesOrderLineId: string;
  quantity: number;
  reasonCode: string | null;
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  salesOrderId: string;
  customerId: string | null;
  status: 'requested' | 'approved' | 'rejected' | 'collection_pending' | 'collected' | 'inspected' | 'refund_pending' | 'completed' | 'cancelled';
  reasonCode: string;
  reasonDetail: string | null;
  adminNote: string | null;
  decidedAt: string | null;
  collectedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnRequestWithItems {
  request: ReturnRequest;
  items: ReturnRequestItem[];
}

export interface ExchangeRequestItem {
  id: string;
  exchangeRequestId: string;
  salesOrderLineId: string;
  quantity: number;
  desiredVariantId: string | null;
  createdAt: string;
}

export interface ExchangeRequest {
  id: string;
  salesOrderId: string;
  customerId: string | null;
  status: 'requested' | 'approved' | 'rejected' | 'collection_pending' | 'collected' | 'inspected' | 'refund_pending' | 'completed' | 'cancelled';
  reasonCode: string;
  reasonDetail: string | null;
  adminNote: string | null;
  decidedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeRequestWithItems {
  request: ExchangeRequest;
  items: ExchangeRequestItem[];
}

export interface ReturnRequestListResponse {
  items: ReturnRequestWithItems[];
  total: number;
}

export interface ExchangeRequestListResponse {
  items: ExchangeRequestWithItems[];
  total: number;
}

export interface ReturnExchangeListQuery {
  salesOrderId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

function buildQs(params: ReturnExchangeListQuery): string {
  const sp = new URLSearchParams();
  const entries = params as Record<string, string | number | undefined>;
  for (const [k, v] of Object.entries(entries)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const returnExchangeApi = {
  // ── Return Requests ──────────────────────────────────────────────────────
  listReturnRequests: async (query: ReturnExchangeListQuery): Promise<ReturnRequestListResponse> => {
    const res = await client.get(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests${buildQs(query)}`);
    return res.data;
  },

  getReturnRequest: async (id: string): Promise<ReturnRequestWithItems> => {
    const res = await client.get(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}`);
    return res.data;
  },

  approveReturn: async (id: string, adminNote?: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/approve`, { adminNote });
    return res.data;
  },

  rejectReturn: async (id: string, adminNote?: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/reject`, { adminNote });
    return res.data;
  },

  markReturnCollectionPending: async (id: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/collection-pending`);
    return res.data;
  },

  markReturnCollected: async (id: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/collected`);
    return res.data;
  },

  markReturnInspected: async (id: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/inspected`);
    return res.data;
  },

  completeReturn: async (id: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/complete`);
    return res.data;
  },

  retryReturnRefund: async (id: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/retry-refund`);
    return res.data;
  },

  manualCompleteReturn: async (id: string, adminNote?: string): Promise<ReturnRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/return-requests/${id}/manual-complete`, { adminNote });
    return res.data;
  },

  // ── Exchange Requests ────────────────────────────────────────────────────
  listExchangeRequests: async (query: ReturnExchangeListQuery): Promise<ExchangeRequestListResponse> => {
    const res = await client.get(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests${buildQs(query)}`);
    return res.data;
  },

  getExchangeRequest: async (id: string): Promise<ExchangeRequestWithItems> => {
    const res = await client.get(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}`);
    return res.data;
  },

  approveExchange: async (id: string, adminNote?: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/approve`, { adminNote });
    return res.data;
  },

  rejectExchange: async (id: string, adminNote?: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/reject`, { adminNote });
    return res.data;
  },

  markExchangeCollectionPending: async (id: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/collection-pending`);
    return res.data;
  },

  markExchangeCollected: async (id: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/collected`);
    return res.data;
  },

  markExchangeInspected: async (id: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/inspected`);
    return res.data;
  },

  completeExchange: async (id: string): Promise<ExchangeRequest> => {
    const res = await client.post(`${ALMONDYOUNG_API_BASE_URL}/admin/exchange-requests/${id}/complete`);
    return res.data;
  },
};
