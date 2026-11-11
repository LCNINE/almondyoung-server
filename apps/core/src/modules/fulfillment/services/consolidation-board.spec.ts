import { ConsolidationBoardShipmentDto } from '../dto/consolidation.dto';
import { assembleConsolidationBoard, BoardRow, groupConsolidationBoard } from './consolidation-board.reader';
import { OptionLine, ShipmentProgress, ShipmentRow, splitSharesOf } from './consolidation-shipment-reads';

const address = {
  recipientName: '김알몬',
  phone: '010-1234-5678',
  postalCode: '14500',
  roadAddress: '경기 부천시 원미로 12',
  detailAddress: '101호',
};

function row(
  id: string,
  recipient: Record<string, string> = address,
  customerKey: string | null = 'id:c1',
  patch: Partial<ConsolidationBoardShipmentDto> = {},
  shippingProfileId: string | null = 'p1',
): BoardRow {
  return {
    customerKey,
    shippingProfileId,
    recipient,
    shipment: {
      shipmentId: id,
      status: 'draft',
      salesOrderNos: [],
      itemSummary: '',
      totalQty: 1,
      items: [],
      batchId: null,
      waybillTrackingNo: null,
      manifestVersion: 1,
      reservationVersion: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      orderedAt: null,
      salesChannels: [],
      split: null,
      ...patch,
    },
  };
}

describe('groupConsolidationBoard', () => {
  it('같은 고객 같은 주소 두 상자는 한 묶음이다', () => {
    const groups = groupConsolidationBoard([row('a'), row('b')]);

    expect(groups).toHaveLength(1);
    expect(groups[0].shipments.map((shipment) => shipment.shipmentId)).toEqual(['a', 'b']);
    expect(groups[0].memoDiffers).toBe(false);
    expect(groups[0].canMergeNow).toBe(true);
  });

  it('메모만 달라도 한 묶음이고 memoDiffers 가 true 다', () => {
    const groups = groupConsolidationBoard([row('a'), row('b', { ...address, deliveryNote: '문 앞' })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].memoDiffers).toBe(true);
  });

  it('주소가 다르면 갈라지고 한 상자짜리 묶음은 돌려주지 않는다', () => {
    const groups = groupConsolidationBoard([row('a'), row('b', { ...address, roadAddress: '서울 마포구 양화로 45' })]);

    expect(groups).toEqual([]);
  });

  it('같은 고객 같은 주소라도 배송 프로필이 다르면 따로 묶는다', () => {
    const groups = groupConsolidationBoard([
      row('a'),
      row('b'),
      row('c', address, 'id:c1', {}, 'p2'),
      row('d', address, 'id:c1', {}, 'p2'),
    ]);

    expect(groups.map((group) => group.shipments.map((shipment) => shipment.shipmentId))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(
      groupConsolidationBoard([row('a'), row('b'), row('c', address, 'id:c1', {}, 'p2')])[0].shipments,
    ).toHaveLength(2);
    expect(groupConsolidationBoard([row('a'), row('c', address, 'id:c1', {}, 'p2')])).toEqual([]);
  });

  it('배송 프로필이 없는 상자는 뺀다', () => {
    expect(
      groupConsolidationBoard([row('a', address, 'id:c1', {}, null), row('b', address, 'id:c1', {}, null)]),
    ).toEqual([]);
  });

  it('고객 키가 없는 상자는 뺀다', () => {
    expect(groupConsolidationBoard([row('a', address, null), row('b', address, null)])).toEqual([]);
  });

  it('세 상자 묶음은 그대로 유지한다', () => {
    const groups = groupConsolidationBoard([row('a'), row('b'), row('c')]);

    expect(groups).toHaveLength(1);
    expect(groups[0].shipments).toHaveLength(3);
  });

  it('상세주소가 비어 있는 상자끼리 한 묶음이다', () => {
    const empty = { ...address, detailAddress: '' };

    expect(groupConsolidationBoard([row('a', empty), row('b', empty)])).toHaveLength(1);
  });

  it('배치나 송장이 있거나 planned 인 상자가 있으면 canMergeNow 가 false 다', () => {
    expect(groupConsolidationBoard([row('a'), row('b', address, 'id:c1', { batchId: 'x' })])[0].canMergeNow).toBe(
      false,
    );
    expect(
      groupConsolidationBoard([row('a'), row('b', address, 'id:c1', { waybillTrackingNo: '123' })])[0].canMergeNow,
    ).toBe(false);
    expect(groupConsolidationBoard([row('a'), row('b', address, 'id:c1', { status: 'planned' })])[0].canMergeNow).toBe(
      false,
    );
  });

  it('고객이 다르면 주소가 같아도 갈라진다', () => {
    expect(groupConsolidationBoard([row('a'), row('b', address, 'id:c2')])).toEqual([]);
  });

  it('응답 키에 수령인 원문이 없고 상자에는 수령인이 없다', () => {
    const [group] = groupConsolidationBoard([row('a'), row('b')]);

    expect(group.key).toMatch(/^[0-9a-f]{64}$/);

    for (const value of Object.values(address)) {
      expect(group.key).not.toContain(value);
    }

    for (const shipment of group.shipments) {
      expect(Object.keys(shipment)).not.toContain('recipientSnapshot');
    }

    expect(JSON.stringify(group.shipments)).not.toContain(address.phone);
    expect(JSON.stringify(group.shipments)).not.toContain(address.roadAddress);
  });
});

function shipmentRow(id: string, patch: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id,
    warehouseId: 'w1',
    supplierId: null,
    supplierHandoffId: null,
    openedForFulfillmentOrderId: null,
    status: 'draft',
    shippingProfileId: 'p1',
    recipientSnapshot: address,
    entrancePassword: null,
    manifestVersion: 1,
    reservationVersion: 1,
    openedBy: null,
    openedAt: new Date('2026-11-01T00:00:00Z'),
    plannedAt: null,
    shippedAt: null,
    deliveredAt: null,
    supersededAt: null,
    recoveryCode: null,
    lastUpdated: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...patch,
  };
}

