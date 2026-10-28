import { PURCHASE_SATISFACTION_REASON_LABELS } from '../reason-labels';

describe('PURCHASE_SATISFACTION_REASON_LABELS', () => {
  it('사유 7개가 정해진 순서와 문구 그대로다', () => {
    expect(Object.entries(PURCHASE_SATISFACTION_REASON_LABELS)).toEqual([
      ['ADDRESS_INPUT', '배송지 입력이 불편했어요'],
      ['COUPON_DISCOUNT', '쿠폰·할인 적용이 어려웠어요'],
      ['CASH_RECEIPT', '현금영수증 신청이 어려웠어요'],
      ['PAYMENT_METHOD', '결제 수단이 불편했어요'],
      ['PAYMENT_ERROR', '결제 중 오류가 났어요'],
      ['PRODUCT_SEARCH', '원하는 상품을 찾기 어려웠어요'],
      ['OTHER', '기타'],
    ]);
  });
});
