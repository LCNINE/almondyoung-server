'use client';

// src/lib/api/domains/orders/sales-order-amendments.client.ts
// 정정 목록 — 응답 정형은 ./sales-order-amendments.shape 가 한다.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import { toAmendmentPage, toAmendmentRecords } from './sales-order-amendments.shape';
import type { AmendmentPage, AmendmentRecord } from './sales-order-amendments.shape';

export const salesOrderAmendmentsClient = {
  list: async (params: { status?: string; origin?: string; limit?: number; cursor?: string }): Promise<AmendmentPage> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/sales-order-amendments`, { params });
    return toAmendmentPage(response.data);
  },
  listForOrder: async (salesOrderId: string): Promise<AmendmentRecord[]> => {
    const response = await client.get(`${ALMONDYOUNG_API_BASE_URL}/sales-orders/${encodeURIComponent(salesOrderId)}/amendments`);
    return toAmendmentRecords(response.data);
  },
};
