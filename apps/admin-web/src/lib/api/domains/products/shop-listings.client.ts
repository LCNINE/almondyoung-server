'use client';

// src/lib/api/domains/products/shop-listings.client.ts
// 샵 매매는 2026-09 ugc-service 로 옮겼다(spec 2026-09-23-shop-listings-to-ugc-design §7.4).
import { UGC_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminShopListingDetailDto,
  AdminShopListingDto,
  AdminShopListingListQuery,
  AdminShopListingPayload,
} from '../../../types/dto/products';

const BASE = `${UGC_SERVICE_BASE_URL}/admin/shop-listings`;

const post = async (path: string, body?: object): Promise<AdminShopListingDto> => {
  const response = await client.post(`${BASE}${path}`, body ?? {});
  return response.data;
};

export const shopListingsClient = {
  list: async (query: AdminShopListingListQuery): Promise<AdminShopListingDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<AdminShopListingDetailDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (payload: AdminShopListingPayload): Promise<AdminShopListingDto> => {
    const response = await client.post(BASE, payload);
    return response.data;
  },

  /** 전체 교체 — payload 는 buildAdminPayload 가 만든 것만 넘긴다 */
  update: async (id: string, payload: AdminShopListingPayload): Promise<AdminShopListingDto> => {
    const response = await client.put(`${BASE}/${id}`, payload);
    return response.data;
  },

  approve: (id: string, expectedSubmittedAt: string | null) =>
    post(`/${id}/approve`, expectedSubmittedAt ? { expectedSubmittedAt } : {}),

  reject: (id: string, reason: string, expectedSubmittedAt: string | null) =>
    post(`/${id}/reject`, expectedSubmittedAt ? { reason, expectedSubmittedAt } : { reason }),

  hide: (id: string) => post(`/${id}/hide`),
  unhide: (id: string) => post(`/${id}/unhide`),
  close: (id: string) => post(`/${id}/close`),
  reopen: (id: string) => post(`/${id}/reopen`),

  remove: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${id}`);
  },
};
