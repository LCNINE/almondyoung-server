'use client';

// src/lib/api/domains/products/notices.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateNoticeDto,
  NoticeDto,
  NoticeListQuery,
  UpdateNoticeDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/notices`;

export const noticesClient = {
  list: async (query?: NoticeListQuery): Promise<NoticeDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  listPublic: async (category?: string): Promise<NoticeDto[]> => {
    const response = await client.get(`${BASE}/public`, { params: category ? { category } : {} });
    return response.data;
  },

  get: async (id: string): Promise<NoticeDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (dto: CreateNoticeDto): Promise<NoticeDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateNoticeDto): Promise<NoticeDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string, deletedBy?: string): Promise<{ message: string }> => {
    const params = deletedBy ? { deletedBy } : {};
    const response = await client.delete(`${BASE}/${id}`, { params });
    return response.data;
  },
};
