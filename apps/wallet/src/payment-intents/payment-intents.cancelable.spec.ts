import { CANCELABLE_INTENT_STATUSES } from './payment-intents.service';

describe('CANCELABLE_INTENT_STATUSES', () => {
  it('includes AWAITING_DEPOSIT so a pending deposit can be explicitly canceled', () => {
    expect(CANCELABLE_INTENT_STATUSES).toContain('AWAITING_DEPOSIT');
  });
});
