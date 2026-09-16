import { isOrderLineMatched } from './demo-order-line';

describe('demo order matching display', () => {
  it('recognizes a demo line with a preselected variant without a legacy matching record', () => {
    expect(isOrderLineMatched({ variantId: 'demo-variant' }, 'demo')).toBe(true);
  });
  it('keeps unresolved demo lines unmatched', () => {
    expect(isOrderLineMatched({}, 'demo')).toBe(false);
  });
  it('preserves legacy matching requirements outside demo', () => {
    expect(isOrderLineMatched({ variantId: 'variant' }, 'live')).toBe(false);
    expect(isOrderLineMatched({ productMatchingId: 'mapping' }, 'live')).toBe(true);
  });
});
