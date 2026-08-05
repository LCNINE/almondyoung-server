'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  FormExportAccepted,
  FormExportStatus,
  FormExportDownloadUrl,
  FormExportList,
} from '@/lib/types/dto/form-export';
import { client } from '../../client';
import { fetchWithRefresh } from '../../fetch-with-refresh';

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

  list: async (page: number, limit: number): Promise<FormExportList> => {
    const res = await client.get(BASE, { params: { page, limit } });
    return res.data;
  },

  retry: async (exportId: string): Promise<FormExportAccepted> => {
    const res = await client.post(`${BASE}/${exportId}/retry`);
    return res.data;
  },

  getDownloadUrl: async (exportId: string): Promise<FormExportDownloadUrl> => {
    const res = await client.get(`${BASE}/${exportId}/download-url`);
    return res.data;
  },

  /**
   * 빈 양식을 내려받는다. 잡도 폴링도 없는 동기 다운로드다.
   *
   * axios 를 쓰지 않는다 — 응답이 xlsx 바이너리라 envelope unwrap 인터셉터가
   * 다룰 대상이 아니고, blob 처리를 fetch 로 하는 편이 짧다.
   */
  downloadBlank: async (): Promise<Blob> => {
    const res = await fetchWithRefresh(`/api${BASE}/blank`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`빈 양식을 내려받지 못했습니다. (status: ${res.status})`);
    }
    return res.blob();
  },
};
