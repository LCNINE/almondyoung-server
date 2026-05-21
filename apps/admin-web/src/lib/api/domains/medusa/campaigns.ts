'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export interface MedusaCampaignBudget {
  type: 'usage' | 'spend';
  limit: number | null;
  used: number;
}

export interface MedusaCampaign {
  id: string;
  name: string;
  description: string | null;
  campaign_identifier: string;
  starts_at: string | null;
  ends_at: string | null;
  budget: MedusaCampaignBudget | null;
  promotions?: { id: string; code: string; status: string }[];
  created_at: string;
  updated_at: string;
}

export interface MedusaCampaignListResponse {
  campaigns: MedusaCampaign[];
  count: number;
  offset: number;
  limit: number;
}

export interface CreateCampaignPayload {
  name: string;
  campaign_identifier: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  budget?: { type: 'usage' | 'spend'; limit: number };
}

export interface UpdateCampaignPayload {
  name?: string;
  description?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  budget?: { type: 'usage' | 'spend'; limit: number } | null;
}

const CAMPAIGN_FIELDS = '*budget,*promotions';

export const medusaCampaignsApi = {
  list: async (params: { limit?: number; offset?: number; q?: string } = {}) => {
    const p = new URLSearchParams();
    if (params.limit !== undefined) p.append('limit', String(params.limit));
    if (params.offset !== undefined) p.append('offset', String(params.offset));
    if (params.q) p.append('q', params.q);
    p.append('fields', CAMPAIGN_FIELDS);
    const res = await client.get<MedusaCampaignListResponse>(
      `${MEDUSA_BASE_URL}/admin/campaigns?${p.toString()}`
    );
    return res.data;
  },

  get: async (id: string) => {
    const res = await client.get<{ campaign: MedusaCampaign }>(
      `${MEDUSA_BASE_URL}/admin/campaigns/${id}?fields=${CAMPAIGN_FIELDS},*promotions.id,*promotions.code,*promotions.status,*promotions.type`
    );
    return res.data.campaign;
  },

  create: async (payload: CreateCampaignPayload) => {
    const res = await client.post<{ campaign: MedusaCampaign }>(
      `${MEDUSA_BASE_URL}/admin/campaigns`,
      payload
    );
    return res.data.campaign;
  },

  update: async (id: string, payload: UpdateCampaignPayload) => {
    const res = await client.post<{ campaign: MedusaCampaign }>(
      `${MEDUSA_BASE_URL}/admin/campaigns/${id}`,
      payload
    );
    return res.data.campaign;
  },

  delete: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/campaigns/${id}`);
  },

  // 프로모션의 campaign_id를 변경해서 캠페인에 연결/해제
  linkPromotion: async (promotionId: string, campaignId: string) => {
    await client.post(`${MEDUSA_BASE_URL}/admin/promotions/${promotionId}`, {
      campaign_id: campaignId,
    });
  },

  unlinkPromotion: async (promotionId: string) => {
    await client.post(`${MEDUSA_BASE_URL}/admin/promotions/${promotionId}`, {
      campaign_id: null,
    });
  },
};
