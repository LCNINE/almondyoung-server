import { BadRequestException } from '@nestjs/common';
import type { DemoCatalogItem } from './demo-catalog.client';
import { planDemoRunItems, type NormalizedDemoRunInput } from './demo-run.service';

const catalog: DemoCatalogItem[] = [
  {
    variantId: '11111111-1111-4111-8111-111111111111',
    masterId: '11111111-1111-4111-8111-111111111112',
    versionId: '11111111-1111-4111-8111-111111111113',
    skuId: '11111111-1111-4111-8111-111111111114',
    sku: 'A',
    productName: '상품 A',
    unitPrice: 1000,
    availableQuantity: 10,
    components: [{ skuId: '99999999-9999-4999-8999-999999999999', quantity: 1, availableQuantity: 4 }],
  },
  {
    variantId: '22222222-2222-4222-8222-222222222221',
    masterId: '22222222-2222-4222-8222-222222222222',
    versionId: '22222222-2222-4222-8222-222222222223',
    skuId: '22222222-2222-4222-8222-222222222224',
    sku: 'B',
    productName: '상품 B',
    unitPrice: 2000,
    availableQuantity: 10,
    components: [{ skuId: '99999999-9999-4999-8999-999999999999', quantity: 1, availableQuantity: 4 }],
  },
  {
    variantId: '33333333-3333-4333-8333-333333333331',
    masterId: '33333333-3333-4333-8333-333333333332',
    versionId: '33333333-3333-4333-8333-333333333333',
    skuId: '33333333-3333-4333-8333-333333333334',
    sku: 'C',
    productName: '상품 C',
    unitPrice: 3000,
    availableQuantity: 8,
    components: [{ skuId: '33333333-3333-4333-8333-333333333334', quantity: 1, availableQuantity: 8 }],
  },
];

function input(overrides: Partial<NormalizedDemoRunInput> = {}): NormalizedDemoRunInput {
  return {
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fixtureVersion: 'trusted-core-catalog-v1',
    scenario: 'happy_path',
    count: 2,
    mode: 'specified',
    variantIds: [catalog[0].variantId, catalog[1].variantId],
    productsPerOrder: 2,
    minQuantity: 1,
    maxQuantity: 1,
    ...overrides,
  };
}

describe('demo order planning', () => {
  it('puts distinct variants in each order while protecting aggregate shared-component stock', () => {
    const items = planDemoRunItems(input(), catalog, new Date('2026-09-17T00:00:00.000Z'));

    expect(items).toHaveLength(2);
    expect(items[0].lines.map((line) => line.variantId)).toEqual([catalog[0].variantId, catalog[1].variantId]);
    expect(new Set(items[0].lines.map((line) => line.variantId)).size).toBe(2);
    expect(items.flatMap((item) => item.lines).reduce((sum, line) => sum + line.quantity, 0)).toBe(4);
  });

  it('rejects a happy-path run when selected variants exhaust aggregate component stock', () => {
    expect(() => planDemoRunItems(input({ count: 3 }), catalog, new Date())).toThrow(BadRequestException);
  });

  it('reduces a deterministic quantity within the requested range when aggregate stock is tight', () => {
    const tight = {
      ...catalog[2],
      availableQuantity: 2,
      components: [{ ...catalog[2].components[0], availableQuantity: 2 }],
    };
    const items = planDemoRunItems(
      input({
        variantIds: [tight.variantId],
        productsPerOrder: 1,
        minQuantity: 1,
        maxQuantity: 3,
      }),
      [tight],
      new Date('2026-09-17T00:00:00.000Z'),
    );

    expect(items.map((item) => item.lines[0].quantity)).toEqual([1, 1]);
  });

  it('raises a bounded quantity so inventory_shortage actually exceeds current component availability', () => {
    const items = planDemoRunItems(
      input({ scenario: 'inventory_shortage', minQuantity: 1, maxQuantity: 3 }),
      catalog,
      new Date('2026-09-17T00:00:00.000Z'),
    );
    const sharedDemand = items
      .flatMap((item) => item.lines)
      .filter((line) => [catalog[0].variantId, catalog[1].variantId].includes(line.variantId))
      .reduce((sum, line) => sum + line.quantity, 0);

    expect(sharedDemand).toBeGreaterThan(4);
    expect(Math.max(...items.flatMap((item) => item.lines).map((line) => line.quantity))).toBeLessThanOrEqual(3);
  });

  it('rejects an inventory_shortage run when accepted quantity bounds cannot exceed stock', () => {
    expect(() =>
      planDemoRunItems(
        input({
          scenario: 'inventory_shortage',
          count: 1,
          variantIds: [catalog[2].variantId],
          productsPerOrder: 1,
          minQuantity: 1,
          maxQuantity: 2,
        }),
        catalog,
        new Date(),
      ),
    ).toThrow('cannot exceed current stock within maxQuantity=2');
  });

  it('spreads shortage demand across orders when one bounded line cannot exceed stock alone', () => {
    const highStock = {
      ...catalog[2],
      availableQuantity: 150,
      components: [{ ...catalog[2].components[0], availableQuantity: 150 }],
    };
    const items = planDemoRunItems(
      input({
        scenario: 'inventory_shortage',
        count: 2,
        variantIds: [highStock.variantId],
        productsPerOrder: 1,
        minQuantity: 1,
        maxQuantity: 100,
      }),
      [highStock],
      new Date('2026-09-17T00:00:00.000Z'),
    );

    expect(items.map((item) => item.lines[0].quantity)).toEqual([100, 51]);
    expect(items.flatMap((item) => item.lines).reduce((sum, line) => sum + line.quantity, 0)).toBe(151);
  });

  it('uses a deterministic optional candidate pool for random mode without duplicate variants per order', () => {
    const normalized = input({
      mode: 'random',
      variantIds: catalog.map((item) => item.variantId),
      productsPerOrder: 2,
      count: 1,
    });
    const first = planDemoRunItems(normalized, catalog, new Date('2026-09-17T00:00:00.000Z'));
    const replay = planDemoRunItems(normalized, [...catalog].reverse(), new Date('2026-09-17T00:00:00.000Z'));

    expect(first[0].lines).toEqual(replay[0].lines);
    expect(new Set(first[0].lines.map((line) => line.variantId)).size).toBe(2);
  });
});
