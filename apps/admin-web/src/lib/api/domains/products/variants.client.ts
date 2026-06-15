'use client';

// src/lib/api/domains/products/variants.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { PaginationQuery, UUID } from '../../../types/dto/common';
import type { VariantDto, VariantPriceDto } from '../../../types/dto/products';
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

export type BatchVariantInfo = {
  id: string;
  variantName?: string;
  variantCode?: string;
  masterId: string;
  masterName: string;
  optionLabel?: string;
};

export const variantsClient = {
  getByMaster: async (
    masterId: UUID,
    q?: PaginationQuery
  ): Promise<{
    data: VariantDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/masters/${masterId}?${buildQueryString(
        (q as Record<string, unknown>) || {}
      )}`
    );
    return response.data;
  },

  getByMasterVersion: async (
    masterId: UUID,
    versionId: UUID,
    q?: PaginationQuery
  ): Promise<{
    data: VariantDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/masters/${masterId}/versions/${versionId}?${buildQueryString(
        (q as Record<string, unknown>) || {}
      )}`
    );
    return response.data;
  },

  get: async (id: UUID): Promise<VariantDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/${id}`
    );
    return response.data;
  },

  getPrice: async (id: UUID): Promise<VariantPriceDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/${id}/price`
    );
    return response.data;
  },

  getBatch: async (ids: string[]): Promise<BatchVariantInfo[]> => {
    if (!ids.length) return [];
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/batch?ids=${ids.join(',')}`
    );
    return response.data;
  },
};
