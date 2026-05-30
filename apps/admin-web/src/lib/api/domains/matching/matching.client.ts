'use client';

// src/lib/api/domains/matching/matching.client.ts
// 매칭 관련 API 클라이언트 (통합 서버 /matchings 엔드포인트)

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  MatchingsQuery,
  MatchingsResponseDto,
  ResolveMatchingDto,
  ResolveMatchingResponseDto,
  ResolveLegacyIgnoredMatchingDto,
  ResolveOptionMatchingDto,
  SetMatchingPriorityDto,
  SetMatchingPriorityResponseDto,
  ChangeStrategyDto,
  ChangeStrategyResponseDto,
  StockPolicyDto,
  UpdateStockPolicyResponseDto,
  VariantMatchingDto,
  VariantSkuLookupDto,
  VariantSkuLookupResponseDto,
  OrderLinesQuery,
  OrderLinesResponseDto,
  UpsertMatchingDto,
  MasterMatchingStatsDto,
} from '@/lib/types/dto/matching';

export const matchingClient = {
  /**
   * 매칭 대기 목록 조회
   * GET /matchings
   */
  getMatchings: async (
    query: MatchingsQuery = {}
  ): Promise<MatchingsResponseDto> => {
    const params = new URLSearchParams();

    if (query.status) params.append('status', query.status);
    if (query.limit !== undefined) params.append('limit', String(query.limit));
    if (query.offset !== undefined)
      params.append('offset', String(query.offset));

    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings?${params.toString()}`
    );
    return response.data;
  },

  /**
   * 레거시 ignored 상품매칭 감사 목록 조회
   * GET /matchings/legacy-ignored
   */
  getLegacyIgnoredMatchings: async (
    query: Omit<MatchingsQuery, 'status'> = {}
  ): Promise<MatchingsResponseDto> => {
    const params = new URLSearchParams();

    if (query.limit !== undefined) params.append('limit', String(query.limit));
    if (query.offset !== undefined)
      params.append('offset', String(query.offset));

    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/legacy-ignored?${params.toString()}`
    );
    return response.data;
  },

  /**
   * 주문 라인별 매칭 현황 조회
   * GET /matchings/order-lines
   */
  getOrderLines: async (
    query: OrderLinesQuery = {}
  ): Promise<OrderLinesResponseDto> => {
    const params = new URLSearchParams();

    if (query.matchingStatus)
      params.append('matchingStatus', query.matchingStatus);
    if (query.excludeMatched) params.append('excludeMatched', 'true');
    if (query.salesChannel) params.append('salesChannel', query.salesChannel);
    if (query.startDate) params.append('startDate', query.startDate);
    if (query.endDate) params.append('endDate', query.endDate);
    if (query.keyword) params.append('keyword', query.keyword);
    if (query.keywordType) params.append('keywordType', query.keywordType);
    if (query.limit !== undefined) params.append('limit', String(query.limit));
    if (query.offset !== undefined)
      params.append('offset', String(query.offset));

    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/order-lines?${params.toString()}`
    );
    return response.data;
  },

  /**
   * 매칭 대기 해소 (SKU와 매칭 또는 무시)
   * PATCH /matchings/{id}/resolve
   */
  resolveMatching: async (
    id: string,
    data: ResolveMatchingDto
  ): Promise<ResolveMatchingResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/resolve`,
      data
    );
    return response.data;
  },

  /**
   * 레거시 ignored 상품매칭 정리
   * POST /matchings/{id}/legacy-ignored/resolve
   */
  resolveLegacyIgnoredMatching: async (
    id: string,
    data: ResolveLegacyIgnoredMatchingDto
  ): Promise<ResolveMatchingResponseDto> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/legacy-ignored/resolve`,
      data
    );
    return response.data;
  },

  /**
   * 옵션별 매칭 해소
   * PATCH /matchings/{id}/resolve-options
   */
  resolveOptionMatching: async (
    id: string,
    data: ResolveOptionMatchingDto
  ): Promise<ResolveMatchingResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/resolve-options`,
      data
    );
    return response.data;
  },

  /**
   * 매칭 대기 우선순위 설정
   * PATCH /matchings/{id}/priority
   */
  setMatchingPriority: async (
    id: string,
    data: SetMatchingPriorityDto
  ): Promise<SetMatchingPriorityResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/priority`,
      data
    );
    return response.data;
  },

  /**
   * 매칭 전략 변경
   * PATCH /matchings/{id}/strategy
   */
  changeMatchingStrategy: async (
    id: string,
    data: ChangeStrategyDto
  ): Promise<ChangeStrategyResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/strategy`,
      data
    );
    return response.data;
  },

  /**
   * 매칭의 재고 정책 업데이트
   * PATCH /matchings/{id}/stock-policy
   */
  updateMatchingStockPolicy: async (
    id: string,
    data: StockPolicyDto
  ): Promise<UpdateStockPolicyResponseDto> => {
    const response = await client.patch(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/stock-policy`,
      data
    );
    return response.data;
  },

  /**
   * Variant의 재고 정책 조회
   * GET /matchings/variants/{variantId}/stock-policy
   */
  getVariantStockPolicy: async (variantId: string): Promise<StockPolicyDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${variantId}/stock-policy`
    );
    return response.data;
  },

  /**
   * Variant의 SKU 조합 조회
   * POST /matchings/variants/{variantId}/sku-lookup
   */
  getVariantSkuLookup: async (
    variantId: string,
    data: VariantSkuLookupDto
  ): Promise<VariantSkuLookupResponseDto[]> => {
    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${variantId}/sku-lookup`,
      data
    );
    return response.data;
  },

  /**
   * Variant별 매칭 조회
   * GET /matchings/{variantId}
   */
  getVariantMatching: async (
    variantId: string
  ): Promise<VariantMatchingDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${variantId}`
    );
    return response.data;
  },

  /**
   * Variant별 매칭 업데이트
   * PUT /matchings/{variantId}
   */
  updateVariantMatching: async (
    variantId: string,
    data: Partial<VariantMatchingDto>
  ): Promise<VariantMatchingDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${variantId}`,
      data
    );
    return response.data;
  },

  /**
   * Variant 매칭 upsert (SKU 매핑 + 재고 정책 한 번에)
   * PUT /matchings/{variantId}
   */
  upsertVariantMatching: async (
    variantId: string,
    data: UpsertMatchingDto
  ): Promise<VariantMatchingDto> => {
    const response = await client.put(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/${variantId}`,
      data
    );
    return response.data;
  },

  /**
   * 마스터 단위 매칭 통계 일괄 조회
   * GET /matchings/masters/batch-stats?masterIds=a,b,c
   */
  getMastersBatchStats: async (
    masterIds: string[]
  ): Promise<MasterMatchingStatsDto[]> => {
    if (masterIds.length === 0) return [];
    const params = new URLSearchParams({ masterIds: masterIds.join(',') });
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/matchings/masters/batch-stats?${params.toString()}`
    );
    return response.data;
  },
};
