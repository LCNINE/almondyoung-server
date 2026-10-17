import { refundKindEnum } from '../schema';
import { REFUND_KIND_LABELS, isRefundKind, pgCancelReason } from './refund-kind';

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

describe("pgCancelReason", () => {
  it("종류가 있으면 reasonCode 와 상관없이 종류 이름", () => {
    expect(pgCancelReason({ kind: "ITEM_CANCEL", reasonCode: "MEDUSA_REFUND" })).toBe("품목 취소");
  });
  it("종류가 없으면 reasonCode 그대로", () => {
    expect(pgCancelReason({ kind: null, reasonCode: "엘라 품절" })).toBe("엘라 품절");
  });
  it("둘 다 없으면 undefined — provider 기본값이 쓰인다", () => {
    expect(pgCancelReason({ kind: null, reasonCode: null })).toBeUndefined();
  });
});
