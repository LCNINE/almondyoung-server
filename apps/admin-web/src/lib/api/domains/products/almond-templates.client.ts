'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminAlmondTemplateDto,
  AlmondTemplateStatus,
} from '../../../types/dto/products';

const BASE = `${UGC_SERVICE_BASE_URL}/admin/almond-templates`;

export const almondTemplatesClient = {
  list: async (): Promise<AdminAlmondTemplateDto[]> => {
    const response = await client.get(BASE);
    return response.data;
  },

  updateStatus: async (
    id: string,
    status: AlmondTemplateStatus
  ): Promise<AdminAlmondTemplateDto> => {
    const response = await client.patch(`${BASE}/${id}/status`, { status });
    return response.data;
  },

  remove: async (id: string): Promise<void> => {
    await client.delete(`${BASE}/${id}`);
  },

  thumbnailUrl: (id: string, version: string): string =>
    `/api/proxy/ugc/admin/almond-templates/${id}/thumbnail.svg?v=${encodeURIComponent(version)}`,
};
