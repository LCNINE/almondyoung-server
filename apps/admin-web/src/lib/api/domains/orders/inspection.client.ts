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
  InspectionItem,
  QualityMetrics,
  ScanInspectionRequest,
  InspectByScanRequest,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/inspection`;

export const inspectionClient = {
  startSession: async (
    data: StartInspectionRequest
  ): Promise<InspectionSession> => {
    const res = await client.post(`${BASE}/sessions`, data);
    return res.data;
  },

  getSession: async (sessionId: string): Promise<InspectionSession> => {
    const res = await client.get(
      `${BASE}/sessions/${encodeURIComponent(sessionId)}`
    );
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

  // 검수 바코드 스캔 — 대상 FOI 조회
  scan: async (
    data: ScanInspectionRequest
  ): Promise<{ type: string; foiId: string; data: InspectionItem }> => {
    const res = await client.post(`${BASE}/scan`, data);
    return res.data;
  },

  // 검수 바코드 스캔 — 스캔 1회 = approved +수량 누적
  inspectByScan: async (
    data: InspectByScanRequest
  ): Promise<InspectionItem> => {
    const res = await client.post(`${BASE}/inspect-by-scan`, data);
    return res.data;
  },

  forceShipment: async (
    data: ForceShipmentRequest
  ): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/items/force-shipment`, data);
    return res.data;
  },

  resetInspection: async (
    foiId: string,
    inspectorUserId: string
  ): Promise<{ message: string }> => {
    const res = await client.put(
      `${BASE}/items/${encodeURIComponent(foiId)}/reset?inspectorUserId=${encodeURIComponent(inspectorUserId)}`
    );
    return res.data;
  },

  bulkApprove: async (
    data: BulkApproveRequest
  ): Promise<{ message: string; approvedCount: number }> => {
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
    const res = await client.get(
      `${BASE}/items/${encodeURIComponent(foiId)}/history`
    );
    return res.data;
  },

  getQualityMetrics: async (
    query: QualityMetricsQuery = {}
  ): Promise<QualityMetrics> => {
    const params = new URLSearchParams();
    if (query.warehouseId) params.set('warehouseId', query.warehouseId);
    if (query.dateFrom) params.set('dateFrom', query.dateFrom);
    if (query.dateTo) params.set('dateTo', query.dateTo);
    if (query.inspectorUserId)
      params.set('inspectorUserId', query.inspectorUserId);
    const qs = params.toString();
    const res = await client.get(
      `${BASE}/metrics/quality${qs ? `?${qs}` : ''}`
    );
    return res.data;
  },
};
