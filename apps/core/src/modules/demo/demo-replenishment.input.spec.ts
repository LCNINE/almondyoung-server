import { randomUUID } from 'crypto';
import { parseDemoReplenishmentRequest } from './demo-replenishment.input';
describe('demo replenishment input', () => {
  const requestId = randomUUID();
  it('defaults to five random products and normalizes explicit SKU order', () => {
    expect(parseDemoReplenishmentRequest({ requestId })).toEqual({ requestId, mode: 'random', count: 5 });
    const ids = [randomUUID(), randomUUID()].sort();
    expect(parseDemoReplenishmentRequest({ requestId, mode: 'specified', skuIds: [...ids].reverse() })).toEqual({
      requestId,
      mode: 'specified',
      skuIds: ids,
    });
  });
  it.each([
    { count: 0 },
    { count: 21 },
    { count: 1.5 },
    { count: '5' },
    { mode: 'specified', skuIds: [] },
    { mode: 'specified', skuIds: ['bad'] },
    { mode: 'random', skuIds: [randomUUID()] },
    { mode: 'specified', skuIds: [requestId, requestId] },
  ])('rejects malformed or ambiguous requests %j', (body) => {
    expect(() => parseDemoReplenishmentRequest({ requestId, ...body })).toThrow();
  });
});
