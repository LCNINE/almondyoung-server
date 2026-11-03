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
  replaceResult,
  retryUnconfirmed,
  runBulkMerge,
  type BulkResult,
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

const networkError = () => Object.assign(new Error('Network Error'), {});

const serverReject = (status: number) =>
  Object.assign(new Error('reject'), { response: { status, data: {} } });

describe('runBulkMerge', () => {
  const groups = [
    group('x', [shipment('a'), shipment('b')]),
    group('y', [shipment('c'), shipment('d')]),
    group('z', [shipment('e'), shipment('f')]),
  ];

  it('keeps going after a failure and classifies each group', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ operationStatus: 'completed' })
      .mockRejectedValueOnce(serverReject(409))
      .mockRejectedValueOnce(networkError());

    const results = await runBulkMerge(groups, send, () => '막혔어요');

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][0].data.recipientSourceShipmentId).toBe('c');
    expect(results.map((result) => [result.key, result.status])).toEqual([
      ['x', 'done'],
      ['y', 'failed'],
      ['z', 'unconfirmed'],
    ]);
    expect(results[1].message).toBe('막혔어요');
    expect(results[2].message).toBe('확인이 필요해요');
    expect(results[0].orderNos).toBe('#SO-a, #SO-b');
  });

  it('treats a 5xx without a verdict as unconfirmed', async () => {
    const send = jest.fn().mockRejectedValue(serverReject(502));

    const [result] = await runBulkMerge([groups[0]], send, () => 'x');

    expect(result.status).toBe('unconfirmed');
  });

  it('retries an unconfirmed group with the same command and key', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ operationStatus: 'completed' });

    const [first] = await runBulkMerge([groups[0]], send, () => 'x');
    const second = await retryUnconfirmed(first, send, () => 'x');

    expect(second.status).toBe('done');
    expect(send.mock.calls[1][0]).toBe(send.mock.calls[0][0]);
    expect(send.mock.calls[1][0].idempotencyKey).toBe(
      first.command.idempotencyKey
    );
  });

  it('keeps the key when a retry is still unconfirmed', async () => {
    const send = jest.fn().mockRejectedValue(networkError());

    const [first] = await runBulkMerge([groups[0]], send, () => 'x');
    const second = await retryUnconfirmed(first, send, () => 'x');

    expect(second.status).toBe('unconfirmed');
    expect(second.command.idempotencyKey).toBe(first.command.idempotencyKey);
  });

  it('replaces only the retried result', () => {
    const base = (key: string, status: BulkResult['status']): BulkResult => ({
      key,
      orderNos: '',
      status,
      message: '',
      command: { idempotencyKey: key, data: { sources: [], reason: '' } },
    });

    expect(
      replaceResult(
        [base('x', 'done'), base('y', 'unconfirmed')],
        base('y', 'done')
      ).map((result) => result.status)
    ).toEqual(['done', 'done']);
  });
});

describe('summarizeBulk', () => {
  const result = (status: BulkResult['status']): BulkResult => ({
    key: status,
    orderNos: '',
    status,
    message: '',
    command: { idempotencyKey: 'k', data: { sources: [], reason: '' } },
  });

  it('reports successes, failures, and unconfirmed groups', () => {
    expect(summarizeBulk([result('done')])).toBe('1건을 모두 합쳤어요.');
    expect(
      summarizeBulk([result('done'), result('failed'), result('unconfirmed')])
    ).toBe(
      '3건 중 1건을 합쳤어요. 1건은 실패했어요. 1건은 결과를 확인해야 해요.'
    );
  });
});
