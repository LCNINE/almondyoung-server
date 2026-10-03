import type { ApiClient } from '../../core/data/httpClient';
import type { WithdrawalRemoval } from './types';

export interface RemovalResult {
  removedQty: number;
  /** 방금 바구니로 뺀 상품 이름 — 옛 core 에는 없다 */
  removedSkuName?: string;
  exited: boolean;
  exitTo: 'draft' | 'canceled' | null;
  removals: WithdrawalRemoval[];
}

/** 빼는 박스에서 상품 하나를 되돌림 바구니로(스펙 §8). 스캔 한 번 = 하나 — 멱등 키는 스캔 큐의 사건 id 다. */
export function removeToReturnBin(
  api: ApiClient,
  input: { shipmentId: string; barcode: string; returnBinBarcode: string; idempotencyKey: string },
): Promise<RemovalResult> {
  return api.request<RemovalResult>({
    method: 'POST',
    path: `/shipments/${input.shipmentId}/return-bin-removals`,
    body: { barcode: input.barcode, returnBinBarcode: input.returnBinBarcode, quantity: 1 },
    idempotencyKey: input.idempotencyKey,
  });
}

/** 화면 줄 — 박스 몫과 카트 몫(토탈피킹, 분류대에서 뺀다)을 따로. */
export function withdrawalRows(
  removals: WithdrawalRemoval[],
): Array<{ key: string; label: string; qty: number; onCart: boolean }> {
  return removals.flatMap((removal) => {
    const label = `[${removal.locationCode}] ${removal.skuName}`;
    const base = `${removal.shipmentLineId}|${removal.sourceLocationId}`;
    return [
      ...(removal.boxQty > 0 ? [{ key: `${base}|box`, label, qty: removal.boxQty, onCart: false }] : []),
      ...(removal.cartQty > 0 ? [{ key: `${base}|cart`, label, qty: removal.cartQty, onCart: true }] : []),
    ];
  });
}
