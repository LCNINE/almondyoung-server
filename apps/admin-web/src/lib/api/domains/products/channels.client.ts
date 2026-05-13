// src/lib/api/domains/products/channels.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { UUID } from '../../../types/dto/common';

import { client } from '../../client';
import type {
  ChannelDto,
  ChannelsQuery,
  ChannelsResponseDto,
  ChannelValidationResponseDto,
  CreateChannelDto,
  UpdateChannelDto,
  UpdateChannelStatusDto,
  ValidateChannelConfigDto,
} from '@/lib/types';

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const channelsClient = {
  create: async (dto: CreateChannelDto): Promise<ChannelDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/channels`, dto);
    return response.data;
  },

  getList: async (query: ChannelsQuery = {}): Promise<ChannelsResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channels?${buildQueryString(
        query as Record<string, unknown>
      )}`
    );
    return response.data;
  },

  getActive: async (): Promise<ChannelDto[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/channels/active`);
    // API가 paginated 응답 { data: [] } 형태로 반환
    return Array.isArray(response.data) ? response.data : (response.data?.data ?? []);
  },

  get: async (id: UUID): Promise<ChannelDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/channels/${id}`);
    return response.data;
  },

  update: async (id: UUID, dto: UpdateChannelDto): Promise<ChannelDto> => {
    const response = await client.put(`${ALMONDYOUNG_API_BASE_URL}/channels/${id}`, dto);
    return response.data;
  },

  delete: async (id: UUID): Promise<void> => {
    await client.delete(`${ALMONDYOUNG_API_BASE_URL}/channels/${id}`);
  },

  updateStatus: async (id: UUID, data: UpdateChannelStatusDto): Promise<ChannelDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/channels/${id}/status`,
      data
    );
    return response.data;
  },

  getByType: async (type: string): Promise<ChannelDto[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/channels/type/${type}`);
    return response.data;
  },

  validateConfig: async (
    dto: ValidateChannelConfigDto
  ): Promise<ChannelValidationResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/channels/validate`,
      dto
    );
    return response.data;
  },
};
