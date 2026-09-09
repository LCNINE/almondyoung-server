'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import {
  BestSelectionListResponse,
  BestSelectionStatus,
  ReviewRewardGrantListResponse,
  ReviewRewardGrantStatus,
  ReviewRewardRuleDto,
  ReviewRewardSummaryDto,
  ReviewRewardTrigger,
  UpsertReviewRewardRuleDto,
} from '@/lib/types/dto/review-reward';
import { AxiosResponse } from 'axios';
import { client } from '../../client';

const BASE = `${UGC_SERVICE_BASE_URL}/reviews/admin/rewards`;

export const reviewRewardApi = {
  getRules: async (trigger?: ReviewRewardTrigger): Promise<ReviewRewardRuleDto[]> => {
    const response: AxiosResponse<ReviewRewardRuleDto[]> = await client.get(
      `${BASE}/rules${trigger ? `?trigger=${trigger}` : ''}`
    );
    return response.data;
  },

  createRule: async (dto: UpsertReviewRewardRuleDto): Promise<ReviewRewardRuleDto> => {
    const response: AxiosResponse<ReviewRewardRuleDto> = await client.post(`${BASE}/rules`, dto);
    return response.data;
  },

  updateRule: async (id: string, dto: UpsertReviewRewardRuleDto): Promise<ReviewRewardRuleDto> => {
    const response: AxiosResponse<ReviewRewardRuleDto> = await client.put(`${BASE}/rules/${id}`, dto);
    return response.data;
  },

  setRuleActive: async (id: string, active: boolean): Promise<ReviewRewardRuleDto> => {
    const response: AxiosResponse<ReviewRewardRuleDto> = await client.patch(`${BASE}/rules/${id}/active`, {
      active,
    });
    return response.data;
  },

  deleteRule: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/rules/${id}`);
  },

  getGrants: async (query: {
    page?: number;
    limit?: number;
    status?: ReviewRewardGrantStatus;
  }): Promise<ReviewRewardGrantListResponse> => {
    const params = new URLSearchParams();
    if (query.page) params.append('page', String(query.page));
    if (query.limit) params.append('limit', String(query.limit));
    if (query.status) params.append('status', query.status);

    const response: AxiosResponse<ReviewRewardGrantListResponse> = await client.get(
      `${BASE}/grants?${params.toString()}`
    );
    return response.data;
  },

  getSummary: async (days: number): Promise<ReviewRewardSummaryDto> => {
    const response: AxiosResponse<ReviewRewardSummaryDto> = await client.get(`${BASE}/summary?days=${days}`);
    return response.data;
  },

  getBestSelections: async (query: {
    status?: BestSelectionStatus;
    page?: number;
    limit?: number;
  }): Promise<BestSelectionListResponse> => {
    const params = new URLSearchParams();
    if (query.status) params.append('status', query.status);
    if (query.page) params.append('page', String(query.page));
    if (query.limit) params.append('limit', String(query.limit));

    const response: AxiosResponse<BestSelectionListResponse> = await client.get(
      `${BASE}/best-selections?${params.toString()}`
    );
    return response.data;
  },

  generateBestSelections: async (): Promise<{ created: number }> => {
    const response: AxiosResponse<{ created: number }> = await client.post(`${BASE}/best-selections/generate`);
    return response.data;
  },

  confirmBestSelection: async (id: string): Promise<{ granted: boolean; amount: number }> => {
    const response: AxiosResponse<{ granted: boolean; amount: number }> = await client.post(
      `${BASE}/best-selections/${id}/confirm`
    );
    return response.data;
  },

  rejectBestSelection: async (id: string): Promise<void> => {
    await client.post(`${BASE}/best-selections/${id}/reject`);
  },
};
