import { parseRefundFailureCode, readRefundFailure } from './refund-failure';

describe('Medusa 환불 거절 표지 (#1016 36번)', () => {
  it('전체취소 400 의 code — 갈래와 wallet 코드를 읽는다', () => {
    expect(parseRefundFailureCode('wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL')).toEqual({
      kind: 'ledger_mismatch',
      walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
    });
    expect(parseRefundFailureCode('wallet_refund_refused:REFUND_NOT_AUTOMATABLE')).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
  });

  it.each([undefined, null, 42, '', 'partial_cancel_rejected', 'wallet_refund_other:X', 'wallet_refund_refused:', 'wallet_refund_refused'])(
    '표지가 아니면 null — %p',
    (code) => {
      expect(parseRefundFailureCode(code)).toBeNull();
    },
  );

  it('부분취소 502 본문의 refundFailure 객체를 읽는다', () => {
    expect(readRefundFailure({ kind: 'refused', walletCode: 'REFUND_NOT_AUTOMATABLE' })).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
    expect(readRefundFailure({ kind: 'other', walletCode: 'X' })).toBeNull();
    expect(readRefundFailure({ kind: 'refused', walletCode: '' })).toBeNull();
    expect(readRefundFailure(undefined)).toBeNull();
    expect(readRefundFailure('wallet_refund_refused:X')).toBeNull();
  });
});
