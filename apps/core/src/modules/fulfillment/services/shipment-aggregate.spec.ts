import { aggregateSignature, ShipmentAggregate, ShipmentLineRow, ShipmentRow } from './shipment-aggregate';

function agg(shipmentId: string, lines: Array<{ id: string; item: string }>): ShipmentAggregate {
  return {
    shipment: { id: shipmentId } as ShipmentRow,
    lines: lines.map((l) => ({ id: l.id, fulfillmentOrderItemId: l.item, shipmentId }) as ShipmentLineRow),
    fulfillmentOrderIds: [],
  };
}

describe('aggregateSignature', () => {
  it('줄이 다른 상자로 옮겨지면 서명이 달라진다', () => {
    const before = [
      agg('s1', [
        { id: 'l1', item: 'i1' },
        { id: 'l2', item: 'i2' },
      ]),
      agg('s2', [{ id: 'l3', item: 'i3' }]),
    ];
    const after = [
      agg('s1', [{ id: 'l1', item: 'i1' }]),
      agg('s2', [
        { id: 'l3', item: 'i3' },
        { id: 'l2', item: 'i2' },
      ]),
    ];
    expect(aggregateSignature(after)).not.toBe(aggregateSignature(before));
  });

  it('상자·줄 순서가 달라도 같다', () => {
    const a = [
      agg('s1', [
        { id: 'l1', item: 'i1' },
        { id: 'l2', item: 'i2' },
      ]),
      agg('s2', [{ id: 'l3', item: 'i3' }]),
    ];
    const b = [
      agg('s2', [{ id: 'l3', item: 'i3' }]),
      agg('s1', [
        { id: 'l2', item: 'i2' },
        { id: 'l1', item: 'i1' },
      ]),
    ];
    expect(aggregateSignature(b)).toBe(aggregateSignature(a));
  });
});
