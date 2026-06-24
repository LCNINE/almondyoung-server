import { canTransition } from './state-transition.rules';

describe('payment intent transition rules — AWAITING_DEPOSIT', () => {
  it('allows PROCESSING → AWAITING_DEPOSIT', () => {
    expect(canTransition('INTENT', 'PROCESSING', 'AWAITING_DEPOSIT')).toBe(true);
  });

  it('allows AWAITING_DEPOSIT → AUTHORIZED / CANCELED / FAILED', () => {
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'AUTHORIZED')).toBe(true);
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'CANCELED')).toBe(true);
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'FAILED')).toBe(true);
  });

  it('denies AWAITING_DEPOSIT → PROCESSING (no soft-reset of a deposit wait)', () => {
    expect(canTransition('INTENT', 'AWAITING_DEPOSIT', 'PROCESSING')).toBe(false);
  });

  it('keeps REQUIRES_ACTION → AUTHORIZED for backward compat', () => {
    expect(canTransition('INTENT', 'REQUIRES_ACTION', 'AUTHORIZED')).toBe(true);
  });
});
