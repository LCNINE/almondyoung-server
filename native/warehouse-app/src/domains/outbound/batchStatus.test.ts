import { describe, expect, it } from 'vitest';
import {
  arrangeBatches,
  batchNameOf,
  batchProgressOf,
  attentionCountOf,
  boxCountsOf,
  boxRowOf,
  hasCancelPending,
  mergeBatches,
  newBatchSummary,
  refillCountOf,
  seoulDayStart,
  sortBoxRows,
  todayBatchCount,
  withRefillPending,
  type BoxRow,
} from './batchStatus';
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

describe('배치 목록 순서와 시작 전 배치 알림', () => {
  const b = (id: string, patch: Partial<OutboundBatchSummary> = {}): OutboundBatchSummary => ({
    id,
    batchNumber: id,
    name: '',
    status: 'created',
    totalItems: 2,
    totalBoxes: 1,
    totalQty: 2,
    startedAt: null,
    withdrawingItems: 0,
    ...patch,
  });
  const started = { startedAt: '2026-10-02T00:00:00.000Z' };

  it('새 배치(상자 있는 시작 전) → 진행 중 → 시작했지만 손대지 않은 배치, 빈 시작 전 배치는 따로', () => {
    const picking = [b('p1', { status: 'picking', ...started })];
    const created = [b('empty', { totalItems: 0, totalBoxes: 0 }), b('new2'), b('untouched', started), b('new1')];
    const { active, empty } = arrangeBatches(picking, created);
    expect(active.map((x) => x.id)).toEqual(['new2', 'new1', 'p1', 'untouched']);
    expect(empty.map((x) => x.id)).toEqual(['empty']);
  });

  it('옛 core(상자 수 없음)면 줄 수로 빈 배치를 가른다', () => {
    const { empty } = arrangeBatches([], [b('old', { totalBoxes: undefined, totalItems: 0 }), b('old2', { totalBoxes: undefined })]);
    expect(empty.map((x) => x.id)).toEqual(['old']);
  });

  it('알림은 상자 있는 시작 전 배치만 세고 상자 수를 더한다', () => {
    expect(newBatchSummary([b('a', { totalBoxes: 3, totalItems: 5 }), b('b', { totalBoxes: 2 }), b('s', started), b('e', { totalBoxes: 0, totalItems: 0 })])).toEqual({
      batches: 2,
      boxes: 5,
    });
    expect(newBatchSummary([b('a', { totalBoxes: undefined })])).toEqual({ batches: 1, boxes: null });
    expect(newBatchSummary(undefined)).toEqual({ batches: 0, boxes: 0 });
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
  const NO_FACTS = { orderNos: [], carrier: null, skuKinds: null };
  const row = (patch: Partial<BoxRow> & Pick<BoxRow, 'shipmentId' | 'status' | 'tone' | 'action'>): BoxRow => ({
    trackingNo: '1',
    recipient: '',
    ...NO_FACTS,
    ...patch,
  });

  it.each([
    [{ state: 'withdrawing', workItemStatus: 'withdrawing' }, '빠지는 중', 'warn', 'open'],
    [{ state: 'never_printed' }, '미출력', 'alert', 'print'],
    [{ state: 'reprint_required', workItemStatus: 'picking' }, '재출력', 'alert', 'print'],
    [{ state: 'unavailable' }, '송장 확인', 'alert', null],
    [{ state: 'not_started' }, '시작 전', 'off', null],
    [{ workItemStatus: 'short_pick_recovery' }, '결품 처리 중', 'warn', 'open'],
    [{ workItemStatus: 'picking' }, '검수 중', 'work', 'open'],
    [{ workItemStatus: 'queued' }, '검수 대기', 'idle', 'open'],
  ] as const)('%o → %s', (patch, status, tone, action) => {
    expect(boxRowOf(state(patch))).toEqual({
      shipmentId: 's',
      trackingNo: '421033881907',
      recipient: '김*영',
      ...NO_FACTS,
      status,
      tone,
      action,
    });
  });

  it('시작 전 배치의 상자는 출고 검수에서 열 수 없다 — 상자 보기를 주지 않는다', () => {
    expect(boxRowOf(state({ state: 'not_started', workItemStatus: 'queued' }))?.action).toBeNull();
  });

  it('core 가 실은 주문 번호·택배사·상품 종 수를 줄에 싣는다', () => {
    expect(boxRowOf(state({ orderNos: ['20261126-0001'], carrier: 'HANJIN', skuKinds: 3 }))).toMatchObject({
      orderNos: ['20261126-0001'],
      carrier: 'HANJIN',
      skuKinds: 3,
    });
  });

  it('송장번호 칸이 없으면(옛 core) 줄을 만들지 않는다', () => {
    expect(boxRowOf(state({ trackingNo: undefined }))).toBeNull();
  });

  it('송장이 없는 상자도 빨간 송장 필요 줄로 그린다 — 요약 숫자와 목록 줄 수가 맞는다', () => {
    expect(boxRowOf(state({ trackingNo: null }))).toEqual({
      shipmentId: 's',
      trackingNo: '',
      recipient: '김*영',
      ...NO_FACTS,
      status: '송장 필요',
      tone: 'alert',
      action: null,
    });
  });

  it('취소 대기 박스는 송장이 없어도 빨간 취소 대기 줄로 그린다', () => {
    expect(boxRowOf(state({ cancelPending: true, trackingNo: null }))).toEqual({
      shipmentId: 's',
      trackingNo: '',
      recipient: '김*영',
      ...NO_FACTS,
      status: '취소 대기',
      tone: 'alert',
      action: null,
    });
    expect(boxRowOf(state({ cancelPending: true, state: 'never_printed' }))?.status).toBe('취소 대기');
  });

  it('취소 대기 박스가 하나라도 있으면 빼기 안내를 띄운다', () => {
    expect(hasCancelPending([state({}), state({ cancelPending: true })])).toBe(true);
    expect(hasCancelPending([state({}), state({ cancelPending: false })])).toBe(false);
  });

  it('손이 가야 하는 박스(송장·빠지는 중)가 위로, 시작 전은 맨 아래, 같은 무리 안에서는 송장번호 순', () => {
    const rows: BoxRow[] = [
      row({ shipmentId: 'a', trackingNo: '3', status: '검수 대기', tone: 'idle', action: 'open' }),
      row({ shipmentId: 'b', trackingNo: '2', status: '재출력', tone: 'alert', action: 'print' }),
      row({ shipmentId: 'e', trackingNo: '0', status: '시작 전', tone: 'off', action: null }),
      row({ shipmentId: 'c', trackingNo: '1', status: '검수 대기', tone: 'idle', action: 'open' }),
      row({ shipmentId: 'd', trackingNo: '9', status: '빠지는 중', tone: 'warn', action: 'open' }),
    ];
    expect(sortBoxRows(rows).map((r) => r.shipmentId)).toEqual(['b', 'd', 'c', 'a', 'e']);
  });

  it('보충 대기 상자는 송장 손볼 일이 없을 때만 보충 대기로 보인다', () => {
    const rows: BoxRow[] = [
      row({ shipmentId: 'a', status: '검수 중', tone: 'work', action: 'open' }),
      row({ shipmentId: 'b', status: '재출력', tone: 'alert', action: 'print' }),
      row({ shipmentId: 'c', status: '검수 대기', tone: 'idle', action: 'open' }),
    ];
    const marked = withRefillPending(rows, new Set(['a', 'b']));
    expect(marked.map((r) => [r.status, r.tone, r.action])).toEqual([
      ['보충 대기', 'warn', 'open'],
      ['재출력', 'alert', 'print'],
      ['검수 대기', 'idle', 'open'],
    ]);
  });

  it('보충 대기는 끝나지 않은 이 배치 상자만, 확인 필요는 빨간 줄 수', () => {
    const work = [item('picking', 1), item('completed', 2), item('queued', 3)];
    const pending = new Set(['s-picking-1', 's-completed-2', 's-other']);
    const rows: BoxRow[] = [
      row({ shipmentId: 'x', status: '미출력', tone: 'alert', action: 'print' }),
      row({ shipmentId: 'y', trackingNo: '', status: '취소 대기', tone: 'alert', action: null }),
      row({ shipmentId: 'z', status: '검수 대기', tone: 'idle', action: 'open' }),
    ];
    expect(refillCountOf(work, pending)).toBe(1);
    expect(attentionCountOf(rows)).toBe(2);
  });
});

describe('오늘 배치 수', () => {
  const now = new Date('2026-11-26T03:00:00.000Z');

  it('서울 날짜로 오늘 만든 배치만 센다 — 끝난 배치도 세고 취소한 배치는 뺀다', () => {
    expect(
      todayBatchCount(
        [
          { createdAt: '2026-11-25T15:30:00.000Z', status: 'completed' },
          { createdAt: '2026-11-26T10:00:00.000Z', status: 'picking' },
          { createdAt: '2026-11-26T11:00:00.000Z', status: 'canceled' },
          { createdAt: '2026-11-25T14:59:00.000Z', status: 'created' },
          { status: 'created' },
        ],
        now
      )
    ).toBe(2);
  });

  it('만든 시각을 싣지 않는 옛 core 면 모른다', () => {
    expect(todayBatchCount([{ status: 'created' }, { status: 'picking' }], now)).toBeNull();
    expect(todayBatchCount([], now)).toBe(0);
  });

  it('오늘 0시(서울)를 UTC 시각으로', () => {
    expect(seoulDayStart(now)).toBe('2026-11-25T15:00:00.000Z');
    expect(seoulDayStart(new Date('2026-11-25T15:30:00.000Z'))).toBe('2026-11-25T15:00:00.000Z');
  });
});

describe('배치 이름', () => {
  it('관리자가 붙인 이름을 돌려준다', () => {
    expect(batchNameOf({ batchNumber: 'OB-C22A5ACD4B3C', name: '11/12 개별피킹 17:13:48' })).toBe('11/12 개별피킹 17:13:48');
  });

  it('이름이 없거나 코드로 만든 기본 이름이면 보이지 않는다', () => {
    expect(batchNameOf({ batchNumber: 'OB-C22A5ACD4B3C', name: 'Batch C22A5ACD4B3C' })).toBeNull();
    expect(batchNameOf({ batchNumber: 'OB-C22A5ACD4B3C', name: '  ' })).toBeNull();
  });
});
