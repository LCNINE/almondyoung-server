import { parseCoupangJson, stringifyCoupangJson } from './coupang-json';

describe('coupang-json', () => {
  it('긴 ID 정수 리터럴을 자릿수 손실 없이 문자열로 읽는다', () => {
    const parsed = parseCoupangJson(
      '{"data":[{"shipmentBoxId":123456789012345678,"orderId":98765432109876543,"vendorItemId":3000000001}]}',
    );
    expect(parsed).toEqual({
      data: [{ shipmentBoxId: '123456789012345678', orderId: '98765432109876543', vendorItemId: 3000000001 }],
    });
  });

  it('배열 키(shipmentBoxIds)의 원소도 문자열로 읽는다', () => {
    expect(parseCoupangJson('{"shipmentBoxIds":[123456789012345678,2]}')).toEqual({
      shipmentBoxIds: ['123456789012345678', '2'],
    });
  });

  it('문자열 값 안의 같은 글자는 건드리지 않는다', () => {
    expect(parseCoupangJson('{"memo":"\\"orderId\\":1"}')).toEqual({ memo: '"orderId":1' });
  });

  it('receiptId 와 공백이 낀 형태도 읽고, 다른 숫자 배열은 그대로 둔다', () => {
    expect(parseCoupangJson('{ "receiptId" : 55 , "counts": [1, 2] }')).toEqual({ receiptId: '55', counts: [1, 2] });
  });

  it('직렬화는 긴 ID 를 따옴표 없는 정수로 쓴다', () => {
    expect(
      stringifyCoupangJson({ vendorId: 'A1', shipmentBoxIds: ['123456789012345678'], orderId: '42' }),
    ).toBe('{"vendorId":"A1","shipmentBoxIds":[123456789012345678],"orderId":42}');
  });

  it('숫자 모양이 아닌 값이나 다른 키의 문자열은 그대로 둔다', () => {
    expect(stringifyCoupangJson({ orderId: 'abc', memo: '123' })).toBe('{"orderId":"abc","memo":"123"}');
  });
});
