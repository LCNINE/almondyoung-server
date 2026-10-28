'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import type {
  PurchaseSatisfactionDto,
  PurchaseSatisfactionListQuery,
  PurchaseSatisfactionListResponse,
} from '@/lib/types/dto/purchase-satisfaction';
import { client } from '../../client';

const BASE = `${UGC_SERVICE_BASE_URL}/purchase-satisfactions/admin`;

function buildQueryString(query: PurchaseSatisfactionListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.append(key, String(value));
  });
  return params.toString();
}

export const purchaseSatisfactionApi = {
  list: async (query: PurchaseSatisfactionListQuery): Promise<PurchaseSatisfactionListResponse> => {
    const qs = buildQueryString(query);
    const res = await client.get<PurchaseSatisfactionListResponse>(`${BASE}${qs ? `?${qs}` : ''}`);
    return res.data;
  },

  getByOrder: async (orderId: string): Promise<PurchaseSatisfactionDto | null> => {
    const res = await client.get<PurchaseSatisfactionDto>(`${BASE}/orders/${encodeURIComponent(orderId)}`, {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });
    return res.status === 404 ? null : res.data;
  },

  setChecked: async (id: string, checked: boolean): Promise<PurchaseSatisfactionDto> => {
    const res = await client.patch<PurchaseSatisfactionDto>(`${BASE}/${encodeURIComponent(id)}/check`, { checked });
    return res.data;
  },
};
