import { buildReplenishmentInput } from './demo-input';
describe('demo replenishment form input', () => {
  it('draws from the entire eligible catalog in random mode even when products are selected', () => {
    expect(
      buildReplenishmentInput('request', 'random', 5, [
        { components: [{ skuId: 'a' }] },
      ])
    ).toEqual({ requestId: 'request', mode: 'random', count: 5 });
  });
  it('deduplicates component SKUs across selected products', () => {
    expect(
      buildReplenishmentInput('request', 'specified', 5, [
        { components: [{ skuId: 'b' }, { skuId: 'a' }] },
        { components: [{ skuId: 'a' }] },
      ])
    ).toEqual({ requestId: 'request', mode: 'specified', skuIds: ['a', 'b'] });
  });
  it.each([0, 21, 1.5, NaN])('rejects invalid random count %s', (count) => {
    expect(() =>
      buildReplenishmentInput('request', 'random', count, [])
    ).toThrow();
  });
  it('rejects empty or over-limit manual selections', () => {
    expect(() =>
      buildReplenishmentInput('request', 'specified', 5, [])
    ).toThrow();
    expect(() =>
      buildReplenishmentInput('request', 'specified', 5, [
        {
          components: Array.from({ length: 21 }, (_, i) => ({
            skuId: String(i),
          })),
        },
      ])
    ).toThrow();
  });
});
