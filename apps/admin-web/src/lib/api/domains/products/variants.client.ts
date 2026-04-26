// src/lib/api/domains/products/variants.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { PaginationQuery, UUID } from '../../../types/dto/common';
import type {
  BulkUpdateVariantDto,
  UpdateVariantDto,
  UpdateVariantStatusDto,
  VariantDto,
  VariantPriceDto,
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

export const variantsClient = {
  byMaster: async (
    masterId: UUID,
    q?: PaginationQuery
  ): Promise<{
    data: VariantDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/variants/masters/${masterId}?${buildQueryString(q || {})}`
    );
    return response.data;
  },

  get: async (id: UUID): Promise<VariantDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}`);
    return response.data;
  },

  update: async (id: UUID, dto: UpdateVariantDto): Promise<VariantDto> => {
    const response = await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}`, dto);
    return response.data;
  },

  bulkUpdate: async (dto: BulkUpdateVariantDto): Promise<void> => {
    await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/bulk`, dto);
  },

  price: async (id: UUID): Promise<VariantPriceDto> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}/price`);
    return response.data;
  },

  setStatus: async (id: UUID, status: string): Promise<void> => {
    await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}/status`, { status });
  },
};

/**
 * 제품 변형 상세 조회
 * GET /variants/{id}
 */
export const getVariant = async (id: string): Promise<VariantDto> => {
  const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}`);
  return response.data;
};

/**
 * 제품 변형 수정
 * PUT /variants/{id}
 */
export const updateVariant = async (
  id: string,
  data: UpdateVariantDto
): Promise<VariantDto> => {
  const response = await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}`, data);
  return response.data;
};

/**
 * 제품 변형 일괄 수정
 * PUT /variants/bulk
 */
export const bulkUpdateVariants = async (
  data: BulkUpdateVariantDto
): Promise<void> => {
  await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/bulk`, data);
};

/**
 * 제품 변형 가격 조회
 * GET /variants/{id}/price
 */
export const getVariantPrice = async (id: string): Promise<VariantPriceDto> => {
  const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}/price`);
  return response.data;
};

/**
 * 제품 변형 상태 수정
 * PUT /variants/{id}/status
 */
export const updateVariantStatus = async (
  id: string,
  data: UpdateVariantStatusDto
): Promise<void> => {
  await client.put(`${ALMONDYOUNG_API_BASE_URL}/variants/${id}/status`, data);
};

export type BatchVariantInfo = {
  id: string;
  variantName?: string;
  variantCode?: string;
  masterId: string;
  masterName: string;
  optionLabel?: string;
};

/**
 * Variant 일괄 조회
 * GET /variants/batch?ids=id1,id2,...
 */
export const getVariantsBatch = async (ids: string[]): Promise<BatchVariantInfo[]> => {
  if (!ids.length) return [];
  const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/variants/batch?ids=${ids.join(',')}`);
  return response.data;
};

// 제품 변형 클라이언트 객체
export const variants = {
  getByMaster: variantsClient.byMaster,
  get: getVariant,
  update: updateVariant,
  bulkUpdate: bulkUpdateVariants,
  getPrice: getVariantPrice,
  updateStatus: updateVariantStatus,
  getBatch: getVariantsBatch,
};
