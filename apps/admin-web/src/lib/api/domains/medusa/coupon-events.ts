'use client';

import { MEDUSA_BASE_URL } from '@/const';
import { client } from '../../client';

export type CouponEventStatus = 'draft' | 'active' | 'ended';

export interface CouponEvent {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  banner_image_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: CouponEventStatus;
  item_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CouponEventItem {
  promotion_id: string;
  sort_order: number;
  promotion: {
    id: string;
    code: string;
    status: string;
    application_method?: { type: 'percentage' | 'fixed'; value: number } | null;
  } | null;
}

export interface CouponEventDetail {
  event: CouponEvent;
  items: CouponEventItem[];
}

export interface CouponEventPayload {
  title?: string;
  description?: string | null;
  banner_image_url?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: CouponEventStatus;
  promotion_ids?: string[];
}

export const couponEventsApi = {
  list: async () => {
    const res = await client.get<{ events: CouponEvent[]; count: number }>(
      `${MEDUSA_BASE_URL}/admin/coupon-events`
    );
    return res.data;
  },

  get: async (id: string) => {
    const res = await client.get<CouponEventDetail>(
      `${MEDUSA_BASE_URL}/admin/coupon-events/${id}`
    );
    return res.data;
  },

  create: async (payload: CouponEventPayload) => {
    const res = await client.post<{ event: CouponEvent }>(
      `${MEDUSA_BASE_URL}/admin/coupon-events`,
      payload
    );
    return res.data.event;
  },

  update: async (id: string, payload: CouponEventPayload) => {
    const res = await client.post<{ event: CouponEvent }>(
      `${MEDUSA_BASE_URL}/admin/coupon-events/${id}`,
      payload
    );
    return res.data.event;
  },

  delete: async (id: string) => {
    await client.delete(`${MEDUSA_BASE_URL}/admin/coupon-events/${id}`);
  },
};
