'use client';

// 택배사 접수 대사 — 우리는 출고했는데 택배사는 어떻게 알고 있는지

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

export type CarrierAttentionKind =
  | 'recalled_but_moving'
  | 'invalid_waybill'
  | 'canceled'
  | 'pickup_missed'
  | 'undeliverable'
  | 'not_applied'
  | 'no_scan'
  | 'unverified'
  | 'poll_ended';

export interface CarrierTrackingConfirmation {
  id: string;
  kind: string;
  outcome: 'wait' | 'closed';
  resumeAt: string | null;
  note: string;
  actorId: string;
  createdAt: string;
}

export interface CarrierTrackingItem {
  dispatchAttemptId: string;
  attemptNo: number;
  shipmentId: string;
  carrier: string;
  trackingNo: string;
  orders: { salesOrderId: string; orderNo: string; channelOrderId: string }[];
  kind: CarrierAttentionKind | null;
  raised: boolean;
  accepted: boolean;
  recalled: boolean;
  dispatchedAt: string;
  dueAt: string;
  attemptedAt: string | null;
  answeredAt: string | null;
  lastOutcome: 'scans' | 'no_scan' | 'rejected' | 'unknown' | null;
  scan: {
    code: string;
    status: string;
    at: string;
    location: string | null;
    reason: string | null;
  } | null;
  scanKey: string;
  confirmations: CarrierTrackingConfirmation[];
}

export interface CarrierTrackingSummary {
  attention: number;
  polling: { lastAnsweredAt: string | null; failing: boolean };
}

export interface CarrierTrackingAttention extends CarrierTrackingSummary {
  waiting: number;
  items: CarrierTrackingItem[];
}

export interface ConfirmCarrierTrackingRequest {
  outcome: 'wait' | 'closed';
  note: string;
  expectedKind: CarrierAttentionKind;
  expectedScanKey: string;
  expectedConfirmationId: string | null;
}

const BASE = `${ALMONDYOUNG_API_BASE_URL}/carrier-tracking`;
const attemptPath = (id: string) =>
  `${BASE}/attempts/${encodeURIComponent(id)}`;

export const carrierTrackingClient = {
  summary: async (): Promise<CarrierTrackingSummary> =>
    (await client.get(`${BASE}/attention/summary`)).data,

  attention: async (): Promise<CarrierTrackingAttention> =>
    (await client.get(`${BASE}/attention`)).data,

  shipment: async (
    shipmentId: string
  ): Promise<{ items: CarrierTrackingItem[] }> =>
    (await client.get(`${BASE}/shipments/${encodeURIComponent(shipmentId)}`))
      .data,

  recheck: async (
    dispatchAttemptId: string
  ): Promise<{ items: CarrierTrackingItem[] }> =>
    (await client.post(`${attemptPath(dispatchAttemptId)}/checks`)).data,

  confirm: async (
    dispatchAttemptId: string,
    data: ConfirmCarrierTrackingRequest,
    idempotencyKey: string
  ): Promise<{ confirmationId: string; resumeAt: string | null }> =>
    (
      await client.post(
        `${attemptPath(dispatchAttemptId)}/confirmations`,
        data,
        { headers: { 'Idempotency-Key': idempotencyKey } }
      )
    ).data,
};
