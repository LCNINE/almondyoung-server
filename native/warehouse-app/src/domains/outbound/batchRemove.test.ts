import { describe, expect, it } from 'vitest';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import { removeBoxFromBatch } from './batchRemove';
import type { ShipmentByWaybill } from './types';

function fakeApi(handler: (o: { method?: string; path: string; body?: unknown }) => unknown) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const api: ApiClient = {
    request: (async (o: { method?: string; path: string; body?: unknown }) => {
      calls.push({ method: o.method ?? 'GET', path: o.path, body: o.body });
      return handler(o);
    }) as ApiClient['request'],
  };
  return { api, calls };
}

describe('removeBoxFromBatch', () => {
  const found = (over: Partial<ShipmentByWaybill> = {}): ShipmentByWaybill => ({
    shipmentId: 's-1', batchId: 'b-1', workItemId: 'wi-1', warehouseId: 'wh', trackingNo: '1', carrier: 'HANJIN',
    waybillStatus: 'registered', shipmentStatus: 'planned', workItemStatus: 'queued', recipientMasked: '', lines: [],
    labelState: 'current', labelChanges: [], labelIssue: null, ...over,
  });

  it('송장번호로 박스를 찾아 사유와 함께 뺀다', async () => {
    const { api, calls } = fakeApi((o) => (o.path.startsWith('/shipments/by-waybill') ? found() : {}));
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: '고객 요청' });
    expect(calls[1]).toEqual({ method: 'DELETE', path: '/outbound-batches/b-1/shipments/s-1', body: { reason: '고객 요청' } });
    expect(outcome).toEqual({ kind: 'removed', message: '박스를 뺐어요. 이 박스의 송장은 버려 주세요.' });
  });

  it('다른 배치의 박스면 보내지 않는다', async () => {
    const { api, calls } = fakeApi(() => found({ batchId: 'b-2' }));
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({ kind: 'blocked', message: '이 배치에 있는 박스가 아니에요.' });
    expect(calls).toHaveLength(1);
  });

  it('집은 몫이 있으면 거절 문구', async () => {
    const { api } = fakeApi((o) => {
      if (o.method === 'DELETE') throw new ConflictError('m', 'BOX_HAS_PICKED_ITEMS');
      return found();
    });
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({ kind: 'blocked', message: '이미 상품을 담은 박스라 지금은 뺄 수 없어요. 관리자에게 문의해 주세요.' });
  });
});
