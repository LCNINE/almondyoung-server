import { assemblePlannedShipments } from './planned-shipments.reader';
import { OptionLine } from './consolidation-shipment-reads';

function line(shipmentId: string, qty: number, patch: Partial<OptionLine> = {}): OptionLine {
  return {
    shipmentId,
    qty,
    salesOrderId: 'so',
    fulfillmentMode: 'in_house',
    skuStockType: 'stocked',
    skuName: 'sku',
    customerId: null,
    customerName: null,
    customerPhone: null,
    displayOrderNo: null,
    channelOrderId: null,
    salesChannel: null,
    salesOrderCreatedAt: null,
    ...patch,
  };
}

describe('assemblePlannedShipments', () => {
  it('상자마다 주문번호와 수량 합을 돌려준다', () => {
    const result = assemblePlannedShipments(
      ['a', 'b'],
      [
        line('a', 2, { displayOrderNo: '6321' }),
        line('a', 3, { displayOrderNo: '6321' }),
        line('b', 1, { channelOrderId: 'CH-9' }),
      ],
    );

    expect(result).toEqual([
      { shipmentId: 'a', orderNos: ['6321'], totalQty: 5 },
      { shipmentId: 'b', orderNos: ['CH-9'], totalQty: 1 },
    ]);
  });

  it('표시할 주문번호가 없어도 상자는 빠지지 않는다', () => {
    expect(assemblePlannedShipments(['a', 'c'], [line('a', 1)])).toEqual([
      { shipmentId: 'a', orderNos: [], totalQty: 1 },
      { shipmentId: 'c', orderNos: [], totalQty: 0 },
    ]);
  });
});
