import { calculatePricesByQuantity, priceKey } from '../prices-by-quantity';

describe('calculatePricesByQuantity', () => {
  it('asks the pricing module once per distinct quantity with that quantity in the context', async () => {
    const calls: Array<{ ids: string[]; quantity: unknown }> = [];
    const pricingModule = {
      calculatePrices: async (filters: { id: string[] }, { context }: { context: Record<string, unknown> }) => {
        calls.push({ ids: filters.id, quantity: context.quantity });
        return filters.id.map((id) => ({
          id,
          calculated_amount: 1000 * Number(context.quantity),
          original_amount: 1000,
        }));
      },
    };

    const prices = await calculatePricesByQuantity(
      pricingModule as never,
      [
        { priceSetId: 'ps-a', quantity: 3 },
        { priceSetId: 'ps-b', quantity: 3 },
        { priceSetId: 'ps-a', quantity: 1 },
        { priceSetId: 'ps-a', quantity: 3 },
      ],
      { currency_code: 'krw', region_id: 'reg' },
    );

    expect(calls).toEqual([
      { ids: ['ps-a', 'ps-b'], quantity: 3 },
      { ids: ['ps-a'], quantity: 1 },
    ]);
    expect(prices.get(priceKey(3, 'ps-b'))).toEqual({ calculated: 3000, original: 1000 });
    expect(prices.get(priceKey(1, 'ps-a'))).toEqual({ calculated: 1000, original: 1000 });
  });

  it('skips prices the module could not calculate', async () => {
    const pricingModule = {
      calculatePrices: async () => [{ id: 'ps-a', calculated_amount: null, original_amount: null }],
    };
    const prices = await calculatePricesByQuantity(pricingModule as never, [{ priceSetId: 'ps-a', quantity: 2 }], {});
    expect(prices.size).toBe(0);
  });

  it('marks prices that come from a sale price list', async () => {
    const pricingModule = {
      calculatePrices: async (filters: { id: string[] }) =>
        filters.id.map((id) => ({ id, calculated_amount: 800, original_amount: 1000, calculated_price: { price_list_type: 'sale' } })),
    };
    const prices = await calculatePricesByQuantity(pricingModule as never, [{ priceSetId: 'ps-a', quantity: 1 }], {});
    expect(prices.get(priceKey(1, 'ps-a'))).toEqual({ calculated: 800, original: 1000, sale: true });
  });
});
