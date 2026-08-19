import { parseNaverProductOrderInfo } from './naver-order-fields';

const raw = {
  order: {
    orderId: '2026081900000',
    paymentDate: '2026-08-19T00:00:00.000+09:00',
    ordererName: '홍길동',
    ordererTel: '010-0000-0000',
  },
  productOrder: {
    productOrderId: '2026081900001',
    productOrderStatus: 'PAYED',
    productId: '13700000002',
    productName: '아몬드영 세럼',
    quantity: 2,
    unitPrice: 12000,
    totalPaymentAmount: 24000,
    shippingAddress: {
      name: '홍길동',
      tel1: '010-0000-0000',
      zipCode: '06236',
      baseAddress: '서울 강남구 테헤란로 1',
      detailedAddress: '10층',
    },
  },
};

describe('parseNaverProductOrderInfo', () => {
  it('필요한 필드만 뽑아 좁힌 모양으로 돌려준다', () => {
    const parsed = parseNaverProductOrderInfo(raw);
    expect(parsed.orderId).toBe('2026081900000');
    expect(parsed.productOrderId).toBe('2026081900001');
    expect(parsed.channelProductId).toBe('13700000002');
    expect(parsed.quantity).toBe(2);
    expect(parsed.shippingAddress.postalCode).toBe('06236');
  });

  it('모르는 필드가 더 있어도 통과한다', () => {
    expect(() => parseNaverProductOrderInfo({ ...raw, unknownTopLevel: 1 })).not.toThrow();
  });

  it('필수 식별자가 없으면 throw 한다 — 조용히 넘기지 않는다', () => {
    expect(() => parseNaverProductOrderInfo({ ...raw, productOrder: { ...raw.productOrder, productOrderId: undefined } })).toThrow();
  });
});
