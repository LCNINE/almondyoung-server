'use client';

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import { client } from '../../client';

const BASE = `${ALMONDYOUNG_API_BASE_URL}/admin/print-orders`;

export type PrintOrderStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'shipped'
  | 'delivered'
  | 'failed'
  | 'unsupported'
  | 'cancelling'
  | 'cancelled'
  | 'cancel_refused';

export type PrintOrderTab =
  | 'cancel_refused'
  | 'test_pending'
  | 'failed'
  | 'unsupported'
  | 'all';

export const PRINT_ORDER_STATUSES: PrintOrderStatus[] = [
  'pending',
  'submitting',
  'submitted',
  'shipped',
  'delivered',
  'failed',
  'unsupported',
  'cancelling',
  'cancelled',
  'cancel_refused',
];

export function isPrintOrderStatus(value: string): value is PrintOrderStatus {
  return value in PRINT_ORDER_STATUS_LABEL;
}

export const PRINT_ORDER_STATUS_LABEL: Record<PrintOrderStatus, string> = {
  pending: '발주 대기',
  submitting: '발주 중',
  submitted: '제작 접수',
  shipped: '배송 중',
  delivered: '배송 완료',
  failed: '발주 실패',
  unsupported: '미지원 품목',
  cancelling: '취소 진행 중',
  cancelled: '취소됨',
  cancel_refused: '취소 거절',
};

export interface PrintOrder {
  id: string;
  salesOrderId: string;
  salesOrderLineId: string;
  almondDesignId: string;
  vendor: string;
  status: PrintOrderStatus;
  testMemo: boolean;
  vendorOrderNumber: string | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string;
  submittingAt: string | null;
  orderAttemptedAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  testConfirmedAt: string | null;
  testConfirmedBy: string | null;
  testNote: string | null;
  cancelRefusedAt: string | null;
  cancelResolvedAt: string | null;
  cancelResolvedBy: string | null;
  createdAt: string;
  salesCancelFailedAt: string | null;
  updatedAt: string;
}

export interface PrintOrderBoardItem extends PrintOrder {
  channelOrderId: string;
  displayOrderNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productName: string;
  retryBlocked: boolean;
  needsWowpressCheck: boolean;
  resolvable: boolean;
  salesCancelFailed: boolean;
}

export interface PrintOrderSummary {
  cancelRefused: number;
  testPending: number;
  failed: number;
  unsupported: number;
  total: number;
}

export interface PrintOrderListResponse {
  items: PrintOrderBoardItem[];
  total: number;
}

export interface ResolveCancelResponse {
  printOrder: PrintOrder;
  salesCancel: object | null;
}

export const PRINT_ORDER_PAGE_SIZE = 50;

export const printOrdersClient = {
  summary: async (): Promise<PrintOrderSummary> => {
    const res = await client.get(`${BASE}/summary`);
    return res.data;
  },

  list: async (params: {
    tab: PrintOrderTab;
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PrintOrderListResponse> => {
    const res = await client.get(BASE, { params });
    return res.data;
  },

  byDesign: async (almondDesignId: string): Promise<PrintOrderBoardItem[]> => {
    const res = await client.get(`${BASE}/by-design/${almondDesignId}`);
    return res.data;
  },

  byLine: async (lineId: string): Promise<PrintOrderBoardItem | null> => {
    const res = await client.get(`${BASE}/by-line/${lineId}`, {
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
    });
    return res.status === 404 ? null : res.data;
  },

  retry: async (
    id: string,
    confirmNoWowpressOrder: boolean
  ): Promise<PrintOrder> => {
    const res = await client.post(`${BASE}/${id}/retry`, {
      confirmNoWowpressOrder,
    });
    return res.data;
  },

  confirmTest: async (id: string, note: string): Promise<PrintOrder> => {
    const res = await client.post(`${BASE}/${id}/confirm-test`, { note });
    return res.data;
  },

  resolveCancel: async (
    id: string,
    outcome: 'cancelled' | 'proceed'
  ): Promise<ResolveCancelResponse> => {
    const res = await client.post(`${BASE}/${id}/resolve-cancel`, { outcome });
    return res.data;
  },
};
