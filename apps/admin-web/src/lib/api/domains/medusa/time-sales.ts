'use client';

import { MEDUSA_BASE_URL } from '@/const';
import type { TimeSaleWriteBody } from '@/features/mall/marketing/time-sale/time-sale-model';
import { client } from '../../client';

/**
 * 어드민이 보는 타임세일. Medusa `time_sale` 모듈이 세일 단위이고, 저장은 라우트 한 번이 서버 워크플로로
 * 끝낸다 — 브라우저가 price list API 를 여러 번 부르다 중간에 멈추면 세일이 반쯤 바뀐 채 남았다(10-09).
 */
export interface AdminTimeSale {
  id: string;
  title: string;
  status: 'draft' | 'active';
  startsAt: string;
  endsAt: string;
  productIds: string[];
  /** variant id → 일반용 세일가. */
  generalPrices: Record<string, number>;
  /** variant id → 멤버십용 세일가. */
  membershipPrices: Record<string, number>;
}

const BASE = `${MEDUSA_BASE_URL}/admin/time-sales`;

export const medusaTimeSalesApi = {
  list: async () => (await client.get<{ timeSales: AdminTimeSale[] }>(BASE)).data.timeSales,
  get: async (id: string) => (await client.get<{ timeSale: AdminTimeSale }>(`${BASE}/${id}`)).data.timeSale,
  create: async (body: TimeSaleWriteBody) =>
    (await client.post<{ timeSale: AdminTimeSale }>(BASE, body)).data.timeSale,
  update: async (id: string, body: TimeSaleWriteBody) =>
    (await client.post<{ timeSale: AdminTimeSale }>(`${BASE}/${id}`, body)).data.timeSale,
  remove: async (id: string) => {
    await client.delete(`${BASE}/${id}`);
  },
};
