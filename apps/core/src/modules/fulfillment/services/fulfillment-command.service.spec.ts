import { canonicalFulfillmentRequestHash } from './fulfillment-command.service';

describe('canonicalFulfillmentRequestHash', () => {
  it('is stable across object key order and omitted undefined fields', () => {
    expect(canonicalFulfillmentRequestHash({ b: 2, nested: { z: 1, a: 'x' } })).toBe(
      canonicalFulfillmentRequestHash({ nested: { a: 'x', z: 1 }, ignored: undefined, b: 2 }),
    );
  });

  it('keeps array order significant so callers must normalize set-like command fields', () => {
    expect(canonicalFulfillmentRequestHash({ ids: ['a', 'b'] })).not.toBe(
      canonicalFulfillmentRequestHash({ ids: ['b', 'a'] }),
    );
  });
});
