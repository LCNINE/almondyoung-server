import { describe, expect, it } from 'vitest';
import { ConflictError, NetworkError, type ApiClient } from '../../core/data/httpClient';
import { excludeBlockedAndStart, groupStartBlockers, startBlockersOf, type StartBlocker } from './batchStart';

const blocker = (over: Partial<StartBlocker>): StartBlocker => ({
  shipmentId: 's1', reason: 'STOCK_SHORT', shipmentLineId: 'l1', skuId: 'k1', requiredQty: 3, shortQty: 1,
  detail: null, trackingNo: '452716978431', skuCode: 'SKU-1', skuName: '볼펜', ...over,
});

describe('startBlockersOf', () => {
  it('BATCH_START_BLOCKED 409 의 errors 를 꺼낸다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [blocker({})]))).toEqual([blocker({})]);
  });
  it.each([
    ['다른 코드', new ConflictError('m', 'CONFLICT', undefined, [blocker({})])],
    ['errors 가 배열이 아님', new ConflictError('m', 'BATCH_START_BLOCKED', undefined, { x: 1 })],
    ['일반 오류', new Error('x')],
  ])('%s → null', (_label, error) => expect(startBlockersOf(error)).toBeNull());
  it('모양이 깨진 항목은 버린다', () => {
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [{ reason: 'STOCK_SHORT' }, blocker({})]))).toEqual([blocker({})]);
  });
  it('CANCEL_REQUESTED 차단도 버리지 않는다', () => {
    const b = blocker({ reason: 'CANCEL_REQUESTED' });
    expect(startBlockersOf(new ConflictError('m', 'BATCH_START_BLOCKED', undefined, [b]))).toEqual([b]);
  });
});

