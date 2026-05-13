'use client';

// src/lib/api/domains/products/banners.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  BannerDto,
  CreateBannerDto,
  UpdateBannerDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/banners`;

export const bannersClient = {
  listByGroup: async (bannerGroupId: string, includeInactive = true): Promise<BannerDto[]> => {
    const response = await client.get(`${BASE}/by-group/${bannerGroupId}`, {
      params: { includeInactive },
    });
    return response.data;
  },

  get: async (id: string): Promise<BannerDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (dto: CreateBannerDto): Promise<BannerDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateBannerDto): Promise<BannerDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string, deletedBy?: string): Promise<{ message: string }> => {
    const params = deletedBy ? { deletedBy } : {};
    const response = await client.delete(`${BASE}/${id}`, { params });
    return response.data;
  },
};
