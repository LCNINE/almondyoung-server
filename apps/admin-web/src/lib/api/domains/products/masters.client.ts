'use client';

// src/lib/api/domains/products/masters.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  CreateMasterDto,
  CreateMasterResponseDto,
  MasterDto,
  MasterSelectionResponseDto,
  MasterSummaryListResponseDto,
  MastersQuery,
  MastersResponseDto,
  PricePreviewDto,
  UpdateMasterDto,
  UpdatePricingStrategyDto,
  ExportColumnsResponseDto,
  ProductExportRequestDto,
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
  hideMembershipPriceForNonMembers: boolean;
  isVisibleToMembersOnly: boolean;
  /** @deprecated use hideMembershipPriceForNonMembers */
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

  /**
   * 필터에 걸린 상품 전량의 id + 정책 플래그.
   * page/limit 은 서버가 무시하므로 보내지 않는다.
   */
  getSelection: async (query: MastersQuery = {}): Promise<MasterSelectionResponseDto> => {
    const { page: _page, limit: _limit, ...filters } = query;
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/selection?${buildQueryString(
        filters as Record<string, unknown>
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

  updateMembershipPriceVisibility: async (
    masterId: string,
    hideMembershipPriceForNonMembers: boolean
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/membership-price-visibility`,
      { hideMembershipPriceForNonMembers }
    );
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

  updateMembersOnlyVisibility: async (
    masterId: string,
    isVisibleToMembersOnly: boolean
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/members-only-visibility`,
      { isVisibleToMembersOnly }
    );
  },

  updateOverseas: async (
    masterId: string,
    isOverseas: boolean
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/overseas`,
      { isOverseas }
    );
  },

  updateShippingGroup: async (
    masterId: string,
    shippingGroupCode: string | null
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/shipping-group`,
      { shippingGroupCode }
    );
  },

  updateRequiresMembership: async (
    masterId: string,
    requiresMembership: boolean
  ): Promise<void> => {
    await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/masters/${masterId}/requires-membership`,
      { requiresMembership }
    );
  },

  /** 내보내기 항목 카탈로그. 양식 편집기가 쓴다. */
  getExportColumns: async (): Promise<ExportColumnsResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/masters/export/columns`
    );
    return response.data;
  },

  /**
   * 상품 목록 엑셀 내보내기. ids 를 주면 선택항목만, 없으면 filters 로 전량.
   * 열 목록·필터가 길어 URL 한계를 넘기므로 POST 다.
   */
  exportExcel: async (body: ProductExportRequestDto): Promise<Blob> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/masters/export`,
      body,
      { responseType: 'blob' }
    );
    return response.data;
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
