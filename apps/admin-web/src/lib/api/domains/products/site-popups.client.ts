'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  CreateSitePopupDto,
  SitePopupDto,
  SitePopupListQuery,
  UpdateSitePopupDto,
} from '../../../types/dto/products';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/site-popups`;

export const sitePopupsClient = {
  list: async (query?: SitePopupListQuery): Promise<SitePopupDto[]> => {
    const response = await client.get(BASE, { params: query });
    return response.data;
  },

  get: async (id: string): Promise<SitePopupDto> => {
    const response = await client.get(`${BASE}/${id}`);
    return response.data;
  },

  create: async (dto: CreateSitePopupDto): Promise<SitePopupDto> => {
    const response = await client.post(BASE, dto);
    return response.data;
  },

  update: async (id: string, dto: UpdateSitePopupDto): Promise<SitePopupDto> => {
    const response = await client.put(`${BASE}/${id}`, dto);
    return response.data;
  },

  /** "다시 보지 않기" 를 누른 방문자에게도 다시 노출 */
  resetDismissals: async (id: string): Promise<SitePopupDto> => {
    const response = await client.post(`${BASE}/${id}/reset-dismissals`);
    return response.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const response = await client.delete(`${BASE}/${id}`);
    return response.data;
  },
};
