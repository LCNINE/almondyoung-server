import type { ApiClient } from '../../core/data/httpClient';

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
  id: string | null;
  barcode: string;
  warehouseId: string;
  items: ReturnBinItem[];
}

export function fetchMyReturnBin(api: ApiClient, warehouseId: string): Promise<ReturnBinContents> {
  const qs = new URLSearchParams({ warehouseId });
  return api.request<ReturnBinContents>({ path: `/return-bins/mine?${qs.toString()}` });
}

export function putawayReturn(
  api: ApiClient,
  input: { binBarcode: string; warehouseId: string; productBarcode: string; locationCode?: string; idempotencyKey: string },
): Promise<{ returnBin: { id: string; barcode: string; warehouseId: string }; putAwayQty: number; items: ReturnBinItem[] }> {
  return api.request({
    method: 'POST',
    path: `/return-bins/${encodeURIComponent(input.binBarcode)}/putaways`,
    body: {
      warehouseId: input.warehouseId,
      barcode: input.productBarcode,
      ...(input.locationCode === undefined ? {} : { locationCode: input.locationCode }),
      quantity: 1,
    },
    idempotencyKey: input.idempotencyKey,
  });
}
