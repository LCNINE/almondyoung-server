'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  Sku3dModelDto,
  Sku3dModelUploadListDto,
  Sku3dModelUploadQuery,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/sku-3d-models`;
const seg = encodeURIComponent;

export const sku3dModelsClient = {
  list: async (skuId: string): Promise<Sku3dModelDto[]> =>
    (await client.get(`${BASE}/skus/${seg(skuId)}`)).data,

  register: async (skuId: string, glbFileId: string): Promise<Sku3dModelDto> =>
    (
      await client.post(`${BASE}/skus/${seg(skuId)}`, {
        glbFileId,
        status: 'draft',
      })
    ).data,

  listUploads: async (
    query: Sku3dModelUploadQuery
  ): Promise<Sku3dModelUploadListDto> =>
    (await client.get(BASE, { params: query })).data,

  publish: async (id: string): Promise<Sku3dModelDto> =>
    (await client.put(`${BASE}/${seg(id)}/publish`)).data,

  unpublish: async (skuId: string): Promise<Sku3dModelDto[]> =>
    (await client.put(`${BASE}/skus/${seg(skuId)}/unpublish`)).data,
};
