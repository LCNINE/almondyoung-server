import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { fixCompareAtPrices } from '../cart-prices';

type Item = {
  id: string;
  variant_id: string;
  quantity: number;
  unit_price: number;
  compare_at_unit_price: number | null;
  is_custom_price?: boolean;
};

// 정가 10,000 / 5개 이상 8,000(sale). 수량을 모르면 pricing 모듈은 정가만 남긴다.
function makeScope(items: Item[]) {
  const calculatePrices = jest.fn(
    async (filter: { id: string[] }, { context }: { context: { quantity?: number } }) =>
      filter.id.map((id) =>
        (context.quantity ?? 1) >= 5
          ? {
              id,
              calculated_amount: 8000,
              original_amount: 10000,
              calculated_price: { price_list_type: 'sale' },
            }
          : { id, calculated_amount: 10000, original_amount: 10000, calculated_price: { price_list_type: null } },
      ),
  );
  const updateLineItems = jest.fn(async () => []);
  const graph = jest.fn(async ({ entity }: { entity: string }) =>
    entity === 'cart'
      ? { data: [{ id: 'cart_1', currency_code: 'krw', region_id: 'reg_1', customer_id: 'cus_1', items }] }
      : { data: [...new Set(items.map((i) => i.variant_id))].map((id) => ({ id, price_set: { id: `ps_${id}` } })) },
  );
  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return { graph };
      if (key === Modules.PRICING) return { calculatePrices };
      if (key === Modules.CART) return { updateLineItems };
      throw new Error(`unexpected ${key}`);
    },
  };
  return { scope, calculatePrices, updateLineItems };
}

const cartOf = (items: Item[]) => ({ id: 'cart_1', items: items.map((i) => ({ variant_id: i.variant_id })) });
const updatedIds = (updateLineItems: jest.Mock) =>
  ((updateLineItems.mock.calls[0]?.[0] ?? []) as Array<{ id: string }>).map((u) => u.id);

describe('fixCompareAtPrices', () => {
  it('keeps the tier price for a quantity-6 line', async () => {
    const items = [
      { id: 'li_6', variant_id: 'var_a', quantity: 6, unit_price: 8000, compare_at_unit_price: 10000 },
    ];
    const { scope, updateLineItems } = makeScope(items);

    await fixCompareAtPrices(scope, cartOf(items));

    expect(updatedIds(updateLineItems)).not.toContain('li_6');
  });

  it('does not touch custom-priced lines', async () => {
    const items = [
      {
        id: 'li_custom',
        variant_id: 'var_b',
        quantity: 1,
        unit_price: 7000,
        compare_at_unit_price: 10000,
        is_custom_price: true,
      },
    ];
    const { scope, updateLineItems } = makeScope(items);

    await fixCompareAtPrices(scope, cartOf(items));

    expect(updatedIds(updateLineItems)).not.toContain('li_custom');
  });

  it('calls calculatePrices once per distinct quantity', async () => {
    const items = [
      { id: 'li_1', variant_id: 'var_a', quantity: 1, unit_price: 10000, compare_at_unit_price: null },
      { id: 'li_6a', variant_id: 'var_b', quantity: 6, unit_price: 8000, compare_at_unit_price: 10000 },
      { id: 'li_6b', variant_id: 'var_c', quantity: 6, unit_price: 8000, compare_at_unit_price: 10000 },
    ];
    const { scope, calculatePrices } = makeScope(items);

    await fixCompareAtPrices(scope, cartOf(items));

    expect(calculatePrices).toHaveBeenCalledTimes(2);
  });

  it('prices two lines of the same variant by their own quantities', async () => {
    const items = [
      { id: 'li_one', variant_id: 'var_a', quantity: 1, unit_price: 8000, compare_at_unit_price: 10000 },
      { id: 'li_six', variant_id: 'var_a', quantity: 6, unit_price: 10000, compare_at_unit_price: null },
    ];
    const { scope, updateLineItems } = makeScope(items);

    await fixCompareAtPrices(scope, cartOf(items));

    expect(updateLineItems).toHaveBeenCalledWith([
      { id: 'li_one', unit_price: 10000, compare_at_unit_price: null },
      { id: 'li_six', unit_price: 8000, compare_at_unit_price: 10000 },
    ]);
  });

  it('still lowers a stale price to the current one', async () => {
    const items = [
      { id: 'li_stale', variant_id: 'var_a', quantity: 6, unit_price: 10000, compare_at_unit_price: null },
    ];
    const { scope, updateLineItems } = makeScope(items);

    await fixCompareAtPrices(scope, cartOf(items));

    expect(updateLineItems).toHaveBeenCalledWith([
      { id: 'li_stale', unit_price: 8000, compare_at_unit_price: 10000 },
    ]);
  });
});
