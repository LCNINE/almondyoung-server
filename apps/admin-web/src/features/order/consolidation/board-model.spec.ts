import type {
  ConsolidationBoardGroup,
  ConsolidationBoardShipment,
} from '@/lib/types/dto/fulfillment';
import {
  BOARD_EMPTY_TEXT,
  DEFAULT_MERGE_REASON,
  boardFooterText,
  boardRowAction,
  buildBoardRequest,
  defaultWarehouseId,
  filterBoardGroups,
  isBulkSelectable,
  runBulkMerge,
  shipmentBadge,
  summarizeBulk,
} from './board-model';

const shipment = (
  shipmentId: string,
  overrides: Partial<ConsolidationBoardShipment> = {}
): ConsolidationBoardShipment => ({
  shipmentId,
  status: 'draft',
  salesOrderNos: [`SO-${shipmentId}`],
  itemSummary: '상품',
  totalQty: 1,
  batchId: null,
  waybillTrackingNo: null,
  manifestVersion: 2,
  reservationVersion: 3,
  createdAt: '2026-11-02T00:00:00Z',
  orderedAt: '2026-11-02T06:12:00Z',
  salesChannels: ['아몬드영'],
  ...overrides,
});

const group = (
  key: string,
  shipments: ConsolidationBoardShipment[],
  overrides: Partial<ConsolidationBoardGroup> = {}
): ConsolidationBoardGroup => ({
  key,
  recipientSnapshot: {},
  memoDiffers: false,
  canMergeNow: true,
  shipments,
  ...overrides,
});

describe('boardRowAction', () => {
  it('merges when every shipment is a bare draft', () => {
    expect(boardRowAction(group('g', [shipment('a'), shipment('b')]))).toBe(
      'merge'
    );
  });

  it('unwinds when any shipment has a waybill, a batch, or is not a draft', () => {
    expect(
      boardRowAction(
        group('g', [shipment('a'), shipment('b', { waybillTrackingNo: '1' })])
      )
    ).toBe('unwind_merge');
    expect(boardRowAction(group('g', [shipment('a', { batchId: 'bt' })]))).toBe(
      'unwind_merge'
    );
    expect(
      boardRowAction(group('g', [shipment('a', { status: 'planned' })]))
    ).toBe('unwind_merge');
  });
});

describe('isBulkSelectable', () => {
  it('allows only same-memo groups that merge right away', () => {
    expect(isBulkSelectable(group('g', [shipment('a'), shipment('b')]))).toBe(
      true
    );
  });

  it('blocks groups with a waybill', () => {
    expect(
      isBulkSelectable(
        group('g', [shipment('a'), shipment('b', { waybillTrackingNo: '1' })])
      )
    ).toBe(false);
  });

  it('blocks groups whose memos differ', () => {
    expect(
      isBulkSelectable(
        group('g', [shipment('a'), shipment('b')], { memoDiffers: true })
      )
    ).toBe(false);
  });
});

describe('buildBoardRequest', () => {
  it('sends every shipment with its versions and takes the recipient from the first', () => {
    const request = buildBoardRequest(
      group('g', [shipment('a'), shipment('b'), shipment('c')]),
      DEFAULT_MERGE_REASON
    );

    expect(request).toEqual({
      sources: ['a', 'b', 'c'].map((shipmentId) => ({
        shipmentId,
        expectedManifestVersion: 2,
        expectedReservationVersion: 3,
      })),
      recipientSourceShipmentId: 'a',
      reason: '동일 수령인 합포장',
    });
  });
});

describe('shipmentBadge', () => {
  it('marks a bare draft as mergeable and the rest as amber', () => {
    expect(shipmentBadge(shipment('a'))).toEqual({
      label: '바로 합칠 수 있음',
      tone: 'ok',
    });
    expect(shipmentBadge(shipment('a', { waybillTrackingNo: '1' }))).toEqual({
      label: '송장 발급됨',
      tone: 'warn',
    });
    expect(shipmentBadge(shipment('a', { batchId: 'b' }))).toEqual({
      label: '창고에서 작업 중',
      tone: 'warn',
    });
  });
});

