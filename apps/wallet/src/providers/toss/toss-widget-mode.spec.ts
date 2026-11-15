import { knownTossPaymentKey, usesTossWidget } from './toss-widget-mode';

describe('usesTossWidget', () => {
  it('identifies widget charges from the stored checkout action', () => {
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT', checkoutMode: 'WIDGET' } })).toBe(true);
    expect(usesTossWidget({ nextAction: { type: 'TOSS_CHECKOUT' } })).toBe(false);
    expect(usesTossWidget(null)).toBe(false);
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
