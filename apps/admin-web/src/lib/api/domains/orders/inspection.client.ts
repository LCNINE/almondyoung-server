'use client';

// src/lib/api/domains/orders/inspection.client.ts
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  StartInspectionRequest,
  CompleteInspectionSessionRequest,
  InspectItemRequest,
  ForceShipmentRequest,
  BulkApproveRequest,
  QualityMetricsQuery,
  InspectionSession,
  InspectionSummary,
  InspectionHistoryItem,
  QualityMetrics,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inspection`;

export const inspectionClient = {
  startSession: async (data: StartInspectionRequest): Promise<InspectionSession> => {
    const res = await client.post(`${BASE}/sessions`, data);
    return res.data;
  },

  completeSession: async (
    sessionId: string,
    data: CompleteInspectionSessionRequest
  ): Promise<{ message: string }> => {
    const res = await client.post(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}/complete`,
      data
    );
    return res.data;
  },

  inspectItem: async (data: InspectItemRequest) => {
    const res = await client.post(`${BASE}/items/inspect`, data);
    return res.data;
  },

  forceShipment: async (data: ForceShipmentRequest): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/items/force-shipment`, data);
    return res.data;
  },

  // ⚠️ 서버의 resetInspection이 throw new Error 사용 (Nest 표준 예외 미사용) → 500으로 노출될 수 있음.
  resetInspection: async (
    foiId: string,
    inspectorUserId: string
  ): Promise<{ message: string }> => {
    const res = await client.put(
      `${BASE}/items/${encodeURIComponent(foiId)}/reset?inspectorUserId=${encodeURIComponent(inspectorUserId)}`
    );
    return res.data;
  },

  bulkApprove: async (data: BulkApproveRequest): Promise<{ message: string; approvedCount: number }> => {
    const res = await client.post(`${BASE}/items/bulk-approve`, data);
    return res.data;
  },

  getSummary: async (foId: string): Promise<InspectionSummary> => {
    const res = await client.get(
      `${BASE}/fulfillment-orders/${encodeURIComponent(foId)}/summary`
    );
    return res.data;
  },

  getHistory: async (foiId: string): Promise<InspectionHistoryItem[]> => {
    const res = await client.get(`${BASE}/items/${encodeURIComponent(foiId)}/history`);
    return res.data;
  },

  getQualityMetrics: async (query: QualityMetricsQuery = {}): Promise<QualityMetrics> => {
    const params = new URLSearchParams();
    if (query.warehouseId) params.set('warehouseId', query.warehouseId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.inspectorUserId) params.set('inspectorUserId', query.inspectorUserId);
    const qs = params.toString();
    const res = await client.get(`${BASE}/metrics/quality${qs ? `?${qs}` : ''}`);
    return res.data;
  },
};
