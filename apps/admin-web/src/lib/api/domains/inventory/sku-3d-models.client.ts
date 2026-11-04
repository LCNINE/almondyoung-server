'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type { Sku3dModelDto } from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/sku-3d-models`;
const seg = encodeURIComponent;

export const sku3dModelsClient = {
  list: async (skuId: string): Promise<Sku3dModelDto[]> =>
    (await client.get(`${BASE}/skus/${seg(skuId)}`)).data,

  register: async (skuId: string, glbFileId: string): Promise<Sku3dModelDto> =>
    (
      await client.post(`${BASE}/skus/${seg(skuId)}`, {
        glbFileId,
        status: 'approved',
      })
    ).data,
};
