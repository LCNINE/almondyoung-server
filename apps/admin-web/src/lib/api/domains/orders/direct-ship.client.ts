// src/lib/api/domains/orders/direct-ship.client.ts
// ⚠️ forward는 POST, complete는 PUT — 서버 HTTP 메서드 비대칭
// ⚠️ xlsx export 미구현 (BadRequestException) — csv만 사용
// ⚠️ CSV 따옴표 이스케이프 부재 — 상품명에 큰따옴표 포함 시 깨짐
// ⚠️ fo.ownerId가 dropship vendor명으로 오버로드 — 도메인 의미 충돌
// ⚠️ 상태 매핑 손실: allocated≡forwarded, completed≡shipped
// ⚠️ DirectShipOrder.supplierCode / items[].supplierSku / customerInfo 항상 undefined
import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';
import type {
  DirectShipDashboard,
  DirectShipOrder,
  DirectShipCompanySummary,
  ForwardDirectShipOrdersRequest,
  CompleteDirectShipOrdersRequest,
} from '@/lib/types/dto/fulfillment';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/direct-ship`;

export const directShipClient = {
  getDashboard: async (): Promise<DirectShipDashboard> => {
    const res = await client.get(`${BASE}/dashboard`);
    return res.data;
  },

  getCompanies: async (): Promise<Array<{ companyName: string; count: number }>> => {
    const res = await client.get(`${BASE}/companies`);
    return res.data;
  },

  getOrders: async (params?: {
    companyName?: string;
    status?: string;
    warehouseId?: string;
  }): Promise<DirectShipOrder[]> => {
    const res = await client.get(`${BASE}/orders`, { params });
    return res.data;
  },

  getOrdersByCompany: async (): Promise<Record<string, DirectShipOrder[]>> => {
    const res = await client.get(`${BASE}/orders/by-company`);
    return res.data;
  },

  getCompanyOrders: async (
    companyName: string,
    status?: string
  ): Promise<DirectShipOrder[]> => {
    const res = await client.get(
      `${BASE}/companies/${encodeURIComponent(companyName)}/orders`,
      { params: status ? { status } : undefined }
    );
    return res.data;
  },

  getCompanySummary: async (companyName: string): Promise<DirectShipCompanySummary> => {
    const res = await client.get(
      `${BASE}/companies/${encodeURIComponent(companyName)}/summary`
    );
    return res.data;
  },

  forwardOrders: async (data: ForwardDirectShipOrdersRequest): Promise<{ message: string }> => {
    const res = await client.post(`${BASE}/orders/forward`, data);
    return res.data;
  },

  completeOrders: async (data: CompleteDirectShipOrdersRequest): Promise<{ message: string }> => {
    // ⚠️ 서버가 PUT 사용 (forward의 POST와 비대칭)
    const res = await client.put(`${BASE}/orders/complete`, data);
    return res.data;
  },

  exportFile: async (companyName: string): Promise<Blob> => {
    // ⚠️ format=xlsx 시 BadRequestException — csv만 허용
    const res = await client.post(
      `${BASE}/export/file`,
      { companyName, format: 'csv' },
      { responseType: 'blob' }
    );
    return res.data;
  },

  getExportData: async (companyName: string) => {
    const res = await client.get(`${BASE}/export/${encodeURIComponent(companyName)}`);
    return res.data;
  },
};
