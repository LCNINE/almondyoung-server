'use client';

// src/lib/api/domains/orders/fulfillments.client.ts
// Canonical client for Core GET/POST /fulfillments endpoints.
// Replaces the deprecated /fulfillment-orders creation path.

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  FulfillmentOrder,
  FulfillmentOrderDetail,
  FulfillmentOutboxEvent,
  ListFulfillmentsQuery,
  CreateFulfillmentOrderRequest,
  SplitFulfillmentOrderRequest,
  ReserveRequest,
  UnreserveRequest,
  TransferReservationRequest,
  TransferCandidate,
  AssignShipmentRequest,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/fulfillments`;

export const fulfillmentsClient = {
  list: async (params?: ListFulfillmentsQuery): Promise<FulfillmentOrder[]> => {
    const res = await client.get(BASE, { params });
    return res.data;
  },

  get: async (id: string): Promise<FulfillmentOrderDetail> => {
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}`);
    return res.data;
  },

  getOutboxEvents: async (id: string): Promise<FulfillmentOutboxEvent[]> => {
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}/outbox-events`);
    return res.data;
  },

  create: async (data: CreateFulfillmentOrderRequest): Promise<FulfillmentOrder> => {
    const res = await client.post(BASE, data);
    return res.data;
  },

  split: async (id: string, data: SplitFulfillmentOrderRequest): Promise<FulfillmentOrder> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/split`, data);
    return res.data;
  },

  checkAvailability: async (id: string): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/check-availability`);
    return res.data;
  },

  reserve: async (id: string, data: ReserveRequest): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/reserve`, data);
    return res.data;
  },

  unreserve: async (id: string, data: UnreserveRequest): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/unreserve`, data);
    return res.data;
  },

  transferReservation: async (id: string, data: TransferReservationRequest): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/transfer-reservation`, data);
    return res.data;
  },

  getTransferCandidates: async (
    id: string,
    fromFulfillmentOrderItemId: string,
  ): Promise<TransferCandidate[]> => {
    const res = await client.get(`${BASE}/${encodeURIComponent(id)}/transfer-candidates`, {
      params: { fromFulfillmentOrderItemId },
    });
    return res.data;
  },

  assignShipment: async (id: string, data: AssignShipmentRequest): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/assign-shipment`, data);
    return res.data;
  },

  ship: async (id: string): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/ship`);
    return res.data;
  },

  deliver: async (id: string): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/deliver`);
    return res.data;
  },

  cancel: async (id: string): Promise<unknown> => {
    const res = await client.post(`${BASE}/${encodeURIComponent(id)}/cancel`);
    return res.data;
  },
};
