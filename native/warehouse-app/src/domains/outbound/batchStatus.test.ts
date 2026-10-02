import { describe, expect, it } from 'vitest';
import { batchProgressOf, boxCountsOf, mergeBatches } from './batchStatus';
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
