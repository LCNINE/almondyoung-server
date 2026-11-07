import handleOrderPriceBreakdown, { buildPriceBreakdowns, config } from '../order-price-breakdown';

const tierMeta = { tieredPrices: [{ minQuantity: 3, price: 9500 }] };

describe('buildPriceBreakdowns', () => {
  const line = (overrides: Record<string, unknown> = {}) => ({
    id: 'line-1',
    unitPrice: 9500,
    metadata: { gift: 'wrap' },
    atQuantity: { calculated: 9500, original: 10000 },
    atOne: { calculated: 10000, original: 10000 },
    ...overrides,
  });

  it('records the base price, the price before the tier and the tier saving per unit', () => {
    expect(buildPriceBreakdowns([line()])).toEqual([
      {
        id: 'line-1',
        metadata: {
          gift: 'wrap',
          price_breakdown: { base_unit: 10000, before_tier_unit: 10000, tier_discount_unit: 500 },
        },
      },
    ]);
  });

  it('keeps the membership part out of the tier saving', () => {
    const [update] = buildPriceBreakdowns([
      line({ unitPrice: 7200, atQuantity: { calculated: 7200, original: 10000 }, atOne: { calculated: 8000, original: 10000 } }),
    ]);
    expect(update.metadata.price_breakdown).toEqual({ base_unit: 10000, before_tier_unit: 8000, tier_discount_unit: 800 });
  });

  it('writes nothing when the recalculated price is not what the customer paid', () => {
    expect(buildPriceBreakdowns([line({ atQuantity: { calculated: 9000, original: 10000 } })])).toEqual([]);
  });

  it('writes nothing for a line without a tier saving', () => {
    expect(buildPriceBreakdowns([line({ unitPrice: 10000, atQuantity: { calculated: 10000, original: 10000 } })])).toEqual([]);
  });

  it('keeps a breakdown already recorded for the line when the event is handled again', () => {
    const recorded = { base_unit: 10000, before_tier_unit: 8000, tier_discount_unit: 800 };
    expect(
      buildPriceBreakdowns([
        line({
          unitPrice: 7200,
          metadata: { price_breakdown: recorded },
          atQuantity: { calculated: 7200, original: 10000 },
          atOne: { calculated: 9000, original: 10000 },
        }),
      ]),
    ).toEqual([]);
  });

  it('writes nothing when a price could not be calculated', () => {
    expect(buildPriceBreakdowns([line({ atOne: undefined })])).toEqual([]);
  });
});

describe('handleOrderPriceBreakdown', () => {
  type Item = {
    id: string;
    unit_price: number;
    is_custom_price?: boolean;
    metadata?: Record<string, unknown> | null;
    detail: { quantity: number };
    variant: { metadata: Record<string, unknown> | null; price_set: { id: string } | null } | null;
  };

  function containerFor(items: Item[], prices: (quantity: number) => number) {
    const updates: unknown[] = [];
    const pricingCalls: number[] = [];
    const container = {
      resolve: (key: string) => {
        if (key === 'logger') return { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
        if (key === 'query') {
          return {
            graph: async () => ({
              data: [
                {
                  id: 'order-1',
                  currency_code: 'krw',
                  region_id: 'reg',
                  customer: { groups: [{ id: 'grp-member' }] },
                  items,
                },
              ],
            }),
          };
        }
        if (key === 'pricing') {
          return {
            calculatePrices: async (filters: { id: string[] }, { context }: { context: { quantity: number } }) => {
              pricingCalls.push(context.quantity);
              return filters.id.map((id) => ({
                id,
                calculated_amount: prices(context.quantity),
                original_amount: 10000,
              }));
            },
          };
        }
        if (key === 'order') {
          return { updateOrderLineItems: async (data: unknown) => updates.push(data) };
        }
        throw new Error(`unexpected ${key}`);
      },
    };
    return { container, updates, pricingCalls };
  }

  const tierPrice = (q: number) => (q >= 3 ? 9500 : 10000);
  const run = (container: unknown) =>
    handleOrderPriceBreakdown({ event: { name: 'order.placed', data: { id: 'order-1' } }, container } as never);

  it('listens to order.placed', () => {
    expect(config.event).toBe('order.placed');
  });

  it('records the breakdown on lines that got a tier price', async () => {
    const { container, updates } = containerFor(
      [
        {
          id: 'line-1',
          unit_price: 9500,
          metadata: null,
          detail: { quantity: 3 },
          variant: { metadata: tierMeta, price_set: { id: 'ps-1' } },
        },
      ],
      tierPrice,
    );

    await run(container);

    expect(updates).toEqual([
      [
        {
          selector: { id: 'line-1' },
          data: { metadata: { price_breakdown: { base_unit: 10000, before_tier_unit: 10000, tier_discount_unit: 500 } } },
        },
      ],
    ]);
  });

  it('does not price or write anything for an order without tier products', async () => {
    const { container, updates, pricingCalls } = containerFor(
      [
        {
          id: 'line-1',
          unit_price: 10000,
          detail: { quantity: 5 },
          variant: { metadata: {}, price_set: { id: 'ps-1' } },
        },
      ],
      tierPrice,
    );

    await run(container);

    expect(pricingCalls).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('skips custom-priced lines and single items', async () => {
    const { container, pricingCalls } = containerFor(
      [
        {
          id: 'custom',
          unit_price: 9000,
          is_custom_price: true,
          detail: { quantity: 3 },
          variant: { metadata: tierMeta, price_set: { id: 'ps-1' } },
        },
        {
          id: 'single',
          unit_price: 10000,
          detail: { quantity: 1 },
          variant: { metadata: tierMeta, price_set: { id: 'ps-2' } },
        },
      ],
      tierPrice,
    );

    await run(container);

    expect(pricingCalls).toEqual([]);
  });
});
