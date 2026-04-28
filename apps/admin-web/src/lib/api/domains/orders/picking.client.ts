// src/lib/api/domains/orders/picking.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  BatchPickRequest,
  PickByBarcodeRequest,
  PickIndividualItemRequest,
  ScanBarcodeRequest,
  GenerateBarcodeRequest,
  PickingOperation,
  PickingProgress,
  PickingSession,
  GenerateBarcodeResponse,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/picking`;

export const pickingClient = {
  getBatchOperations: async (batchId: string): Promise<PickingOperation[]> => {
    const res = await client.get(`${BASE}/batches/${encodeURIComponent(batchId)}/operations`);
    return res.data;
  },

  getBatchProgress: async (batchId: string): Promise<PickingProgress> => {
    const res = await client.get(`${BASE}/batches/${encodeURIComponent(batchId)}/progress`);
    return res.data;
  },

  batchPick: async (data: BatchPickRequest): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/batch-pick`, data);
    return res.data;
  },

  startIndividualPicking: async (foId: string): Promise<PickingSession> => {
    const res = await client.post(`${BASE}/fulfillment-orders/${encodeURIComponent(foId)}/start`);
    return res.data;
  },

  // ⚠️ 서버에서 GET session이 startIndividualPicking을 내부 호출 — side-effect 있음.
  // UI에서 명시적 "시작" 버튼을 통해서만 호출할 것.
  getPickingSession: async (foId: string): Promise<PickingSession> => {
    const res = await client.get(`${BASE}/fulfillment-orders/${encodeURIComponent(foId)}/session`);
    return res.data;
  },

  pickIndividualItem: async (
    foiId: string,
    data: PickIndividualItemRequest
  ): Promise<{ message: string }> => {
    const res = await client.post(
      `${BASE}/fulfillment-order-items/${encodeURIComponent(foiId)}/pick`,
      data
    );
    return res.data;
  },

  completeIndividualPicking: async (foId: string): Promise<{ message: string }> => {
    const res = await client.post(
      `${BASE}/fulfillment-orders/${encodeURIComponent(foId)}/complete`
    );
    return res.data;
  },

  resetPickingForItem: async (foiId: string): Promise<{ message: string }> => {
    const res = await client.put(
      `${BASE}/fulfillment-order-items/${encodeURIComponent(foiId)}/reset`
    );
    return res.data;
  },

  scanBarcode: async (data: ScanBarcodeRequest) => {
    const res = await client.post(`${BASE}/scan`, data);
    return res.data;
  },

  pickByBarcodeScan: async (data: PickByBarcodeRequest): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/pick-by-scan`, data);
    return res.data;
  },

  generateBarcode: async (data: GenerateBarcodeRequest): Promise<GenerateBarcodeResponse> => {
    const res = await client.post(`${BASE}/generate-barcode`, data);
    return res.data;
  },
};
