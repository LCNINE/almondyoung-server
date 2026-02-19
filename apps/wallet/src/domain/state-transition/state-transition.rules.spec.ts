import {
  assertTransitionAllowed,
  canTransition,
} from './state-transition.rules';

describe('state-transition.rules', () => {
  it('allows valid intent transition', () => {
    expect(canTransition('INTENT', 'PENDING', 'IN_PROGRESS')).toBe(true);
    expect(() =>
      assertTransitionAllowed('INTENT', 'PENDING', 'IN_PROGRESS'),
    ).not.toThrow();
  });

  it('blocks invalid intent transition', () => {
    expect(canTransition('INTENT', 'SUCCEEDED', 'IN_PROGRESS')).toBe(false);
    expect(() =>
      assertTransitionAllowed('INTENT', 'SUCCEEDED', 'IN_PROGRESS'),
    ).toThrow('STATE_TRANSITION_NOT_ALLOWED');
  });

  it('allows manual queue processing flow', () => {
    expect(canTransition('MANUAL_CANCEL_QUEUE_ITEM', 'QUEUED', 'ASSIGNED')).toBe(
      true,
    );
    expect(
      canTransition('MANUAL_CANCEL_QUEUE_ITEM', 'PROCESSING', 'COMPLETED'),
    ).toBe(true);
  });

  it('blocks invalid manual queue transition', () => {
    expect(
      canTransition('MANUAL_CANCEL_QUEUE_ITEM', 'COMPLETED', 'PROCESSING'),
    ).toBe(false);
  });

  it('allows compensation attempt flow transitions', () => {
    expect(canTransition('ATTEMPT', 'SENT', 'CANCEL_REQUESTED')).toBe(true);
    expect(canTransition('ATTEMPT', 'CANCEL_REQUESTED', 'CANCELLED')).toBe(true);
    expect(canTransition('ATTEMPT', 'SENT', 'REFUND_REQUESTED')).toBe(true);
    expect(canTransition('ATTEMPT', 'REFUND_REQUESTED', 'REFUNDED')).toBe(true);
  });

  it('allows reconcile retry completion transitions', () => {
    expect(canTransition('LEG', 'RECONCILE_REQUIRED', 'REFUNDED')).toBe(true);
    expect(canTransition('INTENT', 'RECONCILE_REQUIRED', 'CANCELLED')).toBe(true);
    expect(
      canTransition('INTENT', 'SUPERSEDED_RECONCILE_REQUIRED', 'SUPERSEDED'),
    ).toBe(true);
  });
});
