import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { findStaleTimeSalePriceLines, isBelowRegularPrice } from '../private-time-sale-price';
import { productsInActiveTimeSales, productsInAnyTimeSales } from '../../../../utils/time-sale';

jest.mock('../../../../utils/time-sale', () => ({
  productsInActiveTimeSales: jest.fn(),
  productsInAnyTimeSales: jest.fn(),
}));

const anySales = jest.mocked(productsInAnyTimeSales);
const activeSales = jest.mocked(productsInActiveTimeSales);

describe('isBelowRegularPrice', () => {
  const warn = jest.fn();

  beforeEach(() => warn.mockClear());

  it('compares amounts when the line and the regular price share a tax basis', () => {
    expect(
      isBelowRegularPrice({ unitPrice: 7000, taxInclusive: false }, { amount: 10000, taxInclusive: false }, warn),
    ).toBe(true);
    expect(
      isBelowRegularPrice({ unitPrice: 10000, taxInclusive: true }, { amount: 10000, taxInclusive: true }, warn),
    ).toBe(false);
  });

  it('does not reject and warns when the tax bases differ', () => {
    expect(
      isBelowRegularPrice({ unitPrice: 9091, taxInclusive: false }, { amount: 10000, taxInclusive: true }, warn),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

type Line = { title: string; unit_price: number; is_custom_price?: boolean };

type PricingContext = { context: { customer?: { groups?: { id: string }[] }; quantity?: number } };

const MEMBER_GROUP = 'cusgroup_member';

function fakeContainer(
  lines: Line[],
  groups: string[],
  priceFor: (ctx: PricingContext['context']) => number,
  completedAt: string | null = null,
) {
  const calculatePrices = jest.fn(async (_filter: { id: string[] }, { context }: PricingContext) => [
    { id: 'pset_1', calculated_amount: priceFor(context), is_calculated_price_tax_inclusive: true },
  ]);
  const cart = {
    id: 'cart_1',
    completed_at: completedAt,
    currency_code: 'krw',
    region_id: 'reg_1',
    customer_id: groups.length ? 'cus_1' : null,
    customer: groups.length ? { id: 'cus_1', groups: groups.map((id) => ({ id })) } : null,
    items: lines.map((line) => ({
      id: `item_${line.title}`,
      title: line.title,
      product_id: 'prod_1',
      variant_id: 'variant_1',
      unit_price: line.unit_price,
      quantity: 1,
      is_tax_inclusive: true,
      is_custom_price: line.is_custom_price ?? false,
    })),
  };
  const graph = jest.fn(async ({ entity }: { entity: string }) =>
    entity === 'cart' ? { data: [cart] } : { data: [{ id: 'variant_1', price_set: { id: 'pset_1' } }] },
  );
  const services: Record<string, unknown> = {
    [ContainerRegistrationKeys.QUERY]: { graph },
    [Modules.PRICING]: { calculatePrices },
    logger: { warn: jest.fn() },
  };
  const container = { resolve: (key: string) => services[key] } as unknown as MedusaContainer;

  return { container, calculatePrices };
}

const memberPrice = (ctx: PricingContext['context']) =>
  ctx.customer?.groups?.some((group) => group.id === MEMBER_GROUP) ? 7000 : 10000;

describe('findStaleTimeSalePriceLines', () => {
  beforeEach(() => {
    anySales.mockResolvedValue(new Set(['prod_1']));
    activeSales.mockResolvedValue(new Set());
  });

  it('flags a line still carrying the sale price after the service was turned off', async () => {
    const { container } = fakeContainer([{ title: 'A', unit_price: 7000 }], [], () => 10000);

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([{ id: 'item_A', title: 'A' }]);
  });

  it('flags a guest line carrying a sale price that became members-only', async () => {
    const { container } = fakeContainer([{ title: 'A', unit_price: 7000 }], [], memberPrice);

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([{ id: 'item_A', title: 'A' }]);
  });

  it('prices with the cart customer groups so a member keeps the members-only sale price', async () => {
    const { container, calculatePrices } = fakeContainer(
      [{ title: 'A', unit_price: 7000 }],
      [MEMBER_GROUP],
      memberPrice,
    );

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([]);
    expect(calculatePrices.mock.calls[0][1].context).toMatchObject({
      region_id: 'reg_1',
      quantity: 1,
      customer: { groups: [{ id: MEMBER_GROUP }] },
    });
  });

  it('leaves custom-priced lines alone', async () => {
    const { container } = fakeContainer([{ title: 'A', unit_price: 0, is_custom_price: true }], [], () => 10000);

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([]);
  });

  it('leaves a completed cart alone because its lines are already an order', async () => {
    const { container, calculatePrices } = fakeContainer(
      [{ title: 'A', unit_price: 7000 }],
      [],
      () => 10000,
      '2026-10-08',
    );

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([]);
    expect(calculatePrices).not.toHaveBeenCalled();
  });

  it('does not price anything when no line ever belonged to a time sale', async () => {
    anySales.mockResolvedValue(new Set());
    const { container, calculatePrices } = fakeContainer([{ title: 'A', unit_price: 7000 }], [], () => 10000);

    await expect(findStaleTimeSalePriceLines(container, 'cart_1')).resolves.toEqual([]);
    expect(calculatePrices).not.toHaveBeenCalled();
  });
});