function optionLine(shipmentId: string, patch: Partial<OptionLine> = {}): OptionLine {
  return {
    shipmentId,
    qty: 1,
    salesOrderId: `so-${shipmentId}`,
    fulfillmentMode: 'in_house',
    skuStockType: 'stocked',
    skuProfileId: 'p1',
    skuId: 'sku-1',
    skuName: '상품',
    customerId: 'c1',
    customerName: '김알몬',
    customerPhone: '010-1234-5678',
    displayOrderNo: null,
    channelOrderId: `ch-${shipmentId}`,
    salesChannel: 'medusa',
    salesOrderCreatedAt: new Date('2026-11-02T00:00:00Z'),
    ...patch,
  };
}

const inHouse = new Set(['p1']);
const noProgress: ShipmentProgress = {
  batchByShipment: new Map(),
  trackingByShipment: new Map(),
  splitByShipment: new Map(),
};

describe('assembleConsolidationBoard', () => {
  it('공급사 상자와 in_house 아닌 라인, drop_shipped 라인이 있는 상자를 뺀다', () => {
    const groups = assembleConsolidationBoard(
      [
        shipmentRow('a'),
        shipmentRow('b'),
        shipmentRow('s', { supplierId: 'sup' }),
        shipmentRow('d', { shippingProfileId: 'p1' }),
        shipmentRow('x'),
      ],
      [
        optionLine('a'),
        optionLine('b'),
        optionLine('s'),
        optionLine('d', { fulfillmentMode: 'drop_ship' }),
        optionLine('x', { skuStockType: 'drop_shipped' }),
      ],
      noProgress,
      inHouse,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].shipments.map((shipment) => shipment.shipmentId)).toEqual(['a', 'b']);
  });

  it('배치와 송장을 붙이고 canMergeNow 를 false 로 만든다', () => {
    const progress: ShipmentProgress = {
      batchByShipment: new Map([['b', 'batch-1']]),
      trackingByShipment: new Map([['a', '1234']]),
      splitByShipment: new Map(),
    };
    const [group] = assembleConsolidationBoard(
      [shipmentRow('a'), shipmentRow('b')],
      [optionLine('a'), optionLine('b')],
      progress,
      inHouse,
    );

    expect(group.shipments.map((shipment) => [shipment.batchId, shipment.waybillTrackingNo])).toEqual([
      [null, '1234'],
      ['batch-1', null],
    ]);
    expect(group.canMergeNow).toBe(false);
  });

  it('나눈 상자의 몫을 상자마다 싣는다', () => {
    const [group] = assembleConsolidationBoard(
      [shipmentRow('a'), shipmentRow('b')],
      [optionLine('a'), optionLine('b')],
      { ...noProgress, splitByShipment: new Map([['b', { boxQty: 1, orderQty: 3, boxNo: 2, boxCount: 2 }]]) },
      inHouse,
    );

    expect(group.shipments.map((shipment) => shipment.split)).toEqual([
      null,
      { boxQty: 1, orderQty: 3, boxNo: 2, boxCount: 2 },
    ]);
  });

  it('상자마다 담긴 상품을 같은 상품끼리 합친 수량으로 처음 나온 순서대로 싣는다', () => {
    const [group] = assembleConsolidationBoard(
      [shipmentRow('a'), shipmentRow('b')],
      [
        optionLine('a', { skuId: 'sku-1', skuName: '립밤', qty: 1 }),
        optionLine('b', { skuId: 'sku-1', skuName: '립밤', qty: 2 }),
        optionLine('b', { skuId: 'sku-2', skuName: '핸드크림', qty: 1 }),
        optionLine('b', { skuId: 'sku-1', skuName: '립밤', qty: 1 }),
      ],
      noProgress,
      inHouse,
    );

    expect(group.shipments.map((shipment) => shipment.items)).toEqual([
      [{ skuId: 'sku-1', name: '립밤', qty: 1 }],
      [
        { skuId: 'sku-1', name: '립밤', qty: 3 },
        { skuId: 'sku-2', name: '핸드크림', qty: 1 },
      ],
    ]);
  });

  it('가장 이른 주문 시각과 판매채널을 모은다', () => {
    const [group] = assembleConsolidationBoard(
      [shipmentRow('a'), shipmentRow('b')],
      [
        optionLine('a', { salesOrderId: 'so1', salesOrderCreatedAt: new Date('2026-10-30T00:00:00Z') }),
        optionLine('a', {
          salesOrderId: 'so1',
          salesChannel: 'naver',
          salesOrderCreatedAt: new Date('2026-10-28T00:00:00Z'),
        }),
        optionLine('b'),
      ],
      noProgress,
      inHouse,
    );

    expect(group.shipments[0].orderedAt).toEqual(new Date('2026-10-28T00:00:00Z'));
    expect(group.shipments[0].salesChannels).toEqual(['medusa', 'naver']);
    expect(group.canMergeNow).toBe(true);
  });

  it('상품 배송 프로필이 상자와 다르거나 프로필이 in_house 를 지원하지 않으면 뺀다', () => {
    const shipments = [shipmentRow('a'), shipmentRow('b'), shipmentRow('c')];
    const lines = [optionLine('a'), optionLine('b'), optionLine('c')];

    expect(
      assembleConsolidationBoard(
        shipments,
        [optionLine('a'), optionLine('b', { skuProfileId: 'p2' }), optionLine('c')],
        noProgress,
        inHouse,
      )[0].shipments.map((shipment) => shipment.shipmentId),
    ).toEqual(['a', 'c']);
    expect(
      assembleConsolidationBoard(
        shipments,
        [optionLine('a'), optionLine('b', { skuProfileId: null }), optionLine('c', { salesOrderId: null })],
        noProgress,
        inHouse,
      ),
    ).toEqual([]);
    expect(assembleConsolidationBoard(shipments, lines, noProgress, new Set())).toEqual([]);
  });
});

