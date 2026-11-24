import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../core/data/httpClient';
import type { ReadyShipment } from '../inbound/readyShipments';
import type { JoinCandidate } from './batchJoin';
import { printReadyShipmentIntoBatch } from './printIntoBatch';

const shipment = (over: Partial<ReadyShipment> = {}): ReadyShipment => ({
  shipmentId: 's-1',
  status: 'draft',
  orderNos: ['3900'],
  recipientMasked: '홍**',
  skuCount: 1,
  totalQty: 2,
  readiness: 'ready',
  ...over,
});
const candidate = (over: Partial<JoinCandidate> = {}): JoinCandidate => ({
  shipmentId: 's-1',
  shipmentStatus: 'planned',
  manifestVersion: 3,
  orderNos: ['3900'],
  recipientMasked: '홍**',
  totalQty: 2,
  lines: [],
  waybill: null,
  issue: null,
  waybillIssue: null,
  ...over,
});
const label = { waybillId: 'w', format: 'zpl', data: 'ZPL', fingerprint: 'fp', revision: 1, trackingNo: '4527', pages: 1 };

function setup(handler: (o: { method?: string; path: string }) => unknown) {
  const calls: Array<{ method: string; path: string; body?: unknown; idempotencyKey?: string }> = [];
  const api: ApiClient = {
    request: (async (o: { method?: string; path: string; body?: unknown; idempotencyKey?: string }) => {
      calls.push({ method: o.method ?? 'GET', path: o.path, body: o.body, idempotencyKey: o.idempotencyKey });
      return handler(o);
    }) as ApiClient['request'],
  };
  return { calls, deps: { api, print: async () => {}, printer: 'ZD', newKey: () => 'k' } };
}
const okHandler =
  (planned: unknown = { succeeded: ['s-1'], failed: [] }, cands: JoinCandidate[] = [candidate()]) =>
  (o: { method?: string; path: string }) => {
    if (o.path === '/outbound-preparation/plans') return planned;
    if (o.path.includes('/join-candidates')) return cands;
    if (o.path === '/shipments/s-1/waybills') return { status: 'registered', source: 'carrier', carrier: 'HANJIN' };
    if (o.path.endsWith('/waybill/label')) return label;
    return {};
  };

describe('printReadyShipmentIntoBatch', () => {
  it('draft 상자는 계획을 부른 뒤 합류한다', async () => {
    const { deps, calls } = setup(okHandler());
    const outcome = await printReadyShipmentIntoBatch(deps, 'b-1', shipment());
    expect(calls.slice(0, 4).map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /outbound-preparation/plans',
      'GET /outbound-batches/b-1/join-candidates?code=3900',
      'POST /shipments/s-1/waybills',
      'POST /outbound-batches/b-1/shipments/s-1',
    ]);
    expect(calls[0].body).toEqual({ shipmentIds: ['s-1'] });
    expect(calls[0].idempotencyKey).toBeTruthy();
    expect(outcome).toMatchObject({ kind: 'joined', shipmentId: 's-1' });
  });

  it('planned 상자는 계획을 부르지 않는다', async () => {
    const { deps, calls } = setup(okHandler());
    await printReadyShipmentIntoBatch(deps, 'b-1', shipment({ status: 'planned' }));
    expect(calls.some((c) => c.path === '/outbound-preparation/plans')).toBe(false);
    expect(calls[0].path).toContain('/join-candidates');
  });

  it('계획 응답이 already 면 이어 간다', async () => {
    const { deps } = setup(okHandler({ succeeded: ['s-1'], failed: [] }));
    const outcome = await printReadyShipmentIntoBatch(deps, 'b-1', shipment());
    expect(outcome.kind).toBe('joined');
  });

  it('계획이 거절되면 그 사유로 blocked', async () => {
    const { deps, calls } = setup(
      okHandler({
        succeeded: [],
        failed: [{ shipmentId: 's-1', code: 'SHIPMENT_PROFILE_INCOMPATIBLE', message: '배송 프로필을 정할 수 없어요', transient: false }],
      })
    );
    const outcome = await printReadyShipmentIntoBatch(deps, 'b-1', shipment());
    expect(outcome).toEqual({ kind: 'blocked', message: '배송 프로필을 정할 수 없어요' });
    expect(calls).toHaveLength(1);
  });

  it('후보에 그 상자가 없으면 blocked', async () => {
    const { deps } = setup(okHandler(undefined, [candidate({ shipmentId: 's-2' })]));
    const outcome = await printReadyShipmentIntoBatch(deps, 'b-1', shipment());
    expect(outcome).toEqual({ kind: 'blocked', message: '이 상자를 배치에서 찾지 못했어요. 목록을 새로 고쳐 주세요.' });
  });
});
