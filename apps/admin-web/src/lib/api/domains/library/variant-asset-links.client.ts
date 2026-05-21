'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { DigitalAssetDto, SetVariantAssetLinksDto } from '@/lib/types/dto/library';

const base = (variantId: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/variants/${variantId}/digital-assets`;

export const variantAssetLinksClient = {
  list: async (variantId: string): Promise<DigitalAssetDto[]> => {
    const response = await client.get(base(variantId));
    return response.data;
  },

  set: async (variantId: string, dto: SetVariantAssetLinksDto): Promise<void> => {
    await client.put(base(variantId), dto);
  },

  add: async (variantId: string, assetId: string): Promise<void> => {
    await client.post(`${base(variantId)}/${assetId}`);
  },

  remove: async (variantId: string, assetId: string): Promise<void> => {
    await client.delete(`${base(variantId)}/${assetId}`);
  },
};
