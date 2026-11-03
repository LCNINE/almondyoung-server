import { ConsolidationBoardShipmentDto } from '../dto/consolidation.dto';
import { assembleConsolidationBoard, BoardRow, groupConsolidationBoard } from './consolidation-board.reader';
import { OptionLine, ShipmentProgress, ShipmentRow } from './consolidation-shipment-reads';

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
): BoardRow {
  return {
    customerKey,
    recipient,
    shipment: {
      shipmentId: id,
      status: 'draft',
      salesOrderNos: [],
      itemSummary: '',
      totalQty: 1,
      batchId: null,
      waybillTrackingNo: null,
      manifestVersion: 1,
      reservationVersion: 1,
      createdAt: new Date('2026-11-01T00:00:00Z'),
      orderedAt: null,
      salesChannels: [],
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

const noProgress: ShipmentProgress = { batchByShipment: new Map(), trackingByShipment: new Map() };

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
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].shipments.map((shipment) => shipment.shipmentId)).toEqual(['a', 'b']);
  });

  it('배치와 송장을 붙이고 canMergeNow 를 false 로 만든다', () => {
    const progress: ShipmentProgress = {
      batchByShipment: new Map([['b', 'batch-1']]),
      trackingByShipment: new Map([['a', '1234']]),
    };
    const [group] = assembleConsolidationBoard(
      [shipmentRow('a'), shipmentRow('b')],
      [optionLine('a'), optionLine('b')],
      progress,
    );

    expect(group.shipments.map((shipment) => [shipment.batchId, shipment.waybillTrackingNo])).toEqual([
      [null, '1234'],
      ['batch-1', null],
    ]);
    expect(group.canMergeNow).toBe(false);
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
    );

    expect(group.shipments[0].orderedAt).toEqual(new Date('2026-10-28T00:00:00Z'));
    expect(group.shipments[0].salesChannels).toEqual(['medusa', 'naver']);
    expect(group.canMergeNow).toBe(true);
  });
});
