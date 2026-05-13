// src/lib/api/domains/products/channel-products.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { PaginationQuery, UUID } from '../../../types/dto/common';
import type {
  ChannelProductDto,
  CreateChannelProductDto,
  MergedChannelProductDto,
  UpdateChannelProductDto,
  UpdateChannelProductNameDto,
  UpdateChannelProductStatusDto,
} from '../../../types/dto/products';
import { client } from '../../client';

function buildQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export const channelProductsClient = {
  create: async (dto: CreateChannelProductDto): Promise<ChannelProductDto> => {
    const response = await client.post(`${ALMONDYOUNG_API_BASE_URL}/channel-products`, dto);
    return response.data;
  },

  getByMaster: async (masterId: UUID): Promise<ChannelProductDto[]> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channel-products/masters/${masterId}`
    );
    return response.data;
  },

  getByChannel: async (
    channelId: UUID,
    q?: PaginationQuery
  ): Promise<{
    data: ChannelProductDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channel-products/channels/${channelId}?${buildQueryString(
        (q || {}) as Record<string, unknown>
      )}`
    );
    return response.data;
  },

  get: async (id: UUID): Promise<ChannelProductDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/channel-products/${id}`);
    return response.data;
  },

  update: async (
    id: UUID,
    data: UpdateChannelProductDto
  ): Promise<ChannelProductDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/channel-products/${id}`,
      data
    );
    return response.data;
  },

  delete: async (id: UUID): Promise<void> => {
    await client.delete(`${ALMONDYOUNG_API_BASE_URL}/channel-products/${id}`);
  },

  getMerged: async (
    masterId: UUID,
    channelId: UUID
  ): Promise<MergedChannelProductDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/channel-products/masters/${masterId}/channels/${channelId}/merged`
    );
    return response.data;
  },

  updateName: async (id: UUID, data: UpdateChannelProductNameDto): Promise<void> => {
    await client.put(`${ALMONDYOUNG_API_BASE_URL}/channel-products/${id}/name`, data);
  },

  updateStatus: async (
    id: UUID,
    data: UpdateChannelProductStatusDto
  ): Promise<void> => {
    await client.put(`${ALMONDYOUNG_API_BASE_URL}/channel-products/${id}/status`, data);
  },
};
