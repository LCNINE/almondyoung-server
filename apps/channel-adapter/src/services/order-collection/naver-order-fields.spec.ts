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

  // 클레임 칸은 공식 Q&A(commerce-api discussions/1773) 기준 추정 이름이다 — shadow 점검 전까지 선택 칸.
  it('클레임 식별·종류·현재 클레임의 취소 요청 수량을 읽는다', () => {
    const parsed = parseNaverProductOrderInfo({
      ...raw,
      productOrder: { ...raw.productOrder, claimStatus: 'CANCEL_REQUEST', claimId: 'cl-1', claimType: 'CANCEL' },
      currentClaim: { cancel: { requestQuantity: 1 } },
    });
    expect(parsed.claimId).toBe('cl-1');
    expect(parsed.claimType).toBe('CANCEL');
    expect(parsed.cancelClaimQuantity).toBe(1);
  });

  // 플래그를 모든 조회에 싣으므로 `null` 이 흔할 수 있다 — 그걸로 파싱이 터지면 네이버 주문 전부가 처리 실패로 돈다.
  it('클레임 칸이 null 이면 없는 것으로 보고 throw 하지 않는다', () => {
    const parsed = parseNaverProductOrderInfo({
      ...raw,
      productOrder: { ...raw.productOrder, claimId: null, claimType: null },
      currentClaim: null,
    });
    expect(parsed).not.toHaveProperty('claimId');
    expect(parsed).not.toHaveProperty('claimType');
    expect(parsed).not.toHaveProperty('cancelClaimQuantity');
    expect(() =>
      parseNaverProductOrderInfo({ ...raw, currentClaim: { cancel: null } }),
    ).not.toThrow();
    expect(() =>
      parseNaverProductOrderInfo({ ...raw, currentClaim: { cancel: { requestQuantity: null } } }),
    ).not.toThrow();
  });

  it('클레임 수량이 있는데 모양이 틀리면 throw 한다 — 틀린 수량으로 조용히 취소하지 않는다', () => {
    expect(() =>
      parseNaverProductOrderInfo({ ...raw, currentClaim: { cancel: { requestQuantity: '1' } } }),
    ).toThrow();
  });

  it('클레임 식별이 숫자로 와도 문자열로 받는다', () => {
    const parsed = parseNaverProductOrderInfo({ ...raw, productOrder: { ...raw.productOrder, claimId: 123 } });
    expect(parsed.claimId).toBe('123');
  });

  it('클레임 칸이 없어도 throw 하지 않고 키를 두지 않는다', () => {
    const parsed = parseNaverProductOrderInfo(raw);
    expect(parsed).not.toHaveProperty('claimId');
    expect(parsed).not.toHaveProperty('claimType');
    expect(parsed).not.toHaveProperty('cancelClaimQuantity');
    expect(() => parseNaverProductOrderInfo({ ...raw, currentClaim: {} })).not.toThrow();
  });

  it('unitPrice 누락 시 throw 한다 — 매출이 0 으로 조용히 기록되는 회복 불가 사태를 방지한다', () => {
    expect(() => parseNaverProductOrderInfo({ ...raw, productOrder: { ...raw.productOrder, unitPrice: undefined } })).toThrow();
  });
});
