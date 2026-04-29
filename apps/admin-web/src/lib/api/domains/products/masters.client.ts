// src/lib/api/domains/products/masters.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  CreateMasterDto,
  MasterDto,
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

export const mastersClient = {
  create: async (dto: CreateMasterDto): Promise<MasterDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters`,
      dto
    );
    return response.data;
  },

  list: async (
    q?: Record<string, unknown>
  ): Promise<{
    data: MasterDto[];
    total: number;
    page: number;
    limit: number;
  }> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters?${buildQueryString(q || {})}`
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

  remove: async (id: string): Promise<void> => {
    await client.delete(`${ALMONDYOUNG_API_BASE_URL}/masters/${id}`);
  },

  pricePreview: async (id: string): Promise<PricePreviewDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${id}/price-preview`
    );
    return response.data;
  },

  changePricing: async (
    id: string,
    dto: { pricingStrategy: string; migrationData?: Record<string, unknown> }
  ): Promise<void> => {
    await client.put(`${ALMONDYOUNG_API_BASE_URL}/masters/${id}/pricing`, dto);
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

/**
 * 제품 마스터 목록 조회
 * GET /masters
 */
export const getMasters = async (
  query: MastersQuery = {}
): Promise<MastersResponseDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/masters?${buildQueryString(
      query as Record<string, unknown>
    )}`
  );
  return response.data;
};

/**
 * 제품 마스터 상세 조회
 * GET /masters/{id}
 */
export const getMaster = async (id: string): Promise<MasterDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/masters/${id}`
  );
  return response.data;
};

/**
 * 제품 마스터 수정
 * PUT /masters/{id}
 */
export const updateMaster = async (
  id: string,
  data: UpdateMasterDto
): Promise<MasterDto> => {
  const response = await client.put(
    `${ALMONDYOUNG_API_BASE_URL}/masters/${id}`,
    data
  );
  return response.data;
};

/**
 * 제품 마스터 삭제
 * DELETE /masters/{id}
 */
export const deleteMaster = async (id: string): Promise<void> => {
  await client.delete(`${ALMONDYOUNG_API_BASE_URL}/masters/${id}`);
};

/**
 * 가격 미리보기
 * GET /masters/{id}/price-preview
 */
export const getPricePreview = async (id: string): Promise<PricePreviewDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/masters/${id}/price-preview`
  );
  return response.data;
};

/**
 * 가격 전략 변경
 * PUT /masters/{id}/pricing
 */
export const updatePricingStrategy = async (
  id: string,
  data: UpdatePricingStrategyDto
): Promise<MasterDto> => {
  const response = await client.put(
    `${ALMONDYOUNG_API_BASE_URL}/masters/${id}/pricing`,
    data
  );
  return response.data;
};

// 제품 마스터 클라이언트 객체
export const masters = {
  create: mastersClient.create,
  getList: getMasters,
  get: getMaster,
  update: updateMaster,
  delete: deleteMaster,
  getPricePreview,
  updatePricingStrategy,
  listByIds: mastersClient.listByIds,
};
