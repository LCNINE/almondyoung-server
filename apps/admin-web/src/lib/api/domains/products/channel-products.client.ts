// src/lib/api/domains/products/channel-products.client.ts
import { PIM_BASE_URL } from '@/const';
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

function buildQueryString(query: Record<string, any>): string {
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
    const response = await client.post(`${PIM_BASE_URL}/channel-products`, dto);
    return response.data;
  },

  byMaster: async (masterId: UUID): Promise<ChannelProductDto[]> => {
    const response = await client.get(
      `${PIM_BASE_URL}/channel-products/masters/${masterId}`
    );
    return response.data;
  },

  byChannel: async (
    channelId: UUID,
    q?: PaginationQuery
  ): Promise<{
    data: ChannelProductDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${PIM_BASE_URL}/channel-products/channels/${channelId}?${buildQueryString(q || {})}`
    );
    return response.data;
  },

  get: async (id: UUID): Promise<ChannelProductDto> => {
    const response = await client.get(`${PIM_BASE_URL}/channel-products/${id}`);
    return response.data;
  },

  update: async (
    id: UUID,
    dto: Partial<ChannelProductDto>
  ): Promise<ChannelProductDto> => {
    const response = await client.put(
      `${PIM_BASE_URL}/channel-products/${id}`,
      dto
    );
    return response.data;
  },

  remove: async (id: UUID): Promise<void> => {
    await client.delete(`${PIM_BASE_URL}/channel-products/${id}`);
  },

  merged: async (
    masterId: UUID,
    channelId: UUID
  ): Promise<MergedChannelProductDto> => {
    const response = await client.get(
      `${PIM_BASE_URL}/channel-products/masters/${masterId}/channels/${channelId}/merged`
    );
    return response.data;
  },

  overrideName: async (id: UUID, name: string): Promise<void> => {
    await client.put(`${PIM_BASE_URL}/channel-products/${id}/name`, { name });
  },

  setActive: async (id: UUID, isActive: boolean): Promise<void> => {
    await client.put(`${PIM_BASE_URL}/channel-products/${id}/status`, {
      isActive,
    });
  },
};

/**
 * 마스터별 채널 제품 조회
 * GET /channel-products/masters/{masterId}
 */
export const getChannelProductsByMaster = async (
  masterId: string
): Promise<ChannelProductDto[]> => {
  const response = await client.get(
    `${PIM_BASE_URL}/channel-products/masters/${masterId}`
  );
  return response.data;
};

/**
 * 채널별 제품 조회
 * GET /channel-products/channels/{channelId}
 */
export const getChannelProductsByChannel = async (
  channelId: UUID,
  q?: PaginationQuery
): Promise<{
  data: ChannelProductDto[];
  total: number;
  page: number;
  limit: number;
}> => {
  const response = await client.get(
    `${PIM_BASE_URL}/channel-products/channels/${channelId}?${buildQueryString(
      q || {}
    )}`
  );
  return response.data;
};

/**
 * 채널 제품 상세 조회
 * GET /channel-products/{id}
 */
export const getChannelProduct = async (
  id: string
): Promise<ChannelProductDto> => {
  const response = await client.get(`${PIM_BASE_URL}/channel-products/${id}`);
  return response.data;
};

/**
 * 채널 제품 수정
 * PUT /channel-products/{id}
 */
export const updateChannelProduct = async (
  id: string,
  data: UpdateChannelProductDto
): Promise<ChannelProductDto> => {
  const response = await client.put(
    `${PIM_BASE_URL}/channel-products/${id}`,
    data
  );
  return response.data;
};

/**
 * 채널 제품 삭제
 * DELETE /channel-products/{id}
 */
export const deleteChannelProduct = async (id: string): Promise<void> => {
  await client.delete(`${PIM_BASE_URL}/channel-products/${id}`);
};

/**
 * 병합된 채널 제품 조회
 * GET /channel-products/masters/{masterId}/channels/{channelId}/merged
 */
export const getMergedChannelProduct = async (
  masterId: string,
  channelId: string
): Promise<MergedChannelProductDto> => {
  const response = await client.get(
    `${PIM_BASE_URL}/channel-products/masters/${masterId}/channels/${channelId}/merged`
  );
  return response.data;
};

/**
 * 제품명 덮어쓰기
 * PUT /channel-products/{id}/name
 */
export const updateChannelProductName = async (
  id: string,
  data: UpdateChannelProductNameDto
): Promise<void> => {
  await client.put(`${PIM_BASE_URL}/channel-products/${id}/name`, data);
};

/**
 * 채널 제품 상태 설정
 * PUT /channel-products/{id}/status
 */
export const updateChannelProductStatus = async (
  id: string,
  data: UpdateChannelProductStatusDto
): Promise<void> => {
  await client.put(`${PIM_BASE_URL}/channel-products/${id}/status`, data);
};

// 채널별 제품 클라이언트 객체
export const channelProducts = {
  create: channelProductsClient.create,
  getByMaster: getChannelProductsByMaster,
  getByChannel: getChannelProductsByChannel,
  get: getChannelProduct,
  update: updateChannelProduct,
  delete: deleteChannelProduct,
  getMerged: getMergedChannelProduct,
  updateName: updateChannelProductName,
  updateStatus: updateChannelProductStatus,
};
