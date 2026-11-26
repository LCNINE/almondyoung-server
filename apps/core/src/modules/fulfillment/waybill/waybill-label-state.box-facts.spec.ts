import { boxFactsOf } from './waybill-label-state.reader';

describe('boxFactsOf', () => {
  it('collects order numbers and distinct sku count per box', () => {
    const facts = boxFactsOf([
      { shipmentId: 's-1', skuId: 'sku-1', displayOrderNo: '20261126-0002', channelOrderId: 'order_b' },
      { shipmentId: 's-1', skuId: 'sku-2', displayOrderNo: '20261126-0001', channelOrderId: 'order_a' },
      { shipmentId: 's-1', skuId: 'sku-1', displayOrderNo: '20261126-0002', channelOrderId: 'order_b' },
      { shipmentId: 's-2', skuId: 'sku-3', displayOrderNo: null, channelOrderId: 'order_c' },
      { shipmentId: 's-3', skuId: 'sku-4', displayOrderNo: null, channelOrderId: null },
    ]);

    expect(facts.get('s-1')).toEqual({ orderNos: ['20261126-0001', '20261126-0002'], skuKinds: 2 });
    expect(facts.get('s-2')).toEqual({ orderNos: ['order_c'], skuKinds: 1 });
    expect(facts.get('s-3')).toEqual({ orderNos: [], skuKinds: 1 });
    expect(facts.get('s-4')).toBeUndefined();
  });
});
