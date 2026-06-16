'use client';

// src/lib/api/domains/products/masters.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  CreateMasterDto,
  CreateMasterResponseDto,
  MasterDto,
  MasterSummaryListResponseDto,
  MastersQuery,
  MastersResponseDto,
  PricePreviewDto,
  UpdateMasterDto,
  UpdatePricingStrategyDto,
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

export interface ProductSummary {
  masterId: string;
  versionId: string;
  name: string;
  thumbnail: string | null;
  brand: string | null;
  isMembershipOnly: boolean;
  status: string;
  createdAt: string;
  optionGroupNames: string[];
  variantCount: number;
}

export const mastersClient = {
  create: async (dto?: CreateMasterDto): Promise<CreateMasterResponseDto> => {
    const url = `${ALMONDYOUNG_API_BASE_URL}/masters`;
    const response = dto ? await client.post(url, dto) : await client.post(url);
    return response.data;
  },

  getList: async (query: MastersQuery = {}): Promise<MastersResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters?${buildQueryString(
        query as Record<string, unknown>
      )}`
    );
    return response.data;
  },

  getListSummary: async (
    query: MastersQuery = {}
  ): Promise<MasterSummaryListResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters?${buildQueryString(
        query as Record<string, unknown>
      )}`
    );
    return response.data;
  },

  get: async (id: string): Promise<MasterDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${id}`
    );
    return response.data;
  },

  update: async (id: string, dto: UpdateMasterDto): Promise<MasterDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${id}`,
      dto
    );
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await client.delete(`${ALMONDYOUNG_API_BASE_URL}/masters/${id}`);
  },

  getPricePreview: async (id: string): Promise<PricePreviewDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${id}/price-preview`
    );
    return response.data;
  },

  updatePricingStrategy: async (
    id: string,
    data: UpdatePricingStrategyDto
  ): Promise<MasterDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${id}/pricing`,
      data
    );
    return response.data;
  },

  updateMembershipVisibility: async (
    masterId: string,
    isMembershipOnly: boolean
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/membership-visibility`,
      { isMembershipOnly }
    );
  },

  listByIds: async (
    ids: string[]
  ): Promise<{
    data: ProductSummary[];
    total: number;
    page: number;
    limit: number;
  }> => {
    if (ids.length === 0) {
      return { data: [], total: 0, page: 1, limit: 0 };
    }

    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters?ids=${ids.join(',')}`
    );

    return response.data;
  },
};
