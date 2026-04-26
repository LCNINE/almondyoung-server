// src/lib/api/domains/matching/matching.client.ts
// 매칭 관련 API 클라이언트 (통합 서버 /matchings 엔드포인트)

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  MatchingsQuery,
  MatchingsResponseDto,
  MatchingDto,
  ResolveMatchingDto,
  ResolveMatchingResponseDto,
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
} from '@/lib/types/dto/orders';

/**
 * 매칭 대기 목록 조회
 * GET /matchings
 */
export const getMatchings = async (
  query: MatchingsQuery = {}
): Promise<MatchingsResponseDto> => {
  const params = new URLSearchParams();

  if (query.status) params.append('status', query.status);
  if (query.limit !== undefined) params.append('limit', String(query.limit));
  if (query.offset !== undefined) params.append('offset', String(query.offset));

  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/matchings?${params.toString()}`
  );
  return response.data;
};

/**
 * 주문 라인별 매칭 현황 조회
 * GET /matchings/order-lines
 */
export const getOrderLines = async (
  query: OrderLinesQuery = {}
): Promise<OrderLinesResponseDto> => {
  const params = new URLSearchParams();

  if (query.matchingStatus) params.append('matchingStatus', query.matchingStatus);
  if (query.excludeMatched) params.append('excludeMatched', 'true');
  if (query.salesChannel) params.append('salesChannel', query.salesChannel);
  if (query.startDate) params.append('startDate', query.startDate);
  if (query.endDate) params.append('endDate', query.endDate);
  if (query.keyword) params.append('keyword', query.keyword);
  if (query.keywordType) params.append('keywordType', query.keywordType);
  if (query.limit !== undefined) params.append('limit', String(query.limit));
  if (query.offset !== undefined) params.append('offset', String(query.offset));

  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/order-lines?${params.toString()}`
  );
  return response.data;
};

/**
 * 매칭 대기 해소 (SKU와 매칭 또는 무시)
 * PATCH /matchings/{id}/resolve
 */
export const resolveMatching = async (
  id: string,
  data: ResolveMatchingDto
): Promise<ResolveMatchingResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/resolve`,
    data
  );
  return response.data;
};

/**
 * 옵션별 매칭 해소
 * PATCH /matchings/{id}/resolve-options
 */
export const resolveOptionMatching = async (
  id: string,
  data: ResolveOptionMatchingDto
): Promise<ResolveMatchingResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/resolve-options`,
    data
  );
  return response.data;
};

/**
 * 매칭 대기 우선순위 설정
 * PATCH /matchings/{id}/priority
 */
export const setMatchingPriority = async (
  id: string,
  data: SetMatchingPriorityDto
): Promise<SetMatchingPriorityResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/priority`,
    data
  );
  return response.data;
};

/**
 * 매칭 전략 변경
 * PATCH /matchings/{id}/strategy
 */
export const changeMatchingStrategy = async (
  id: string,
  data: ChangeStrategyDto
): Promise<ChangeStrategyResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/strategy`,
    data
  );
  return response.data;
};

/**
 * 매칭의 재고 정책 업데이트
 * PATCH /matchings/{id}/stock-policy
 */
export const updateMatchingStockPolicy = async (
  id: string,
  data: StockPolicyDto
): Promise<UpdateStockPolicyResponseDto> => {
  const response = await client.patch(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${id}/stock-policy`,
    data
  );
  return response.data;
};

/**
 * Variant의 재고 정책 조회
 * GET /matchings/variants/{variantId}/stock-policy
 */
export const getVariantStockPolicy = async (
  variantId: string
): Promise<StockPolicyDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${variantId}/stock-policy`
  );
  return response.data;
};

/**
 * Variant의 SKU 조합 조회
 * POST /matchings/variants/{variantId}/sku-lookup
 */
export const getVariantSkuLookup = async (
  variantId: string,
  data: VariantSkuLookupDto
): Promise<VariantSkuLookupResponseDto[]> => {
  const response = await client.post(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/variants/${variantId}/sku-lookup`,
    data
  );
  return response.data;
};

/**
 * Variant별 매칭 조회
 * GET /matchings/{variantId}
 */
export const getVariantMatching = async (
  variantId: string
): Promise<VariantMatchingDto> => {
  const response = await client.get(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${variantId}`
  );
  return response.data;
};

/**
 * Variant별 매칭 업데이트
 * PUT /matchings/{variantId}
 */
export const updateVariantMatching = async (
  variantId: string,
  data: Partial<VariantMatchingDto>
): Promise<VariantMatchingDto> => {
  const response = await client.put(
    `${ALMONDYOUNG_API_BASE_URL}/matchings/${variantId}`,
    data
  );
  return response.data;
};

// 매칭 클라이언트 객체
export const matchingClient = {
  // 조회
  getMatchings,
  getOrderLines,
  getVariantMatching,
  getVariantStockPolicy,
  getVariantSkuLookup,

  // 매칭 해소
  resolveMatching,
  resolveOptionMatching,

  // 설정 변경
  setMatchingPriority,
  changeMatchingStrategy,
  updateMatchingStockPolicy,
  updateVariantMatching,
};
