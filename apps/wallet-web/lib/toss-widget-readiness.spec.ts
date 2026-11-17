import { isTossWidgetReady } from './toss-widget-readiness';

describe('Toss widget readiness', () => {
  it('allows a full points payment when the widget has unmounted', () => {
    expect(isTossWidgetReady(0, true, null, false)).toBe(true);
  });
  it('requires a mounted widget with the current amount for a partial points payment', () => {
    expect(isTossWidgetReady(1000, true, 2000, true)).toBe(false);
    expect(isTossWidgetReady(1000, true, 1000, false)).toBe(false);
    expect(isTossWidgetReady(1000, true, 1000, true)).toBe(true);
  });
  it('does not block direct checkout or other payment methods', () => {
    expect(isTossWidgetReady(1000, false, null, false)).toBe(true);
  });
});