describe('defaultWarehouseId', () => {
  it('prefers Bucheon and falls back to the first warehouse', () => {
    const list = [
      { id: 'w1', name: '인천 창고' },
      { id: 'w2', name: '부천 물류창고' },
    ];

    expect(defaultWarehouseId(list)).toBe('w2');
    expect(defaultWarehouseId([list[0]])).toBe('w1');
    expect(defaultWarehouseId([])).toBe('');
  });
});

describe('filterBoardGroups', () => {
  const now = new Date(2026, 10, 2, 12, 0, 0);
  const today = new Date(2026, 10, 2, 9, 0, 0).toISOString();
  const old = new Date(2026, 9, 1, 9, 0, 0).toISOString();
  const fresh = group('fresh', [
    shipment('a', { orderedAt: today }),
    shipment('b', { orderedAt: today }),
  ]);
  const stale = group('stale', [
    shipment('c', { orderedAt: old, waybillTrackingNo: '1' }),
    shipment('d', { orderedAt: old }),
  ]);

  it('returns everything without filters', () => {
    expect(
      filterBoardGroups(
        [fresh, stale],
        { todayOnly: false, beforeWaybillOnly: false },
        now
      )
    ).toHaveLength(2);
  });

  it('keeps today orders and waybill-free groups', () => {
    expect(
      filterBoardGroups(
        [fresh, stale],
        { todayOnly: true, beforeWaybillOnly: false },
        now
      ).map((g) => g.key)
    ).toEqual(['fresh']);
    expect(
      filterBoardGroups(
        [fresh, stale],
        { todayOnly: false, beforeWaybillOnly: true },
        now
      ).map((g) => g.key)
    ).toEqual(['fresh']);
  });
});

describe('texts', () => {
  it('has an empty message in haeyo style', () => {
    expect(BOARD_EMPTY_TEXT).toBe('지금 합칠 수 있는 주문이 없어요.');
  });

  it('counts groups and orders in the footer', () => {
    const pairs = [
      group('x', [shipment('a'), shipment('b')]),
      group('y', [shipment('c'), shipment('d')]),
    ];

    expect(boardFooterText(pairs)).toBe('2쌍 · 주문 4건');
    expect(
      boardFooterText([
        group('z', [shipment('a'), shipment('b'), shipment('c')]),
      ])
    ).toBe('1묶음 · 주문 3건');
  });
});

describe('summarizeBulk', () => {
  it('reports successes and failures together', () => {
    expect(
      summarizeBulk([
        { key: 'a', orderNos: '#1, #2', ok: true, message: '' },
        { key: 'b', orderNos: '#3, #4', ok: false, message: '실패' },
      ])
    ).toBe('2건 중 1건을 합쳤고 1건은 실패했어요.');
    expect(
      summarizeBulk([{ key: 'a', orderNos: '#1', ok: true, message: '' }])
    ).toBe('1건을 모두 합쳤어요.');
  });
});

describe('runBulkMerge', () => {
  it('keeps going after a failure and reports each group', async () => {
    const groups = [
      group('x', [shipment('a'), shipment('b')]),
      group('y', [shipment('c'), shipment('d')]),
      group('z', [shipment('e'), shipment('f')]),
    ];
    const send = jest
      .fn()
      .mockResolvedValueOnce({ operationStatus: 'completed' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ operationStatus: 'pending' });

    const results = await runBulkMerge(groups, send, () => '막혔어요');

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][0].recipientSourceShipmentId).toBe('c');
    expect(results.map((result) => [result.key, result.ok])).toEqual([
      ['x', true],
      ['y', false],
      ['z', true],
    ]);
    expect(results[1].message).toBe('막혔어요');
    expect(results[0].orderNos).toBe('#SO-a, #SO-b');
  });
});
