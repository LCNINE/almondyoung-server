import { parsePracticeRequest } from './demo-practice.service';

describe('demo practice input', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const skuId = '22222222-2222-4222-8222-222222222222';
  it('normalizes selection order so the same request has one identity', () => {
    const other = '33333333-3333-4333-8333-333333333333';
    const one = parsePracticeRequest({
      requestId,
      items: [
        { skuId: other, quantity: 3 },
        { skuId, quantity: 2 },
      ],
    });
    const two = parsePracticeRequest({
      requestId,
      items: [
        { skuId, quantity: 2 },
        { skuId: other, quantity: 3 },
      ],
    });
    expect(one).toEqual(two);
    expect(one.prepareDemand).toBe(false);
  });
  it.each([0, -1, 0.5, 1001])('rejects invalid physical quantities %s', (quantity) => {
    expect(() => parsePracticeRequest({ requestId, items: [{ skuId, quantity }] })).toThrow();
  });
  it('rejects duplicate SKU and empty selections before any inventory write', () => {
    expect(() => parsePracticeRequest({ requestId, items: [] })).toThrow();
    expect(() =>
      parsePracticeRequest({
        requestId,
        items: [
          { skuId, quantity: 1 },
          { skuId, quantity: 2 },
        ],
      }),
    ).toThrow();
  });
});
