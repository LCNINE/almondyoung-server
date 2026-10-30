import { fulfillmentDetailHref } from './detail-href';

describe('출고주문 상세 주소', () => {
  it('상자 링크로 왔으면 shipmentId 를 붙여 보낸다', () => {
    expect(fulfillmentDetailHref('fo-1', 'ship-new')).toBe(
      '/order/fulfillments/fo-1?shipmentId=ship-new'
    );
  });

  it('shipmentId 가 없으면 상세 주소만 준다', () => {
    expect(fulfillmentDetailHref('fo-1')).toBe('/order/fulfillments/fo-1');
    expect(fulfillmentDetailHref('fo-1', '')).toBe('/order/fulfillments/fo-1');
  });
});
