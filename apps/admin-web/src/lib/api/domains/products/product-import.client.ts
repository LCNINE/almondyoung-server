'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type {
  ValidatePreviewDto,
  CommitResultDto,
  SessionDetailDto,
  SessionListResponse,
  PublishResultDto,
} from '@/lib/types/dto/product-import';
import { client } from '../../client';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/product-imports`;

export const productImportClient = {
  downloadTemplate: async (): Promise<Blob> => {
    const res = await client.get(`${BASE}/template`, { responseType: 'blob' });
    return res.data;
  },

  validate: async (file: File): Promise<ValidatePreviewDto> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await client.post(`${BASE}/validate`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  commit: async (file: File): Promise<CommitResultDto> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await client.post(`${BASE}/commit`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  getSessions: async (
    page: number,
    limit: number
  ): Promise<SessionListResponse> => {
    const res = await client.get(BASE, { params: { page, limit } });
    return res.data;
  },

  getSession: async (sessionId: string): Promise<SessionDetailDto> => {
    const res = await client.get(`${BASE}/${sessionId}`);
    return res.data;
  },

  publish: async (sessionId: string): Promise<PublishResultDto> => {
    const res = await client.post(`${BASE}/${sessionId}/publish`);
    return res.data;
  },
};
