import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../core/data/httpClient';
import { removeToReturnBin, withdrawalRows } from './withdraw';

describe('뺄 상품', () => {
  it('상품 스캔 한 번 = 하나를 바구니로 — 멱등 키와 함께 보낸다', async () => {
    const calls: unknown[] = [];
    const api = {
      request: async (o: unknown) => {
        calls.push(o);
        return { removedQty: 1, exited: false, exitTo: 'draft', removals: [] };
      },
    } as unknown as ApiClient;
    await removeToReturnBin(api, { shipmentId: 's-1', barcode: '880', returnBinBarcode: 'RB-1', idempotencyKey: 'k-1' });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/shipments/s-1/return-bin-removals',
        body: { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
        idempotencyKey: 'k-1',
      },
    ]);
  });

  it('줄은 [로케이션] 상품명, 카트 몫은 따로 표시한다', () => {
    const base = { shipmentLineId: 'l', skuId: 's', skuCode: 'C', skuName: '볼펜', sourceLocationId: 'loc', locationCode: 'A-01' };
    expect(withdrawalRows([{ ...base, boxQty: 2, cartQty: 1 }])).toEqual([
      { key: 'l|loc|box', label: '[A-01] 볼펜', qty: 2, onCart: false },
      { key: 'l|loc|cart', label: '[A-01] 볼펜', qty: 1, onCart: true },
    ]);
  });
});
