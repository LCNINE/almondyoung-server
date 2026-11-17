import { knownTossPaymentKey, tossKeyOf } from './toss-widget-mode';

describe('tossKeyOf', () => {
  it('charge 에 남긴 checkoutMode 로 발급 때 쓴 키를 고른다', () => {
    expect(tossKeyOf({ nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' } })).toBe('WIDGET');
    expect(tossKeyOf({ nextAction: { type: 'BANK_TRANSFER_PENDING', checkoutMode: 'DIRECT' } })).toBe('DIRECT');
    expect(tossKeyOf({ nextAction: { type: 'TOSS_CHECKOUT' } })).toBe('LEGACY');
    expect(tossKeyOf(null)).toBe('LEGACY');
  });
});

describe('knownTossPaymentKey', () => {
  it('확정된 키 → 계좌 발급 때 남긴 키 → 승인 직전 표식 순으로 찾는다', () => {
    const payload = { paymentKey: 'pk_va', confirmAttempt: { paymentKey: 'pk_attempt' } };

    expect(knownTossPaymentKey(payload, 'pk_confirmed')).toBe('pk_confirmed');
    expect(knownTossPaymentKey(payload)).toBe('pk_va');
    expect(knownTossPaymentKey({ confirmAttempt: { paymentKey: 'pk_attempt' } })).toBe('pk_attempt');
    expect(knownTossPaymentKey({}, null)).toBeUndefined();
  });
});
