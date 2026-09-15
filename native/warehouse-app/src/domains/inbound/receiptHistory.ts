import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../core/data/ApiClientProvider';
import {
  receiptActionBlockReasons,
  type ReceiptActionBlockReason,
} from './receiptState';
export class ReceiptHistoryError extends Error {}
export type ReceiptStatus = 'posted' | 'voided' | 'all';
export interface ReceiptHistoryLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: number;
  source: 'direct' | 'purchase_order';
  originLocationCode: string | null;
  originLocationId?: string | null;
  canceledQty: number;
  returnedQty: number;
  putawayFromOriginQty: number;
  pendingQty?: number;
  canPutaway?: boolean;
  putawayBlockReason?: ReceiptActionBlockReason | null;
  canCancel: boolean;
  cancelBlockReason: string | null;
}
export interface ReceiptHistoryItem {
  id: string;
  warehouseId: string;
  method: string;
  occurredAt: string;
  status: 'posted' | 'voided';
  totalQuantity: number;
  lines: ReceiptHistoryLine[];
}
export interface ReceiptHistoryResult {
  total: number;
  serverTime: string;
  items: ReceiptHistoryItem[];
}
export interface ReceiptHistoryParams {
  warehouseId: string;
  skuId?: string;
  receiptId?: string;
  startDate?: string;
  endDate?: string;
  status: ReceiptStatus;
  limit: number;
  offset: number;
}
export function seoulDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 10);
}
export function recentReceiptDates(now = new Date()) {
  return {
    startDate: seoulDate(new Date(now.getTime() - 6 * 86400000)),
    endDate: seoulDate(now),
  };
}
export function receiptHistoryPath(params: ReceiptHistoryParams) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  return `/inbound/receipts?${query}`;
}
export function validateReceiptHistory(
  value: unknown
): asserts value is ReceiptHistoryResult {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const count = (v: unknown) =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const date = (v: unknown) =>
    typeof v === 'string' && Number.isFinite(Date.parse(v));
  if (
    !object(value) ||
    !count(value.total) ||
    !date(value.serverTime) ||
    !Array.isArray(value.items) ||
    !value.items.every(
      (item) =>
        object(item) &&
        typeof item.id === 'string' &&
        typeof item.warehouseId === 'string' &&
        typeof item.method === 'string' &&
        date(item.occurredAt) &&
        ['posted', 'voided'].includes(String(item.status)) &&
        count(item.totalQuantity) &&
        Array.isArray(item.lines) &&
        item.lines.every(
          (line) =>
            object(line) &&
            typeof line.id === 'string' &&
            typeof line.skuId === 'string' &&
            typeof line.skuCode === 'string' &&
            typeof line.skuName === 'string' &&
            ['direct', 'purchase_order'].includes(String(line.source)) &&
            count(line.quantity) &&
            count(line.canceledQty) &&
            count(line.returnedQty) &&
            count(line.putawayFromOriginQty) &&
            typeof line.canCancel === 'boolean' &&
            (line.pendingQty === undefined ||
              (typeof line.pendingQty === 'number' &&
                Number.isSafeInteger(line.pendingQty))) &&
            (line.canPutaway === undefined ||
              typeof line.canPutaway === 'boolean') &&
            (line.putawayBlockReason === undefined ||
              line.putawayBlockReason === null ||
              receiptActionBlockReasons.includes(
                line.putawayBlockReason as ReceiptActionBlockReason
              )) &&
            (line.originLocationId === undefined ||
              line.originLocationId === null ||
              typeof line.originLocationId === 'string') &&
            (line.originLocationCode === null ||
              typeof line.originLocationCode === 'string') &&
            (line.cancelBlockReason === null ||
              typeof line.cancelBlockReason === 'string')
        )
    )
  )
    throw new ReceiptHistoryError(
      '입고내역을 확인할 수 없어요. 서버 연결과 업데이트를 확인해 주세요.'
    );
}
export function useReceiptHistory(params: ReceiptHistoryParams) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['inbound-receipts', params],
    enabled: !!params.warehouseId,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const result = await api.request<unknown>({
        path: receiptHistoryPath(params),
      });
      validateReceiptHistory(result);
      if (result.items.some((item) => item.warehouseId !== params.warehouseId))
        throw new ReceiptHistoryError(
          '선택 창고와 다른 입고내역이에요. 다시 확인해 주세요.'
        );
      return result;
    },
  });
}
