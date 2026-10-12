import { refundRefusal } from './refund-refusal';

describe('refundRefusal — wallet 이 환불 요청을 거절할 때의 본문', () => {
  it('금액 초과류는 retryable=true — 호출자 장부와 wallet 이 어긋난 경합이다(맞춘 뒤 다시 보낸다)', () => {
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_CHARGE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', 'm').retryable).toBe(true);
  });

  it('수단·정책·데이터가 막는 거절은 retryable=false', () => {
    for (const code of [
      'REFUND_NOT_AUTOMATABLE',
      'MEMBERSHIP_REFUND_NOT_ALLOWED',
      'CHARGE_NOT_FOUND',
      'CHARGE_INTENT_MISMATCH',
      'CHARGE_NOT_REFUNDABLE',
      'PAYMENT_METHOD_NOT_FOUND',
      'INTENT_NOT_FOUND',
      'REFUNDABLE_CHARGE_NOT_FOUND',
    ] as const) {
      expect(refundRefusal(code, 'm').retryable).toBe(false);
    }
  });

  it('core WalletRefundClient 가 읽는 모양 그대로: error 는 코드 문자열, message 는 문자열', () => {
    // core 는 body.error 가 REFUND_AMOUNT_EXCEEDS_AVAILABLE·_TOTAL 이면 already_refunded 로 읽는다 — 이 두 이름이 바뀌면 안 된다
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', '초과')).toEqual({
      error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      message: '초과',
      retryable: true,
    });
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', '초과').error).toBe('REFUND_AMOUNT_EXCEEDS_TOTAL');
  });
});
