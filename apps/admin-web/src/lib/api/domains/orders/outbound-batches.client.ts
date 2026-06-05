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
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/outbound-batches`;

export const outboundBatchesClient = {
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
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}/picking-list`);
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

  create: async (data: CreateOutboundBatchRequest): Promise<CreateOutboundBatchResponse> => {
    const res = await client.post(BASE, data);
    return res.data;
  },

  addFulfillmentOrders: async (
    id: string,
    data: AddFOsToBatchRequest
  ): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/fulfillment-orders`, data);
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
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/start-picking`);
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
