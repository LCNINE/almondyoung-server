import { describe, expect, it, vi } from 'vitest';
import { type ApiClient } from '../../core/data/httpClient';
import { excludeFromBatch, removeBoxFromBatch } from './batchRemove';
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
    labelState: 'current', labelChanges: [], labelIssue: null, removals: [], exitTo: null, ...over,
  });

  it('담은 상품이 있으면 빼는 중 — 송장을 스캔해 바구니로 빼라고 안내한다', async () => {
    const { api } = fakeApi((o) =>
      o.method === 'DELETE' ? { operationId: 'op', workItem: { id: 'wi-1', status: 'withdrawing' } } : found(),
    );
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({
      kind: 'withdrawing',
      message: '담은 상품이 있어 빼는 중이에요. 이 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
    });
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
    expect(outcome).toEqual({ kind: 'blocked', message: '이 배치에 있는 박스가 아니에요. 방금 뺐다면 이미 빠진 상태예요.' });
    expect(calls).toHaveLength(1);
  });

  it('빼는 응답을 잃고 다시 보내면(이미 빠져 작업 항목이 없다) DELETE 없이 «이미 빠진 상태» 를 알린다', async () => {
    const { api, calls } = fakeApi(() => found({ batchId: null, workItemId: null, workItemStatus: null }));
    const outcome = await removeBoxFromBatch({ api, newKey: () => 'k' }, { batchId: 'b-1', warehouseId: 'wh', trackingNo: '1', reason: 'x' });
    expect(outcome).toEqual({ kind: 'blocked', message: '이 배치에 있는 박스가 아니에요. 방금 뺐다면 이미 빠진 상태예요.' });
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});

describe('excludeFromBatch', () => {
  it('사유를 다듬어 DELETE 로 보낸다 — 멱등 키와 함께', async () => {
    const request = vi.fn(async () => ({ workItem: { status: 'withdrawing' } }));
    await excludeFromBatch({ request } as never, {
      batchId: 'b-1',
      shipmentId: 's-1',
      reason: ' station_withdraw_command ',
      idempotencyKey: 'k-1',
    });
    expect(request).toHaveBeenCalledWith({
      method: 'DELETE',
      path: '/outbound-batches/b-1/shipments/s-1',
      body: { reason: 'station_withdraw_command' },
      idempotencyKey: 'k-1',
    });
  });
});
