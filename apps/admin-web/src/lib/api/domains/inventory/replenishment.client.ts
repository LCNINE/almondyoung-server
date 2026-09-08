'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  ReplenishmentSuggestionListDto,
  ReplenishmentSuggestionRowDto,
  SuggestionActionFilter,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/replenishment`;

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
  getSku: async (skuId: string): Promise<ReplenishmentSuggestionRowDto> => {
    const response = await client.get<ReplenishmentSuggestionRowDto>(
      `${BASE}/skus/${encodeURIComponent(skuId)}`
    );
    return response.data;
  },
};
