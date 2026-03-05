// src/lib/api/domains/inventory/matching.client.ts
// 재고 매칭 관련 API 클라이언트 (WMS API 스펙 기반)

import { WMS_BASE_URL } from '@/const';
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
} from '@/lib/types/dto/orders';

/**
 * 매칭 대기 목록 조회
 * GET /wms/matchings
 */
export const getMatchings = async (
    query: MatchingsQuery = {}
): Promise<MatchingsResponseDto> => {
    const params = new URLSearchParams();

    if (query.status) params.append('status', query.status);

    const response = await client.get(
        `${WMS_BASE_URL}/wms/matchings?${params.toString()}`
    );
    return response.data;
};

/**
 * 매칭 대기 해소 (SKU와 매칭 또는 무시)
 * PATCH /wms/matchings/{id}/resolve
 */
export const resolveMatching = async (
    id: string,
    data: ResolveMatchingDto
): Promise<ResolveMatchingResponseDto> => {
    const response = await client.patch(
        `${WMS_BASE_URL}/wms/matchings/${id}/resolve`,
        data
    );
    return response.data;
};

/**
 * 옵션별 매칭 해소
 * PATCH /wms/matchings/{id}/resolve-options
 */
export const resolveOptionMatching = async (
    id: string,
    data: ResolveOptionMatchingDto
): Promise<ResolveMatchingResponseDto> => {
    const response = await client.patch(
        `${WMS_BASE_URL}/wms/matchings/${id}/resolve-options`,
        data
    );
    return response.data;
};

/**
 * 매칭 대기 우선순위 설정
 * PATCH /wms/matchings/{id}/priority
 */
export const setMatchingPriority = async (
    id: string,
    data: SetMatchingPriorityDto
): Promise<SetMatchingPriorityResponseDto> => {
    const response = await client.patch(
        `${WMS_BASE_URL}/wms/matchings/${id}/priority`,
        data
    );
    return response.data;
};

/**
 * 매칭 전략 변경
 * PATCH /wms/matchings/{id}/strategy
 */
export const changeMatchingStrategy = async (
    id: string,
    data: ChangeStrategyDto
): Promise<ChangeStrategyResponseDto> => {
    const response = await client.patch(
        `${WMS_BASE_URL}/wms/matchings/${id}/strategy`,
        data
    );
    return response.data;
};

/**
 * 매칭의 재고 정책 업데이트
 * PATCH /wms/matchings/{id}/stock-policy
 */
export const updateMatchingStockPolicy = async (
    id: string,
    data: StockPolicyDto
): Promise<UpdateStockPolicyResponseDto> => {
    const response = await client.patch(
        `${WMS_BASE_URL}/wms/matchings/${id}/stock-policy`,
        data
    );
    return response.data;
};

/**
 * Variant의 재고 정책 조회
 * GET /wms/matchings/variants/{variantId}/stock-policy
 */
export const getVariantStockPolicy = async (
    variantId: string
): Promise<StockPolicyDto> => {
    const response = await client.get(
        `${WMS_BASE_URL}/wms/matchings/variants/${variantId}/stock-policy`
    );
    return response.data;
};

/**
 * Variant의 SKU 조합 조회
 * POST /wms/matchings/variants/{variantId}/sku-lookup
 */
export const getVariantSkuLookup = async (
    variantId: string,
    data: VariantSkuLookupDto
): Promise<VariantSkuLookupResponseDto[]> => {
    const response = await client.post(
        `${WMS_BASE_URL}/wms/matchings/variants/${variantId}/sku-lookup`,
        data
    );
    return response.data;
};

/**
 * Variant별 매칭 조회
 * GET /wms/matchings/{variantId}
 */
export const getVariantMatching = async (
    variantId: string
): Promise<VariantMatchingDto> => {
    const response = await client.get(`${WMS_BASE_URL}/wms/matchings/${variantId}`);
    return response.data;
};

/**
 * Variant별 매칭 업데이트
 * PUT /wms/matchings/{variantId}
 */
export const updateVariantMatching = async (
    variantId: string,
    data: Partial<VariantMatchingDto>
): Promise<VariantMatchingDto> => {
    const response = await client.put(
        `${WMS_BASE_URL}/wms/matchings/${variantId}`,
        data
    );
    return response.data;
};

// 매칭 클라이언트 객체
export const matchingClient = {
    // 조회
    getMatchings,
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







