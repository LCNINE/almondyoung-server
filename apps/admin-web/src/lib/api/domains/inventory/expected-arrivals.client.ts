'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { ExpectedArrivalsResponseDto } from '../../../types/dto/inventory';

export const expectedArrivalsClient = {
  list: async (warehouseId: string): Promise<ExpectedArrivalsResponseDto> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/inventory/expected-arrivals?warehouseId=${encodeURIComponent(warehouseId)}`
    );
    return response.data;
  },
};
