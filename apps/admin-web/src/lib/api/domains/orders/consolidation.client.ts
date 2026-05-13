'use client';

// src/lib/api/domains/orders/consolidation.client.ts
// ⚠️ findConsolidationCandidates: customer/주소/치수/무게가 Math.random() 기반 mock
//    호출마다 결과가 다름 — UI는 반드시 "어드바이저리" 라벨링 필요
// ⚠️ getConsolidationReport: 하드코딩된 mock 숫자
// ⚠️ autoConsolidate: stub — 실제 FO 머지 안 함
// ⚠️ savings/projection?days= 쿼리가 string으로 전달되므로 항상 숫자로 직렬화
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ConsolidationCandidate,
  ConsolidationAnalysisResult,
  ConsolidationLiveOpportunities,
  ConsolidationSavingsProjection,
  ConsolidationRule,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/consolidation`;

export const consolidationClient = {
  getCandidates: async (warehouseId: string): Promise<ConsolidationCandidate[]> => {
    const res = await client.get(`${BASE}/candidates/${encodeURIComponent(warehouseId)}`);
    return res.data;
  },

  analyze: async (warehouseId: string): Promise<ConsolidationAnalysisResult> => {
    const res = await client.post(`${BASE}/candidates/${encodeURIComponent(warehouseId)}/analyze`);
    return res.data;
  },

  autoConsolidate: async (groupId: string): Promise<{ message: string; fulfillmentOrderId: string; consolidatedOrders: string[] }> => {
    // ⚠️ STUB — 서버에서 실제 머지 안 함
    const res = await client.post(`${BASE}/groups/${encodeURIComponent(groupId)}/auto-consolidate`);
    return res.data;
  },

  getLiveOpportunities: async (warehouseId: string): Promise<ConsolidationLiveOpportunities> => {
    const res = await client.get(`${BASE}/opportunities/live/${encodeURIComponent(warehouseId)}`);
    return res.data;
  },

  getSavingsProjection: async (
    warehouseId: string,
    days: number = 30
  ): Promise<ConsolidationSavingsProjection> => {
    const res = await client.get(
      `${BASE}/savings/projection/${encodeURIComponent(warehouseId)}`,
      { params: { days: String(days) } }
    );
    return res.data;
  },

  getRules: async (): Promise<ConsolidationRule[]> => {
    const res = await client.get(`${BASE}/rules`);
    return res.data;
  },
};
