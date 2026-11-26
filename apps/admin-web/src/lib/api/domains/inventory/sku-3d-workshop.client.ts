'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  Sku3dDimensionBasis,
  Sku3dWorkshopDetailDto,
  Sku3dWorkshopDto,
  Sku3dWorkshopEventDto,
  Sku3dWorkshopJobDto,
} from '../../../types/dto/inventory';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inventory/sku-3d-workshops`;
const seg = encodeURIComponent;

export const sku3dWorkshopClient = {
  open: async (skuId: string): Promise<Sku3dWorkshopDto> =>
    (await client.post(`${BASE}/skus/${seg(skuId)}`, {})).data,

  detail: async (id: string): Promise<Sku3dWorkshopDetailDto> =>
    (await client.get(`${BASE}/${seg(id)}`)).data,

  events: async (
    id: string,
    afterSeq: number
  ): Promise<{
    events: Sku3dWorkshopEventDto[];
    activeJob: Sku3dWorkshopJobDto | null;
  }> =>
    (await client.get(`${BASE}/${seg(id)}/events`, { params: { afterSeq } }))
      .data,

  confirmDimensions: async (
    id: string,
    basis: Sku3dDimensionBasis
  ): Promise<Sku3dWorkshopJobDto | null> =>
    (await client.put(`${BASE}/${seg(id)}/dimensions`, { basis })).data,

  postMessage: async (id: string, body: string): Promise<Sku3dWorkshopJobDto> =>
    (await client.post(`${BASE}/${seg(id)}/messages`, { body })).data,

  approve: async (
    id: string,
    revisionId: string,
    glbSha256: string
  ): Promise<{
    revisionId: string;
    sku3dModelId: string;
    publishedAt: string;
  }> =>
    (
      await client.post(
        `${BASE}/${seg(id)}/revisions/${seg(revisionId)}/approve`,
        { glbSha256 }
      )
    ).data,

  // 비공개 검토 파일 — 브라우저가 쿠키와 함께 같은 출처 프록시로 받는다
  fileUrl: (
    id: string,
    revisionId: string,
    kind: 'glb' | `render-${number}`
  ): string =>
    `/api${BASE}/${seg(id)}/revisions/${seg(revisionId)}/files/${kind}`,
};
