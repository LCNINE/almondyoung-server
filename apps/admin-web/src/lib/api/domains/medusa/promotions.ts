'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface MedusaPromotion {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  campaign_id: string | null;
  campaign?: {
    campaign_identifier: string;
    starts_at: string | null;
    ends_at: string | null;
  } | null;
  application_method?: {
    id: string;
    type: 'percentage' | 'fixed';
    value: number;
    target_type: string;
    currency_code: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface MedusaPromotionListResponse {
  promotions: MedusaPromotion[];
  count: number;
  offset: number;
  limit: number;
}

export interface CreatePromotionPayload {
  code: string;
  type: 'standard';
  is_automatic: false;
  application_method: {
    type: 'percentage' | 'fixed';
    value: number;
    target_type: 'order';
    currency_code?: string;
  };
  campaign?: {
    campaign_identifier: string;
    starts_at?: string;
    ends_at?: string;
    budget?: { type: 'usage'; limit: number };
  };
}

export const medusaPromotionsApi = {
  list: async (params: { limit?: number; offset?: number; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    if (params.q) p.append('q', params.q);
    const qs = p.toString();
    const res = await client.get<MedusaPromotionListResponse>(
      `${MEDUSA_BASE_URL}/admin/promotions${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  create: async (payload: CreatePromotionPayload) => {
    const res = await client.post<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions`,
      payload
    );
    return res.data.promotion;
  },

  updateStatus: async (id: string, status: 'active' | 'inactive') => {
    const res = await client.post<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions/${id}`,
      { status }
    );
    return res.data.promotion;
  },

  delete: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/promotions/${id}`);
  },

  assignToCustomer: async (medusaCustomerId: string, promotionIds: string[]) => {
    await client.post(
      `${MEDUSA_BASE_URL}/admin/customers/${medusaCustomerId}/promotions`,
      { promotion_ids: promotionIds }
    );
  },
};
