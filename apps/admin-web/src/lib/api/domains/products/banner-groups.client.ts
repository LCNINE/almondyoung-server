// src/lib/api/domains/products/banner-groups.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  BannerGroupDto,
  BannerGroupListQuery,
  BannerGroupWithBannersDto,
  CreateBannerGroupDto,
  UpdateBannerGroupDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/banner-groups`;

export const bannerGroupsClient = {
  list: async (query?: BannerGroupListQuery): Promise<BannerGroupDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<BannerGroupDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  getByCode: async (code: string): Promise<BannerGroupWithBannersDto> => {
    const response = await client.get(`${BASE}/by-code/${code}`);
    return response.data;
  },

  create: async (dto: CreateBannerGroupDto): Promise<BannerGroupDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateBannerGroupDto): Promise<BannerGroupDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string, deletedBy?: string): Promise<{ message: string }> => {
    const params = deletedBy ? { deletedBy } : {};
    const response = await client.delete(`${BASE}/${id}`, { params });
    return response.data;
  },
};
