import { describe, expect, it } from 'vitest';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import { joinBoxIntoBatch, type JoinCandidate } from './batchJoin';

const candidate = (over: Partial<JoinCandidate> = {}): JoinCandidate => ({
  shipmentId: 's-1',
  shipmentStatus: 'planned',
  manifestVersion: 3,
  orderNos: ['3900'],
  recipientMasked: '홍**',
  totalQty: 2,
  lines: [{ skuCode: 'K', skuName: '볼펜', qty: 2 }],
  waybill: null,
  issue: null,
  waybillIssue: null,
  ...over,
});

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
const label = { waybillId: 'w', format: 'zpl', data: 'ZPL', fingerprint: 'fp', revision: 1, trackingNo: '452716978431', pages: 1 };

describe('joinBoxIntoBatch', () => {
  it('송장이 없으면 HANJIN 으로 발급 → 합류 → 출력·출력 확인', async () => {
    const printed: string[] = [];
    const { api, calls } = fakeApi((o) => {
      if (o.path === '/shipments/s-1/waybills') return { status: 'registered', source: 'carrier', carrier: 'HANJIN', trackingNo: '452716978431' };
      if (o.path.endsWith('/waybill/label')) return label;
      return {};
    });
    const outcome = await joinBoxIntoBatch(
      { api, print: async (_t, data) => void printed.push(data), printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate(),
    );
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /shipments/s-1/waybills',
      'POST /outbound-batches/b-1/shipments/s-1',
      'GET /shipments/s-1/waybill/label',
      'POST /shipments/s-1/waybill/label-prints',
    ]);
    expect(calls[0].body).toEqual({ carrier: 'HANJIN', expectedManifestVersion: 3 });
    expect(printed).toEqual(['ZPL']);
    expect(outcome).toMatchObject({ kind: 'joined', print: 'printed', shipmentId: 's-1' });
  });

  it('발급이 registered 가 아니면 합류하지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({ status: 'pending', source: 'carrier', carrier: 'HANJIN', trackingNo: null }));
    const outcome = await joinBoxIntoBatch({ api, print: async () => {}, printer: 'ZD', newKey: () => 'k' }, 'b-1', candidate());
    expect(outcome.kind).toBe('blocked');
    expect(calls).toHaveLength(1);
  });

  it('후보에 막는 사유가 있으면 아무 요청도 보내지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ issue: 'SHIPMENT_ACTIVE_WORK_ITEM' }),
    );
    expect(outcome).toEqual({ kind: 'blocked', message: '이미 다른 배치에 들어 있는 박스예요.' });
    expect(calls).toEqual([]);
  });

  it('합류가 막히면 사유별 묶음을 돌려준다', async () => {
    const { api } = fakeApi((o) => {
      if (o.path.startsWith('/outbound-batches/')) {
        throw new ConflictError('m', 'BATCH_JOIN_BLOCKED', undefined, [
          { shipmentId: 's-1', reason: 'STOCK_SHORT', shipmentLineId: 'l', skuId: 'k', requiredQty: 2, shortQty: 1, detail: null, trackingNo: null, skuCode: 'K', skuName: '볼펜' },
        ]);
      }
      return {};
    });
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'carrier', carrier: 'HANJIN', printable: true } }),
    );
    expect(outcome).toMatchObject({ kind: 'join_blocked', groups: [{ reason: 'STOCK_SHORT' }] });
  });

  it('수기 송장이면 합류하고 출력하지 않는다', async () => {
    const { api, calls } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'manual', carrier: 'HANJIN', printable: false } }),
    );
    expect(outcome).toMatchObject({ kind: 'joined', print: 'external' });
    expect(calls.map((c) => c.path)).toEqual(['/outbound-batches/b-1/shipments/s-1']);
  });

  it('프린터가 없으면 합류만 하고 «프린터 있는 자리에서» 를 안내한다', async () => {
    const { api } = fakeApi(() => ({}));
    const outcome = await joinBoxIntoBatch(
      { api, print: async () => {}, printer: null, newKey: () => 'k' },
      'b-1',
      candidate({ waybill: { id: 'w', trackingNo: '1', status: 'registered', source: 'carrier', carrier: 'HANJIN', printable: true } }),
    );
    expect(outcome).toMatchObject({ kind: 'joined', print: 'no_printer' });
  });
});
