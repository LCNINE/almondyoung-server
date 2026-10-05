'use client';

// src/lib/api/domains/orders/order-progress.client.ts
// 정체 보드 — 응답 정형은 ./order-progress.shape 가 한다.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { toProgressPage, toProgressSummary } from './order-progress.shape';
import type { ProgressPage, ProgressSummary } from './order-progress.shape';

export type OrderProgressListParams = {
  stage: string;
  state?: string;
  stuck?: boolean;
  channel?: string;
  sort?: 'dwell' | 'ordered';
  limit?: number;
  cursor?: string;
};

export const orderProgressClient = {
  summary: async (): Promise<ProgressSummary> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/order-progress/summary`);
    return toProgressSummary(response.data);
  },
  list: async (params: OrderProgressListParams): Promise<ProgressPage> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/order-progress/orders`, { params });
    return toProgressPage(response.data);
  },
};
