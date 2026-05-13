'use client';

// Blacklists 도메인 API 클라이언트

import { USER_SERVICE_BASE_URL } from '@/const';
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
  user?: {
    username: string;
    nickname: string;
    email: string;
  } | null;
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

export interface BlacklistListQuery {
  page?: number;
  limit?: number;
  userId?: string;
  q?: string;
}

export const blacklistApi = {
  // 블랙리스트 목록 조회
  getBlacklists: async (
    query?: BlacklistListQuery
  ): Promise<BlacklistListResponse> => {
    const params = new URLSearchParams();
    if (query?.page) params.append('page', String(query.page));
    if (query?.limit) params.append('limit', String(query.limit));
    if (query?.userId) params.append('userId', query.userId);
    if (query?.q) params.append('q', query.q);

    const response = await client.get<BlacklistListResponse>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists`,
      { params }
    );
    return response.data;
  },

  // 블랙리스트 조회 (사용자 ID로)
  getBlacklistByUserId: async (
    userId: string
  ): Promise<BlacklistResponse> => {
    const response = await client.get<BlacklistResponse>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists/${userId}`
    );
    return response.data;
  },

  // 블랙리스트 생성
  createBlacklist: async (
    dto: BlacklistCreateDto
  ): Promise<BlacklistResponse> => {
    const response = await client.post<BlacklistResponse>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists`,
      dto
    );
    return response.data;
  },

  // 블랙리스트 삭제 (소프트 삭제)
  deleteBlacklist: async (
    userId: string
  ): Promise<BlacklistResponse> => {
    const response = await client.delete<BlacklistResponse>(
      `${USER_SERVICE_BASE_URL}/admin/blacklists/${userId}`
    );
    return response.data;
  },
};
