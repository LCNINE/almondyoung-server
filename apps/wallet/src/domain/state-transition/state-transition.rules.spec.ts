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
});
