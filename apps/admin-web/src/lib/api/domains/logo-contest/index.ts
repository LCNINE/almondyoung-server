'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import {
  AdminLogoContestEntryDto,
  AdminLogoContestEntryListQuery,
  AdminLogoContestEntryListResponse,
  LogoContestStatusDto,
  UpdateLogoContestEntryStatusDto,
} from '@/lib/types/dto/logo-contest';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

function buildQueryString(query: AdminLogoContestEntryListQuery): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const logoContestApi = {
  getEntries: async (
    query: AdminLogoContestEntryListQuery
  ): Promise<AdminLogoContestEntryListResponse> => {
    const qs = buildQueryString(query);
    const response: AxiosResponse<AdminLogoContestEntryListResponse> =
      await client.get(
        `${UGC_SERVICE_BASE_URL}/logo-contest/admin/entries${qs ? `?${qs}` : ''}`
      );
    return response.data;
  },

  updateEntryStatus: async (
    id: string,
    dto: UpdateLogoContestEntryStatusDto
  ): Promise<AdminLogoContestEntryDto> => {
    const response: AxiosResponse<AdminLogoContestEntryDto> = await client.patch(
      `${UGC_SERVICE_BASE_URL}/logo-contest/admin/entries/${id}/status`,
      dto
    );
    return response.data;
  },

  designateWinner: async (id: string): Promise<AdminLogoContestEntryDto> => {
    const response: AxiosResponse<AdminLogoContestEntryDto> = await client.post(
      `${UGC_SERVICE_BASE_URL}/logo-contest/admin/entries/${id}/winner`
    );
    return response.data;
  },

  getContestStatus: async (): Promise<LogoContestStatusDto> => {
    const response: AxiosResponse<LogoContestStatusDto> = await client.get(
      `${UGC_SERVICE_BASE_URL}/logo-contest/status`
    );
    return response.data;
  },
};
