'use client';

// src/lib/api/domains/orders/waybills.client.ts
// Core waybill(운송장) 발급 계열 엔드포인트 클라이언트.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  WaybillResponse,
  BatchResultItem,
  IssueWaybillRequest,
  RegisterManualWaybillRequest,
  IssueBatchWaybillRequest,
  VoidWaybillRequest,
} from '@/lib/types/dto/fulfillment';

const BASE = ALMONDYOUNG_API_BASE_URL;
const idem = (idempotencyKey: string) => ({
  headers: { 'Idempotency-Key': idempotencyKey },
});

export const waybillsClient = {
  issue: async (
    shipmentId: string,
    data: IssueWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  manual: async (
    shipmentId: string,
    data: RegisterManualWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills/manual`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  reissue: async (
    shipmentId: string,
    data: IssueWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybills/reissue`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  batch: async (
    data: IssueBatchWaybillRequest,
    idempotencyKey: string
  ): Promise<BatchResultItem[]> => {
    const res = await client.post(
      `${BASE}/waybills:batch`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  void: async (
    waybillId: string,
    data: VoidWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/waybills/${encodeURIComponent(waybillId)}/void`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  getActive: async (shipmentId: string): Promise<WaybillResponse> => {
    const res = await client.get(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybill`
    );
    return res.data;
  },
};
