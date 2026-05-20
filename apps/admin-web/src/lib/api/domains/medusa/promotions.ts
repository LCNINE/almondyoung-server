'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface PromotionRule {
  attribute: string;
  operator: string;
  values: string[];
}

export interface PromotionTargetRule {
  attribute: 'product_id' | 'product_category_id' | 'product_collection_id' | 'product_type_id';
  operator: 'in';
  values: string[];
}

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
    budget?: {
      type: string;
      limit: number | null;
      used: number;
    } | null;
  } | null;
  application_method?: {
    id: string;
    type: 'percentage' | 'fixed';
    value: number;
    target_type: 'order' | 'items';
    currency_code: string | null;
    max_quantity: number | null;
    target_rules?: PromotionTargetRule[];
  } | null;
  rules?: PromotionRule[];
  metadata?: Record<string, unknown> | null;
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
    target_type: 'order' | 'items';
    currency_code?: string;
    target_rules?: PromotionTargetRule[];
  };
  campaign?: {
    campaign_identifier: string;
    starts_at?: string;
    ends_at?: string;
    budget?: { type: 'usage'; limit: number };
  };
  rules?: PromotionRule[];
  metadata?: Record<string, unknown>;
}

export interface CouponCustomer {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

export interface CouponCustomersResponse {
  promotion_id: string;
  customers: CouponCustomer[];
  count: number;
  offset: number;
  limit: number;
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

  get: async (id: string) => {
    const res = await client.get<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions/${id}`
    );
    return res.data.promotion;
  },

  create: async (payload: CreatePromotionPayload) => {
    const res = await client.post<{ promotion: MedusaPromotion }>(
      `${MEDUSA_BASE_URL}/admin/promotions`,
      payload
    );
    return res.data.promotion;
  },

  // Medusa V2: POST /admin/promotions/:id (not PATCH)
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

  getCustomers: async (promotionId: string, params: { limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    const qs = p.toString();
    const res = await client.get<CouponCustomersResponse>(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },

  revokeFromCustomer: async (promotionId: string, customerIds: string[]) => {
    await client.delete(
      `${MEDUSA_BASE_URL}/admin/promotions/${promotionId}/customers`,
      { data: { customer_ids: customerIds } }
    );
  },
};
