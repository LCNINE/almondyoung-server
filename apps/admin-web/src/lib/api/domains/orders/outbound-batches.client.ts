'use client';

// src/lib/api/domains/orders/outbound-batches.client.ts
// ⚠️ GET /outbound-batches/available/fulfillment-orders 에 warehouseId 누락 시 raw Error → 500
// ⚠️ priority 정렬이 enum 알파벳 순(urgent>normal>high) — 서버 버그, 클라이언트에서 보정
// ⚠️ PickingListAggregateItem.locationCode 항상 undefined — 서버 미구현
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  OutboundBatch,
  OutboundBatchDetail,
  PickingListAggregateItem,
  AvailableFulfillmentOrder,
  CreateOutboundBatchRequest,
  CreateOutboundBatchResponse,
  AddFOsToBatchRequest,
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
  list: async (warehouseId?: string): Promise<OutboundBatch[]> => {
    const res = await client.get(BASE, {
      params: warehouseId ? { warehouseId } : undefined,
    });
    return res.data;
  },

  get: async (id: string): Promise<OutboundBatchDetail> => {
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return res.data;
  },

  getPickingList: async (id: string): Promise<PickingListAggregateItem[]> => {
    const res = await client.get(
      `${BASE}/${encodeURIComponent(id)}/picking-list`
    );
    return res.data;
  },

  getAvailableFulfillmentOrders: async (
    warehouseId: string
  ): Promise<AvailableFulfillmentOrder[]> => {
    const res = await client.get(`${BASE}/available/fulfillment-orders`, {
      params: { warehouseId },
    });
    return res.data;
  },

  create: async (
    data: CreateOutboundBatchRequest
  ): Promise<CreateOutboundBatchResponse> => {
    const res = await client.post(BASE, data);
    return res.data;
  },

  addFulfillmentOrders: async (
    id: string,
    data: AddFOsToBatchRequest
  ): Promise<{ message: string }> => {
    const res = await client.post(
      `${BASE}/${encodeURIComponent(id)}/fulfillment-orders`,
      data
    );
    return res.data;
  },

  removeFulfillmentOrder: async (
    id: string,
    foId: string
  ): Promise<{ message: string }> => {
    const res = await client.delete(
      `${BASE}/${encodeURIComponent(id)}/fulfillment-orders/${encodeURIComponent(foId)}`
    );
    return res.data;
  },

  startPicking: async (id: string): Promise<{ message: string }> => {
    const res = await client.post(
      `${BASE}/${encodeURIComponent(id)}/start-picking`
    );
    return res.data;
  },

  complete: async (id: string): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/complete`);
    return res.data;
  },

  cancel: async (id: string): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/cancel`);
    return res.data;
  },
};
