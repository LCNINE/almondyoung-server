import { describe, expect, it } from 'vitest';
import { batchProgressOf, boxCountsOf, boxRowOf, mergeBatches, sortBoxRows } from './batchStatus';
import type { OutboundBatchSummary } from './types';

const item = (status: string, i = 0) => ({ id: `wi-${status}-${i}`, shipmentId: `s-${status}-${i}`, status });
const items = [
  item('completed', 1),
  item('completed', 2),
  item('picking'),
  item('packing'),
  item('short_pick_recovery'),
  item('queued'),
  item('withdrawing'),
  item('excluded'),
];

describe('배치 집계', () => {
  it('진행은 출고된 박스 / 빠진 박스를 뺀 전체(스펙 §5.5)', () => {
    expect(batchProgressOf('B-1002', items)).toEqual({ code: 'B-1002', done: 2, total: 7 });
  });

  it('완료·검수 중·대기·빠지는 중 — 빠진 박스는 세지 않는다', () => {
    expect(boxCountsOf(items)).toEqual({ done: 2, working: 3, waiting: 1, withdrawing: 1 });
  });

  it('진행 중 배치 먼저, 시작 전 다음 — 같은 배치는 한 번만', () => {
    const b = (id: string): OutboundBatchSummary => ({
      id,
      batchNumber: id,
      name: '',
      status: 'picking',
      totalItems: 1,
      totalQty: 1,
      startedAt: null,
      withdrawingItems: 0,
    });
    expect(mergeBatches([b('p1'), b('x')], [b('x'), b('c1')]).map((x) => x.id)).toEqual(['p1', 'x', 'c1']);
    expect(mergeBatches(undefined, undefined)).toEqual([]);
  });
});

describe('배치 현황 박스 줄(스펙 §8 F2)', () => {
  const state = (patch: Record<string, unknown>) => ({
    shipmentId: 's',
    workItemId: 'wi',
    state: 'current' as const,
    changes: [],
    issue: null,
    workItemStatus: 'queued',
    trackingNo: '421033881907',
    recipientMasked: '김*영',
    ...patch,
  });

  it.each([
    [{ state: 'withdrawing', workItemStatus: 'withdrawing' }, '빠지는 중', 'warn'],
    [{ state: 'never_printed' }, '미출력', 'alert'],
    [{ state: 'reprint_required', workItemStatus: 'picking' }, '재출력', 'alert'],
    [{ state: 'unavailable' }, '송장 확인', 'alert'],
    [{ workItemStatus: 'short_pick_recovery' }, '결품 처리 중', 'warn'],
    [{ workItemStatus: 'picking' }, '검수 중', 'work'],
    [{ workItemStatus: 'queued' }, '대기', 'idle'],
  ] as const)('%o → %s', (patch, status, tone) => {
    expect(boxRowOf(state(patch))).toEqual({ shipmentId: 's', trackingNo: '421033881907', recipient: '김*영', status, tone });
  });

  it('송장번호가 없으면(옛 core) 줄을 만들지 않는다 — 현장이 읽을 수 없는 id 를 그리지 않는다', () => {
    expect(boxRowOf(state({ trackingNo: undefined }))).toBeNull();
    expect(boxRowOf(state({ trackingNo: null }))).toBeNull();
  });

  it('손이 가야 하는 박스(송장·빠지는 중)가 위로, 같은 무리 안에서는 송장번호 순', () => {
    const rows = [
      { shipmentId: 'a', trackingNo: '3', recipient: '', status: '대기', tone: 'idle' as const },
      { shipmentId: 'b', trackingNo: '2', recipient: '', status: '재출력', tone: 'alert' as const },
      { shipmentId: 'c', trackingNo: '1', recipient: '', status: '대기', tone: 'idle' as const },
      { shipmentId: 'd', trackingNo: '9', recipient: '', status: '빠지는 중', tone: 'warn' as const },
    ];
    expect(sortBoxRows(rows).map((r) => r.shipmentId)).toEqual(['b', 'd', 'c', 'a']);
  });
});
