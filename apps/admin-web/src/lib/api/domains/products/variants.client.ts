'use client';

// src/lib/api/domains/products/variants.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { PaginationQuery, UUID } from '../../../types/dto/common';
import type { VariantDto, VariantPriceDto } from '../../../types/dto/products';
import { client } from '../../client';

const VARIANT_BATCH_SIZE = 100;

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
  /** 마스터 대표 썸네일 (파일 ID 또는 절대 URL) */
  thumbnail?: string | null;
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
    // ids 가 수백 개면 주소가 길어 414 로 통째로 거절된다 — 나눠서 부른다
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += VARIANT_BATCH_SIZE) {
      chunks.push(ids.slice(i, i + VARIANT_BATCH_SIZE));
    }
    const responses = await Promise.all(
      chunks.map((chunk) =>
        client.get<BatchVariantInfo[]>(
          `${ALMONDYOUNG_API_BASE_URL}/variants/batch?ids=${chunk.join(',')}`
        )
      )
    );
    return responses.flatMap((r) => r.data);
  },
};
