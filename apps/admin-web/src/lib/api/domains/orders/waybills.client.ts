'use client';

// src/lib/api/domains/orders/waybills.client.ts
// Core waybill(운송장) 발급 계열 엔드포인트 클라이언트.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  WaybillResponse,
  BatchResultItem,
  IssueWaybillRequest,
  ReissueWaybillRequest,
  RegisterManualWaybillRequest,
  IssueBatchWaybillRequest,
  VoidWaybillRequest,
  AbandonWaybillRequest,
  WaybillSenderPreview,
} from '@/lib/types/dto/fulfillment';

const BASE = ALMONDYOUNG_API_BASE_URL;
// 서버가 한 번에 받는 상자 수
const SENDER_PREVIEW_CHUNK = 100;
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
    data: ReissueWaybillRequest,
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

  // 멈춘 발급(pending/allocated)을 종료시켜 활성 슬롯을 푼다 — 그래야 다시 발급할 수 있다.
  abandon: async (
    waybillId: string,
    data: AbandonWaybillRequest,
    idempotencyKey: string
  ): Promise<WaybillResponse> => {
    const res = await client.post(
      `${BASE}/waybills/${encodeURIComponent(waybillId)}/abandon`,
      data,
      idem(idempotencyKey)
    );
    return res.data;
  },

  // 읽기다. 고른 상자가 많아 본문으로 보낸다 — 서버 한도에 맞춰 나눠 묻는다
  senderPreview: async (
    shipmentIds: readonly string[]
  ): Promise<WaybillSenderPreview[]> => {
    const chunks: string[][] = [];
    for (let i = 0; i < shipmentIds.length; i += SENDER_PREVIEW_CHUNK) {
      chunks.push(shipmentIds.slice(i, i + SENDER_PREVIEW_CHUNK));
    }
    const results = await Promise.all(
      chunks.map((ids) =>
        client.post<WaybillSenderPreview[]>(`${BASE}/waybills/sender-preview`, {
          shipmentIds: ids,
        })
      )
    );
    return results.flatMap((res) => res.data);
  },

  getActive: async (shipmentId: string): Promise<WaybillResponse> => {
    const res = await client.get(
      `${BASE}/shipments/${encodeURIComponent(shipmentId)}/waybill`
    );
    return res.data;
  },
};
