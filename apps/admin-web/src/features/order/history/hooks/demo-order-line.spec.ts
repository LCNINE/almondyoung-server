import { isOrderLineMatched } from './demo-order-line';

describe('demo order matching display', () => {
  it('recognizes a demo line with a preselected variant without a legacy matching record', () => {
    expect(isOrderLineMatched({ variantId: 'demo-variant' }, 'demo')).toBe(true);
  });
  it('keeps unresolved demo lines unmatched', () => {
    expect(isOrderLineMatched({}, 'demo')).toBe(false);
  });
  it('outside demo, follows the core matchingResolved flag', () => {
    expect(isOrderLineMatched({ variantId: 'variant' }, 'live')).toBe(false);
    expect(isOrderLineMatched({ variantId: 'variant', matchingResolved: false }, 'live')).toBe(false);
    expect(isOrderLineMatched({ matchingResolved: true }, 'live')).toBe(true);
  });
});
