'use client';

import { UGC_SERVICE_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  AdminAlmondDesignDto,
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

const DESIGNS = `${UGC_SERVICE_BASE_URL}/admin/almond-designs`;

export type AlmondPrintFormat = 'pdf' | 'eps' | 'jpg';

export const almondDesignsClient = {
  get: async (id: string): Promise<AdminAlmondDesignDto> => {
    const response = await client.get(`${DESIGNS}/${id}`);
    return response.data;
  },

  previewUrl: (id: string, side: 'front' | 'back'): string =>
    `/api/proxy/ugc/admin/almond-designs/${id}/preview/${side}.jpg`,

  printLink: async (
    id: string,
    format: AlmondPrintFormat,
    dpi?: number
  ): Promise<{ url: string; expiresAt: string; fileName: string }> => {
    const response = await client.get(`${DESIGNS}/${id}/print-link`, {
      params: { format, ...(dpi ? { dpi } : {}) },
      timeout: 60000,
    });
    return response.data;
  },
};
