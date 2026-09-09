'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  GradeRuleDto,
  GradeRulesDto,
  LeadTimeRuleDto,
  ReplenishmentSettingsDto,
  ReplenishmentSkuDetailDto,
  ReplenishmentSuggestionListDto,
  RouteRulesListDto,
  SkuOverrideRowDto,
  SkuOverridesListDto,
  SuggestionActionFilter,
  SupplierRulesListDto,
  UpdateReplenishmentSettingsDto,
  UpsertLeadTimeRuleDto,
  UpsertSkuOverrideDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/replenishment`;
const RULES = `${BASE}/rules`;
const enc = encodeURIComponent;

/** GET .../skus?q= 의 서버 기본 `limit` (100) 은 예외 목록을 조용히 잘라낸다 — 항상 서버 최대치(500)를 명시한다. */
const SKU_OVERRIDES_MAX_LIMIT = 500;

export const replenishmentClient = {
  list: async (
    action: SuggestionActionFilter,
    limit?: number
  ): Promise<ReplenishmentSuggestionListDto> => {
    const query = limit != null ? `&limit=${limit}` : '';
    const response = await client.get<ReplenishmentSuggestionListDto>(
      `${BASE}/suggestions?action=${action}${query}`
    );
    return response.data;
  },
  getSku: async (skuId: string): Promise<ReplenishmentSkuDetailDto> => {
    const response = await client.get<ReplenishmentSkuDetailDto>(
      `${BASE}/skus/${enc(skuId)}`
    );
    return response.data;
  },
  rules: {
    getSettings: async (): Promise<ReplenishmentSettingsDto> =>
      (await client.get<ReplenishmentSettingsDto>(`${RULES}/settings`)).data,
    updateSettings: async (
      dto: UpdateReplenishmentSettingsDto
    ): Promise<ReplenishmentSettingsDto> =>
      (await client.put<ReplenishmentSettingsDto>(`${RULES}/settings`, dto))
        .data,
    getGrades: async (): Promise<GradeRulesDto> =>
      (await client.get<GradeRulesDto>(`${RULES}/grades`)).data,
    updateGrades: async (items: GradeRuleDto[]): Promise<GradeRulesDto> =>
      (await client.put<GradeRulesDto>(`${RULES}/grades`, { items })).data,
    getSuppliers: async (): Promise<SupplierRulesListDto> =>
      (await client.get<SupplierRulesListDto>(`${RULES}/suppliers`)).data,
    putSupplier: async (
      supplierId: string,
      dto: UpsertLeadTimeRuleDto
    ): Promise<LeadTimeRuleDto> =>
      (
        await client.put<LeadTimeRuleDto>(
          `${RULES}/suppliers/${enc(supplierId)}`,
          dto
        )
      ).data,
    deleteSupplier: async (supplierId: string): Promise<void> => {
      await client.delete(`${RULES}/suppliers/${enc(supplierId)}`);
    },
    getRoutes: async (): Promise<RouteRulesListDto> =>
      (await client.get<RouteRulesListDto>(`${RULES}/routes`)).data,
    putRoute: async (
      from: string,
      to: string,
      dto: UpsertLeadTimeRuleDto
    ): Promise<LeadTimeRuleDto> =>
      (
        await client.put<LeadTimeRuleDto>(
          `${RULES}/routes/${enc(from)}/${enc(to)}`,
          dto
        )
      ).data,
    deleteRoute: async (from: string, to: string): Promise<void> => {
      await client.delete(`${RULES}/routes/${enc(from)}/${enc(to)}`);
    },
    // limit 을 서버 최대치로 명시한다 — 안 넘기면 서버 기본 100 에서 잘려 표시 없이 누락된다(#743 B 리뷰).
    getSkuOverrides: async (
      q?: string,
      limit: number = SKU_OVERRIDES_MAX_LIMIT
    ): Promise<SkuOverridesListDto> => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (q) params.set('q', q);
      return (
        await client.get<SkuOverridesListDto>(
          `${RULES}/skus?${params.toString()}`
        )
      ).data;
    },
    putSkuOverride: async (
      skuId: string,
      dto: UpsertSkuOverrideDto
    ): Promise<SkuOverrideRowDto> =>
      (await client.put<SkuOverrideRowDto>(`${RULES}/skus/${enc(skuId)}`, dto))
        .data,
    deleteSkuOverride: async (skuId: string): Promise<void> => {
      await client.delete(`${RULES}/skus/${enc(skuId)}`);
    },
  },
};
