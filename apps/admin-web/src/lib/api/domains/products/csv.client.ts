'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { CsvImportResultDto } from '@/lib/types/dto/products';
import { client } from '../../client';

export const csvClient = {
  getTemplate: async (): Promise<Blob> => {
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/csv/template`,
      { responseType: 'blob' }
    );
    return response.data;
  },

  bulkImport: async (
    file: File,
    userId: string
  ): Promise<CsvImportResultDto> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);

    const response = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/products/csv/bulk-import`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  },

  export: async (productIds?: string[]): Promise<Blob> => {
    const params = productIds?.length
      ? `?productIds=${productIds.join(',')}`
      : '';
    const response = await client.get(
      `${ALMONDYOUNG_API_BASE_URL}/products/csv/export${params}`,
      { responseType: 'blob' }
    );
    return response.data;
  },
};
