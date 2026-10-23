import { refundDecisionActionsOf } from './refund-decision-actions';

const base = { isFirstOfOrder: true, orderStatus: 'cancelled', walletIntentId: 'w1' };

describe('refundDecisionActionsOf', () => {
  it('취소된 core 결제 주문의 결정 대기는 실행·안 함 둘 다', () => {
    expect(
      refundDecisionActionsOf({ ...base, refundStatus: 'manual_pending', refundAwaitingDecision: true, refundLinkId: 'l1' }),
    ).toEqual({ execute: true, waive: true });
  });
  it('살아 있는 주문(부분취소)의 결정 대기는 안 함만', () => {
    expect(
      refundDecisionActionsOf({ ...base, orderStatus: 'confirmed', refundStatus: 'manual_pending', refundAwaitingDecision: true, refundLinkId: 'l1' }),
    ).toEqual({ execute: false, waive: true });
  });
  it('requested 는 실행만', () => {
    expect(refundDecisionActionsOf({ ...base, refundStatus: 'requested', refundAwaitingDecision: true })).toEqual({ execute: true, waive: false });
  });
  it('옛 manual_pending 이나 첫 행이 아닌 행은 버튼 없음', () => {
    expect(refundDecisionActionsOf({ ...base, refundStatus: 'manual_pending', refundLinkId: 'l1' })).toEqual({ execute: false, waive: false });
    expect(refundDecisionActionsOf({ ...base, isFirstOfOrder: false, refundStatus: 'requested', refundAwaitingDecision: true })).toEqual({ execute: false, waive: false });
  });
});
