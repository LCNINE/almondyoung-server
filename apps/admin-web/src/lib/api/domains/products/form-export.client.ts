'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  FormExportAccepted,
  FormExportStatus,
  FormExportDownloadUrl,
} from '@/lib/types/dto/form-export';
import { client } from '../../client';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/product-forms`;

export const formExportClient = {
  request: async (masterIds: string[]): Promise<FormExportAccepted> => {
    const res = await client.post(BASE, { masterIds });
    return res.data;
  },

  getStatus: async (exportId: string): Promise<FormExportStatus> => {
    const res = await client.get(`${BASE}/${exportId}`);
    return res.data;
  },

  getDownloadUrl: async (exportId: string): Promise<FormExportDownloadUrl> => {
    const res = await client.get(`${BASE}/${exportId}/download-url`);
    return res.data;
  },
};