describe('groupStartBlockers', () => {
  it('사유별로 묶고 적치 대기 → 재고 부족 → 송장 순, 줄 문구에 송장 번호·상품·수량', () => {
    const groups = groupStartBlockers([
      blocker({ reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' }),
      blocker({ reason: 'STOCK_SHORT' }),
      blocker({ reason: 'INBOUND_PENDING', shortQty: 2 }),
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['INBOUND_PENDING', 'STOCK_SHORT', 'WAYBILL_NOT_READY']);
    expect(groups[1].rows).toEqual(['4527-1697-8431 · 볼펜 3개 중 1개 부족']);
    expect(groups[2].rows).toEqual(['4527-1697-8431 · 송장 재발급 필요']);
  });
  it('취소 처리 중 박스는 따로 묶어 맨 뒤에, 송장 사유로 섞지 않는다', () => {
    const groups = groupStartBlockers([
      blocker({ reason: 'CANCEL_REQUESTED', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'CANCEL_REQUESTED: 취소 처리 중인 주문이 있습니다 (shipment s1)' }),
      blocker({ reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, detail: 'WAYBILL_STALE: x' }),
    ]);
    expect(groups.map((g) => g.reason)).toEqual(['WAYBILL_NOT_READY', 'CANCEL_REQUESTED']);
    expect(groups[1].rows).toEqual(['4527-1697-8431 · 취소 처리 중']);
    expect(groups[1].title).toBe('취소 처리 중인 주문');
  });
  it('주문번호가 오면 주문번호를 앞에, 송장번호는 뒤에 붙인다. 둘 다 없을 때만 박스 번호 앞자리', () => {
    const waybill = { reason: 'WAYBILL_NOT_READY' as const, shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null };
    expect(groupStartBlockers([blocker({ ...waybill, orderNos: ['1001'], trackingNo: null })])[0].rows).toEqual(['주문 1001 · 송장 재발급 필요']);
    expect(groupStartBlockers([blocker({ ...waybill, orderNos: ['1001', '1002'] })])[0].rows).toEqual([
      '주문 1001, 1002 · 4527-1697-8431 · 송장 재발급 필요',
    ]);
    expect(groupStartBlockers([blocker({ ...waybill, shipmentId: 'deeec396-xx', trackingNo: null })])[0].rows).toEqual([
      '박스 deeec396 · 송장 재발급 필요',
    ]);
  });
});

describe('excludeBlockedAndStart', () => {
  const waybillBlocker = (shipmentId: string) =>
    blocker({ shipmentId, reason: 'WAYBILL_NOT_READY', shipmentLineId: null, skuId: null, skuName: null, requiredQty: null, shortQty: null, orderNos: ['1001'], trackingNo: null });
  const blocked = (list: StartBlocker[]) => new ConflictError('m', 'BATCH_START_BLOCKED', undefined, list);

  function fakeApi(starts: Array<StartBlocker[] | 'ok'>, failDelete = false) {
    const calls: Array<{ method?: string; path: string; body?: unknown }> = [];
    const api: ApiClient = {
      request: (async (o: { method?: string; path: string; body?: unknown }) => {
        calls.push({ method: o.method, path: o.path, body: o.body });
        if (o.path === '/picking/v2/starts') {
          const next = starts.shift();
          if (next === 'ok' || next === undefined) return { state: 'started', batchId: 'b-1', sessionId: 'x' };
          throw blocked(next);
        }
        if (failDelete) throw new ConflictError('이미 다른 작업이 진행 중이에요', 'X');
        return {};
      }) as ApiClient['request'],
    };
    return { api, calls };
  }

  it('지금 막힌 박스를 다시 받아, 화면에 보였던 박스만 박스마다 한 번씩 빼고 시작한다', async () => {
    const now = [waybillBlocker('s1'), blocker({ shipmentId: 's2' }), blocker({ shipmentId: 's2', shipmentLineId: 'l2' })];
    const { api, calls } = fakeApi([now, 'ok']);
    let key = 0;
    const out = await excludeBlockedAndStart({ api, newKey: () => `k${++key}` }, 'b-1', now);
    expect(calls).toEqual([
      { method: 'POST', path: '/picking/v2/starts', body: { batchId: 'b-1' } },
      { method: 'DELETE', path: '/outbound-batches/b-1/shipments/s1', body: { reason: '작업 시작 전 뺌 — 송장 미발급·재발급 필요' } },
      { method: 'DELETE', path: '/outbound-batches/b-1/shipments/s2', body: { reason: '작업 시작 전 뺌 — 재고 부족' } },
      { method: 'POST', path: '/picking/v2/starts', body: { batchId: 'b-1' } },
    ]);
    expect(out).toMatchObject({ removedIds: ['s1', 's2'], skipped: [], start: { kind: 'started' } });
  });

  it('그 사이 풀린 박스는 빼지 않고, 화면에 없던 새 막힌 박스도 빼지 않는다', async () => {
    const { api, calls } = fakeApi([[waybillBlocker('s3')]]);
    const out = await excludeBlockedAndStart({ api, newKey: () => 'k' }, 'b-1', [waybillBlocker('s1')]);
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([]);
    expect(out.removedIds).toEqual([]);
    expect(out.start.kind).toBe('failed');
  });

  it('그 사이 모두 풀렸으면 빼지 않고 그대로 시작한다', async () => {
    const { api, calls } = fakeApi(['ok']);
    const out = await excludeBlockedAndStart({ api, newKey: () => 'k' }, 'b-1', [waybillBlocker('s1')]);
    expect(calls.map((c) => c.method)).toEqual(['POST']);
    expect(out).toMatchObject({ removedIds: [], start: { kind: 'started' } });
  });

  it('빼기 응답을 잃으면 같은 키로 한 번 더 보내 뺀 수에 넣는다', async () => {
    const keys: string[] = [];
    let deletes = 0;
    const answers: Array<StartBlocker[] | 'ok'> = [[waybillBlocker('s1')], 'ok'];
    const api: ApiClient = {
      request: (async (o: { path: string; idempotencyKey?: string }) => {
        if (o.path === '/picking/v2/starts') {
          const next = answers.shift();
          if (next === 'ok' || next === undefined) return { state: 'started', batchId: 'b-1', sessionId: 'x' };
          throw blocked(next);
        }
        keys.push(o.idempotencyKey ?? '');
        deletes += 1;
        if (deletes === 1) throw new NetworkError('timeout');
        return {};
      }) as ApiClient['request'],
    };
    let key = 0;
    const out = await excludeBlockedAndStart({ api, newKey: () => `k${++key}` }, 'b-1', [waybillBlocker('s1')]);
    expect(keys).toEqual(['k2', 'k2']);
    expect(out).toMatchObject({ removedIds: ['s1'], skipped: [], start: { kind: 'started' } });
  });

  it('다시 보내도 앞 요청이 처리 중이면 결과를 모르는 박스로 남긴다', async () => {
    const answers: Array<StartBlocker[] | 'ok'> = [[waybillBlocker('s1')], 'ok'];
    let deletes = 0;
    const api: ApiClient = {
      request: (async (o: { path: string }) => {
        if (o.path === '/picking/v2/starts') {
          const next = answers.shift();
          if (next === 'ok' || next === undefined) return { state: 'started', batchId: 'b-1', sessionId: 'x' };
          throw blocked(next);
        }
        deletes += 1;
        if (deletes === 1) throw new NetworkError('timeout');
        throw new ConflictError('처리 중', 'FULFILLMENT_COMMAND_IN_PROGRESS');
      }) as ApiClient['request'],
    };
    const out = await excludeBlockedAndStart({ api, newKey: () => 'k' }, 'b-1', [waybillBlocker('s1')]);
    expect(out.removedIds).toEqual([]);
    expect(out.skipped).toEqual([{ shipmentId: 's1', label: '주문 1001', message: expect.any(String), uncertain: true }]);
  });

  it('빼지 못한 박스는 알리고, 시작 거절은 던지지 않고 결과로 돌려준다', async () => {
    const { api } = fakeApi([[waybillBlocker('s1')], [waybillBlocker('s1')]], true);
    const out = await excludeBlockedAndStart({ api, newKey: () => 'k' }, 'b-1', [waybillBlocker('s1')]);
    expect(out.removedIds).toEqual([]);
    expect(out.skipped).toEqual([{ shipmentId: 's1', label: '주문 1001', message: expect.any(String), uncertain: false }]);
    expect(out.start.kind).toBe('failed');
  });
});