describe('splitSharesOf', () => {
  it('나누기로 이어진 상자끼리 같은 묶음 수량과 만든 순서 번호를 쓰고 나뉜 적 없는 상자는 뺀다', () => {
    const shares = splitSharesOf(
      [
        { operationId: 'op1', shipmentId: 'kept' },
        { operationId: 'op1', shipmentId: 'moved' },
      ],
      [
        { shipmentId: 'kept', qty: 1 },
        { shipmentId: 'alone', qty: 2 },
        { shipmentId: 'moved', qty: 4 },
      ],
      ['kept', 'moved', 'alone', 'missing'],
    );

    expect([...shares]).toEqual([
      ['kept', { boxQty: 1, orderQty: 5, boxNo: 1, boxCount: 2 }],
      ['moved', { boxQty: 4, orderQty: 5, boxNo: 2, boxCount: 2 }],
    ]);
  });

  it('여러 번 나눈 상자와 이미 나간 상자도 한 묶음으로 세고 합쳐져 사라진 상자는 뺀다', () => {
    const shares = splitSharesOf(
      [
        { operationId: 'op1', shipmentId: 'shipped' },
        { operationId: 'op1', shipmentId: 'second' },
        { operationId: 'op2', shipmentId: 'second' },
        { operationId: 'op2', shipmentId: 'third' },
        { operationId: 'op3', shipmentId: 'third' },
        { operationId: 'op3', shipmentId: 'merged-away' },
      ],
      [
        { shipmentId: 'shipped', qty: 2 },
        { shipmentId: 'second', qty: 1 },
        { shipmentId: 'third', qty: 3 },
      ],
      ['second', 'third'],
    );

    expect([...shares]).toEqual([
      ['second', { boxQty: 1, orderQty: 6, boxNo: 2, boxCount: 3 }],
      ['third', { boxQty: 3, orderQty: 6, boxNo: 3, boxCount: 3 }],
    ]);
  });

  it('살아 있는 짝이 없으면 나눈 상자로 보지 않는다', () => {
    const shares = splitSharesOf(
      [
        { operationId: 'op1', shipmentId: 'left' },
        { operationId: 'op1', shipmentId: 'merged-away' },
      ],
      [{ shipmentId: 'left', qty: 2 }],
      ['left'],
    );

    expect(shares.size).toBe(0);
  });
});
