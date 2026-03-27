// Blacklists 도메인 API 클라이언트

import { USER_SERVICE_BASE_URL } from '@/const';
import { ApiResponse } from '@/lib/types/dto/api';
import { client } from '../../client';

export interface BlacklistResponse {
  id: string;
  userId: string;
  reason: string;
  internalNote: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deletedBy: string | null;
}

export interface BlacklistCreateDto {
  userId: string;
  reason: string;
  internalNote?: string;
}

export interface BlacklistListResponse {
  data: BlacklistResponse[];
  total: number;
  page: number;
  limit: number;
}

export const blacklistApi = {
  // 블랙리스트 조회 (사용자 ID로)
  getBlacklistByUserId: async (
    userId: string
  ): Promise<ApiResponse<BlacklistResponse>> => {
    const response = await client.get<ApiResponse<BlacklistResponse>>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists/${userId}`
    );
    return response.data;
  },

  // 블랙리스트 생성
  createBlacklist: async (
    dto: BlacklistCreateDto
  ): Promise<ApiResponse<BlacklistResponse>> => {
    const response = await client.post<ApiResponse<BlacklistResponse>>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists`,
      dto
    );
    return response.data;
  },

  // 블랙리스트 삭제 (소프트 삭제)
  deleteBlacklist: async (
    userId: string
  ): Promise<ApiResponse<BlacklistResponse>> => {
    const response = await client.delete<ApiResponse<BlacklistResponse>>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists/${userId}`
    );
    return response.data;
  },
};
