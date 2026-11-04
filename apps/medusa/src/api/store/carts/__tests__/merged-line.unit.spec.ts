import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { findMergedLine, mergedLineNeedsReprice } from '../merged-line';

const line = (quantity: number, metadata?: Record<string, unknown> | null) => ({
  id: 'li_1',
  variant_id: 'var_a',
  quantity,
  unit_price: 10000,
  metadata,
});

describe('findMergedLine', () => {
  it('returns the matching line when it holds more than was just added', () => {
    expect(findMergedLine([line(6)], { variant_id: 'var_a', quantity: 3 })?.id).toBe('li_1');
  });

  it('returns null when the line holds exactly what was added (a new line)', () => {
    expect(findMergedLine([line(3)], { variant_id: 'var_a', quantity: 3 })).toBeNull();
  });

  it('treats null and empty metadata as the same line', () => {
    expect(findMergedLine([line(6, null)], { variant_id: 'var_a', quantity: 3, metadata: {} })?.id).toBe('li_1');
  });

  it('ignores a line of the same variant with different metadata', () => {
    expect(findMergedLine([line(6, { bundle: { a: 1 } })], { variant_id: 'var_a', quantity: 3 })).toBeNull();
  });

  it('returns null when no line has the variant', () => {
    expect(findMergedLine([], { variant_id: 'var_a', quantity: 3 })).toBeNull();
  });
});

describe('mergedLineNeedsReprice', () => {
  function makeScope(calculate: (quantity: number) => number | Error) {
    const calculatePrices = jest.fn(async (_filter: unknown, { context }: { context: { quantity: number } }) => {
      const result = calculate(context.quantity);
      if (result instanceof Error) throw result;
      return [{ id: 'ps_a', calculated_amount: result }];
    });
    const graph = jest.fn(async ({ entity }: { entity: string }) =>
      entity === 'cart'
        ? { data: [{ id: 'cart_1', currency_code: 'krw', region_id: 'reg_1', customer_id: null, customer: null }] }
        : { data: [{ id: 'var_a', price_set: { id: 'ps_a' } }] },
    );
    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph };
        if (key === Modules.PRICING) return { calculatePrices };
        throw new Error(`unexpected ${key}`);
      },
    };
    return { scope, calculatePrices };
  }

  it('is true when the merged quantity has a different price', async () => {
    const { scope, calculatePrices } = makeScope((q) => (q >= 5 ? 8000 : 10000));

    await expect(mergedLineNeedsReprice(scope, 'cart_1', line(6))).resolves.toBe(true);
    expect(calculatePrices.mock.calls[0][1].context.quantity).toBe(6);
  });

  it('is false when the merged quantity keeps the same price', async () => {
    const { scope } = makeScope(() => 10000);

    await expect(mergedLineNeedsReprice(scope, 'cart_1', line(4))).resolves.toBe(false);
  });

  it('is false for a custom-priced line', async () => {
    const { scope, calculatePrices } = makeScope(() => 8000);

    await expect(mergedLineNeedsReprice(scope, 'cart_1', { ...line(6), is_custom_price: true })).resolves.toBe(false);
    expect(calculatePrices).not.toHaveBeenCalled();
  });

  it('is true when the price lookup fails so the cart is repriced anyway', async () => {
    const { scope } = makeScope(() => new Error('pricing down'));

    await expect(mergedLineNeedsReprice(scope, 'cart_1', line(6))).resolves.toBe(true);
  });
});
