import { refundKindEnum } from '../schema';
import { REFUND_KIND_LABELS, isRefundKind } from './refund-kind';

describe('refund-kind', () => {
  it('라벨 키는 enum 값과 정확히 같다', () => {
    expect(Object.keys(REFUND_KIND_LABELS).sort()).toEqual([...refundKindEnum.enumValues].sort());
  });

  it('화면 문구', () => {
    expect(REFUND_KIND_LABELS).toEqual({
      ITEM_CANCEL: '품목 취소',
      RETURN: '반품',
      PRICE_ADJUSTMENT: '금액 조정',
      SUBSCRIPTION_FEE: '구독료 환불',
      PAYMENT_ERROR: '결제 오류',
    });
  });

  it('isRefundKind: 정확한 철자만 true', () => {
    expect(isRefundKind('ITEM_CANCEL')).toBe(true);
    expect(isRefundKind('item_cancel')).toBe(false);
    expect(isRefundKind(null)).toBe(false);
    expect(isRefundKind(undefined)).toBe(false);
  });
});
