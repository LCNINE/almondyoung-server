// src/lib/api/domains/products/channels.client.ts
import { PIM_BASE_URL } from '@/const';
import type { UUID } from '../../../types/dto/common';

import { client } from '../../client';
import type {
  ActiveChannelsResponseDto,
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
    const response = await client.post(`${PIM_BASE_URL}/channels`, dto);
    return response.data;
  },

  list: async (q?: ChannelsQuery): Promise<ChannelsResponseDto> => {
    const response = await client.get(
      `${PIM_BASE_URL}/channels?${buildQueryString((q as Record<string, unknown>) || {})}`
    );
    return response.data;
  },

  active: async (): Promise<ChannelDto[]> => {
    const response = await client.get(`${PIM_BASE_URL}/channels/active`);
    return response.data;
  },

  get: async (id: UUID): Promise<ChannelDto> => {
    const response = await client.get(`${PIM_BASE_URL}/channels/${id}`);
    return response.data;
  },

  update: async (id: UUID, dto: UpdateChannelDto): Promise<ChannelDto> => {
    const response = await client.put(`${PIM_BASE_URL}/channels/${id}`, dto);
    return response.data;
  },

  remove: async (id: UUID): Promise<void> => {
    await client.delete(`${PIM_BASE_URL}/channels/${id}`);
  },

  setActive: async (id: UUID, isActive: boolean): Promise<void> => {
    await client.put(`${PIM_BASE_URL}/channels/${id}/status`, { isActive });
  },

  byType: async (type: string): Promise<ChannelDto[]> => {
    const response = await client.get(`${PIM_BASE_URL}/channels/type/${type}`);
    return response.data;
  },

  validate: async (
    dto: ValidateChannelConfigDto
  ): Promise<ChannelValidationResponseDto> => {
    const response = await client.post(
      `${PIM_BASE_URL}/channels/validate`,
      dto
    );
    return response.data;
  },
};

/**
 * 판매 채널 목록 조회
 * GET /channels
 */
export const getChannels = async (
  query: ChannelsQuery = {}
): Promise<ChannelsResponseDto> => {
  const response = await client.get(
    `${PIM_BASE_URL}/channels?${buildQueryString(
      query as Record<string, unknown>
    )}`
  );
  return response.data;
};

/**
 * 활성 판매 채널 조회
 * GET /channels/active
 */
export const getActiveChannels = async (): Promise<ChannelDto[]> => {
  const response = await client.get(`${PIM_BASE_URL}/channels/active`);
  return response.data;
};

/**
 * 판매 채널 상세 조회
 * GET /channels/{id}
 */
export const getChannel = async (id: string): Promise<ChannelDto> => {
  const response = await client.get(`${PIM_BASE_URL}/channels/${id}`);
  return response.data;
};

/**
 * 판매 채널 수정
 * PUT /channels/{id}
 */
export const updateChannel = async (
  id: string,
  data: UpdateChannelDto
): Promise<ChannelDto> => {
  const response = await client.put(`${PIM_BASE_URL}/channels/${id}`, data);
  return response.data;
};

/**
 * 판매 채널 삭제
 * DELETE /channels/{id}
 */
export const deleteChannel = async (id: string): Promise<void> => {
  await client.delete(`${PIM_BASE_URL}/channels/${id}`);
};

/**
 * 판매 채널 상태 설정
 * PUT /channels/{id}/status
 */
export const updateChannelStatus = async (
  id: string,
  data: UpdateChannelStatusDto
): Promise<ChannelDto> => {
  const response = await client.put(
    `${PIM_BASE_URL}/channels/${id}/status`,
    data
  );
  return response.data;
};

/**
 * 타입별 판매 채널 조회
 * GET /channels/type/{type}
 */
export const getChannelsByType = async (
  type: string
): Promise<ChannelDto[]> => {
  const response = await client.get(`${PIM_BASE_URL}/channels/type/${type}`);
  return response.data;
};

/**
 * 판매 채널 설정 검증
 * POST /channels/validate
 */
export const validateChannelConfig = async (
  data: ValidateChannelConfigDto
): Promise<ChannelValidationResponseDto> => {
  const response = await client.post(`${PIM_BASE_URL}/channels/validate`, data);
  return response.data;
};

// 판매 채널 클라이언트 객체
export const channels = {
  create: channelsClient.create,
  getList: getChannels,
  getActive: getActiveChannels,
  get: getChannel,
  update: updateChannel,
  delete: deleteChannel,
  updateStatus: updateChannelStatus,
  getByType: getChannelsByType,
  validateConfig: validateChannelConfig,
};
