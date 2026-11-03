import type {
  ConsolidationBoardGroup,
  ConsolidationBoardShipment,
  PlannedShipment,
} from '@/lib/types/dto/fulfillment';
import {
  BATCH_ISSUE_LIMIT,
  PLANNED_LIST_LIMIT,
  filterPlanned,
  isPlannedListCapped,
  mergePairs,
  plannedOrderText,
} from './waybill-issue-model';

function planned(shipmentId: string, orderNos: string[]): PlannedShipment {
  return { shipmentId, orderNos, totalQty: 1 };
}

function boardShipment(shipmentId: string): ConsolidationBoardShipment {
  return {
    shipmentId,
    status: 'planned',
    salesOrderNos: [],
    itemSummary: '',
    totalQty: 1,
    batchId: null,
    waybillTrackingNo: null,
    manifestVersion: 1,
    reservationVersion: 1,
    createdAt: '2026-11-01T00:00:00Z',
    orderedAt: null,
    salesChannels: [],
  };
}

function group(key: string, ids: string[]): ConsolidationBoardGroup {
  return {
    key,
    recipientSnapshot: {},
    memoDiffers: false,
    canMergeNow: false,
    shipments: ids.map(boardShipment),
  };
}

const rows = [
  planned('a1111111-0000', ['6321']),
  planned('b2222222-0000', ['6322']),
  planned('c3333333-0000', ['6324']),
  planned('d4444444-0000', []),
];

describe('mergePairs', () => {
  it('고른 상자 둘이 한 묶음이면 짝을 돌려준다', () => {
    const pairs = mergePairs(
      ['a1111111-0000', 'b2222222-0000', 'c3333333-0000'],
      [group('g1', ['a1111111-0000', 'b2222222-0000'])],
      rows
    );

    expect(pairs).toEqual([
      {
        key: 'g1',
        shipmentIds: ['a1111111-0000', 'b2222222-0000'],
        labels: ['#6321', '#6322'],
      },
    ]);
  });

  it('묶음에서 한쪽만 골랐으면 짝이 없다', () => {
    expect(
      mergePairs(
        ['a1111111-0000'],
        [group('g1', ['a1111111-0000', 'b2222222-0000'])],
        rows
      )
    ).toEqual([]);
  });

  it('주문번호가 없는 상자는 상자 번호로 부른다', () => {
    const [pair] = mergePairs(
      ['a1111111-0000', 'd4444444-0000'],
      [group('g1', ['a1111111-0000', 'd4444444-0000'])],
      rows
    );

    expect(pair.labels).toEqual(['#6321', '상자 d4444444']);
  });

  it('묶음이 없으면 짝도 없다', () => {
    expect(mergePairs(['a1111111-0000', 'b2222222-0000'], [], rows)).toEqual(
      []
    );
  });
});

describe('plannedOrderText', () => {
  it('주문번호가 없으면 상자 번호 앞 여덟 자를 쓴다', () => {
    expect(plannedOrderText(rows[3])).toBe('상자 d4444444');
    expect(plannedOrderText(rows[0])).toBe('#6321');
  });
});

describe('filterPlanned', () => {
  it('주문번호나 상자 번호에 검색어가 들어 있으면 남긴다', () => {
    expect(filterPlanned(rows, '6322').map((row) => row.shipmentId)).toEqual([
      'b2222222-0000',
    ]);
    expect(filterPlanned(rows, 'd4444').map((row) => row.shipmentId)).toEqual([
      'd4444444-0000',
    ]);
    expect(filterPlanned(rows, '  ')).toHaveLength(4);
  });
});

describe('한도', () => {
  it('목록이 한도에 닿으면 잘렸다고 본다', () => {
    expect(isPlannedListCapped(PLANNED_LIST_LIMIT - 1)).toBe(false);
    expect(isPlannedListCapped(PLANNED_LIST_LIMIT)).toBe(true);
    expect(BATCH_ISSUE_LIMIT).toBe(100);
  });
});
