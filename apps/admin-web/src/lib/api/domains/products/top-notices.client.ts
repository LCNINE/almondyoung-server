'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateTopNoticeDto,
  TopNoticeDto,
  TopNoticeListQuery,
  UpdateTopNoticeDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/top-notices`;

export const topNoticesClient = {
  list: async (query?: TopNoticeListQuery): Promise<TopNoticeDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  create: async (dto: CreateTopNoticeDto): Promise<TopNoticeDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateTopNoticeDto): Promise<TopNoticeDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const response = await client.delete(`${BASE}/${id}`);
    return response.data;
  },
};
