import { ConsolidationBoardShipmentDto } from '../dto/consolidation.dto';
import { BoardRow, groupConsolidationBoard } from './consolidation-board.reader';

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
    shipment: {
      shipmentId: id,
      status: 'draft',
      salesOrderNos: [],
      itemSummary: '',
      totalQty: 1,
      recipientSnapshot: recipient,
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
});
