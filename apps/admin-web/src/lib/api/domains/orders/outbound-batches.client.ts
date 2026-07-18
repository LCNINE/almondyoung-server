'use client';

// src/lib/api/domains/orders/outbound-batches.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  OutboundBatchV2,
  OutboundBatchV2ListItem,
  OutboundBatchV2ListQuery,
  CreateOutboundBatchV2Request,
  OutboundBatchWorkItemV2,
  EligibleShipmentV2,
  ClaimBatchWorkItemRequest,
  HandoffBatchWorkItemRequest,
  OutboundBatchCommandResponse,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/outbound-batches`;

export const outboundBatchesClient = {
  listV2: async (
    query: OutboundBatchV2ListQuery = {}
  ): Promise<OutboundBatchV2ListItem[]> => {
    const res = await client.get(`${BASE}/v2`, { params: query });
    return res.data;
  },

  getV2: async (id: string): Promise<OutboundBatchV2> => {
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}/v2`);
    return res.data;
  },

  createV2: async (
    data: CreateOutboundBatchV2Request,
    idempotencyKey: string
  ): Promise<{ operationId: string; batchId: string }> => {
    const res = await client.post(`${BASE}/v2`, data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return res.data;
  },

  getEligibleShipments: async (id: string): Promise<EligibleShipmentV2[]> => {
    const res = await client.get(
      `${BASE}/${encodeURIComponent(id)}/eligible-shipments`
    );
    return res.data;
  },

  getWorkItems: async (id: string): Promise<OutboundBatchWorkItemV2[]> => {
    const res = await client.get(
      `${BASE}/${encodeURIComponent(id)}/work-items`
    );
    return res.data;
  },

  addShipment: async (
    batchId: string,
    shipmentId: string,
    idempotencyKey: string
  ): Promise<OutboundBatchCommandResponse> => {
    const res = await client.post(
      `${BASE}/${encodeURIComponent(batchId)}/shipments/${encodeURIComponent(shipmentId)}`,
      undefined,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  excludeShipment: async (
    batchId: string,
    shipmentId: string,
    reason: string,
    idempotencyKey: string
  ): Promise<OutboundBatchCommandResponse> => {
    const res = await client.delete(
      `${BASE}/${encodeURIComponent(batchId)}/shipments/${encodeURIComponent(shipmentId)}`,
      { data: { reason }, headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  claimPicker: async (
    workItemId: string,
    data: ClaimBatchWorkItemRequest,
    idempotencyKey: string
  ): Promise<OutboundBatchCommandResponse> => {
    const res = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/batch-work-items/${encodeURIComponent(workItemId)}/picker-claims`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  claimPacker: async (
    workItemId: string,
    data: ClaimBatchWorkItemRequest,
    idempotencyKey: string
  ): Promise<OutboundBatchCommandResponse> => {
    const res = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/batch-work-items/${encodeURIComponent(workItemId)}/packer-claims`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },

  handoffWorkItem: async (
    workItemId: string,
    data: HandoffBatchWorkItemRequest,
    idempotencyKey: string
  ): Promise<OutboundBatchCommandResponse> => {
    const res = await client.post(
      `${ALMONDYOUNG_API_BASE_URL}/batch-work-items/${encodeURIComponent(workItemId)}/handoffs`,
      data,
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return res.data;
  },
};
