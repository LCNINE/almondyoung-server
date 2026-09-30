import { ApiError, type ApiClient } from '../../core/data/httpClient';

export interface ReturnBinItem {
  skuId: string;
  skuCode: string;
  skuName: string;
  sourceLocationId: string;
  /** 원래 로케이션 — 되돌림 적치는 여기만 받는다. */
  locationCode: string;
  qty: number;
}

export interface ReturnBinContents {
  id: string;
  barcode: string;
  warehouseId: string;
  items: ReturnBinItem[];
}

export function fetchReturnBin(api: ApiClient, barcode: string, warehouseId: string): Promise<ReturnBinContents> {
  const qs = new URLSearchParams({ warehouseId });
  return api.request<ReturnBinContents>({ path: `/return-bins/${encodeURIComponent(barcode.trim())}?${qs.toString()}` });
}

export function registerReturnBin(
  api: ApiClient,
  input: { warehouseId: string; barcode: string },
): Promise<{ id: string; barcode: string; warehouseId: string }> {
  return api.request({ method: 'POST', path: '/return-bins', body: { warehouseId: input.warehouseId, barcode: input.barcode.trim() } });
}

export function isUnknownReturnBin(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'RETURN_BIN_UNKNOWN';
}
