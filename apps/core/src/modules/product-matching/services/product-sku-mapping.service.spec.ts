import { BadRequestException, NotFoundException } from '@nestjs/common';
import { productVariants } from '../../catalog/schema/catalog.schema';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { ProductSkuMappingService } from './product-sku-mapping.service';

function createThenableResult<T>(result: T[]) {
  return {
    limit: jest.fn(async (limit: number) => result.slice(0, limit)),
    then: (resolve: (value: T[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
}

function createSelectMock(resultsByTable: Map<unknown, unknown[]>) {
  return jest.fn(() => {
    let selectedTable: unknown;
    const query = {
      from: jest.fn((table: unknown) => {
        selectedTable = table;
        return query;
      }),
      leftJoin: jest.fn(() => query),
      where: jest.fn(() => createThenableResult(resultsByTable.get(selectedTable) ?? [])),
    };

    return query;
  });
}

function createService(dbService: any, productSellableQuantity: any, fulfillmentBacklog?: any) {
  return new ProductSkuMappingService(
    dbService as any,
    productSellableQuantity as any,
    (fulfillmentBacklog ?? { wakeBacklogsWaitingForVariant: jest.fn() }) as any,
  );
}

describe('ProductSkuMappingService', () => {
  it('does not resolve or wake variant matching without SKU links', async () => {
    const tx = {};
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    await expect(service.upsert('variant-1', { links: [] } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(productSellableQuantity.recalculateAndPublishForVariant).not.toHaveBeenCalled();
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
  });

  it('saves policy-only override without creating a SKU matching', async () => {
    const variantId = 'variant-1';
    const inserts: Array<{ table: unknown; values: any }> = [];
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    let salesVariantPolicy: Record<string, any> | null = null;

    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockImplementation(async () => salesVariantPolicy),
        },
        productVariantSkuLinks: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return {
            where: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
      delete: jest.fn(() => ({
        where: jest.fn().mockResolvedValue(undefined),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: any) => {
          inserts.push({ table, values });

          if (table === wmsTables.salesVariantPolicies) {
            salesVariantPolicy = Array.isArray(values) ? values[0] : values;
          }

          return {
            returning: jest.fn().mockResolvedValue([]),
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    await expect(
      service.upsert(variantId, {
        links: [],
        policy: {
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
      } as any),
    ).resolves.toBeNull();

    expect(inserts.find((entry) => entry.table === wmsTables.productMatchings)).toBeUndefined();
    expect(inserts.find((entry) => entry.table === wmsTables.productVariantSkuLinks)).toBeUndefined();
    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)).toBeUndefined();
    expect(inserts.find((entry) => entry.table === wmsTables.salesVariantPolicies)?.values).toMatchObject({
      variantId,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
  });

  it('preserves an existing no-link void matching when saving stock policy only', async () => {
    const variantId = 'variant-1';
    const matchingId = 'matching-1';
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    let matching: Record<string, any> = {
      id: matchingId,
      variantId,
      masterId: 'master-1',
      status: 'matched',
      priority: 'normal',
      strategy: 'void',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    };
    let links: Array<{ productMatchingId: string; skuId: string; quantity: number }> = [];
    let salesVariantPolicy: Record<string, any> | null = null;

    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockImplementation(async () => matching),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockImplementation(async () => salesVariantPolicy),
        },
        productVariantSkuLinks: {
          findMany: jest.fn().mockImplementation(async () => links),
        },
      },
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return {
            where: () => {
              if (table === wmsTables.productMatchings) {
                return {
                  returning: async () => {
                    matching = { ...matching, ...set };
                    return [matching];
                  },
                };
              }

              return Promise.resolve([]);
            },
          };
        },
      })),
      delete: jest.fn((table: unknown) => ({
        where: jest.fn(async () => {
          if (table === wmsTables.productVariantSkuLinks) {
            links = [];
          }
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: any) => {
          if (table === wmsTables.salesVariantPolicies) {
            salesVariantPolicy = Array.isArray(values) ? values[0] : values;
          }

          return {
            returning: jest.fn().mockResolvedValue([]),
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    const result = await service.upsert(variantId, {
      links: [],
      policy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    } as any);

    expect(tx.delete).not.toHaveBeenCalledWith(wmsTables.productVariantSkuLinks);
    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)?.set).not.toHaveProperty(
      'strategy',
      'variant',
    );
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: matchingId,
      variantId,
      strategy: 'void',
      links: [],
      stockPolicy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    });
  });

  it('removes existing SKU links when an existing matching is saved with empty links', async () => {
    const variantId = 'variant-1';
    const matchingId = 'matching-1';
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    let matching: Record<string, any> = {
      id: matchingId,
      variantId,
      masterId: 'master-1',
      status: 'matched',
      priority: 'normal',
      strategy: 'variant',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    };
    let links: Array<{ productMatchingId: string; skuId: string; quantity: number }> = [
      { productMatchingId: matchingId, skuId: 'sku-1', quantity: 1 },
    ];
    let salesVariantPolicy: Record<string, any> | null = null;

    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockImplementation(async () => matching),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockImplementation(async () => salesVariantPolicy),
        },
        productVariantSkuLinks: {
          findMany: jest.fn().mockImplementation(async () => links),
        },
      },
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return {
            where: () => {
              if (table === wmsTables.productMatchings) {
                return {
                  returning: async () => {
                    matching = { ...matching, ...set };
                    return [matching];
                  },
                };
              }

              return Promise.resolve([]);
            },
          };
        },
      })),
      delete: jest.fn((table: unknown) => ({
        where: jest.fn(async () => {
          if (table === wmsTables.productVariantSkuLinks) {
            links = [];
          }
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: any) => {
          if (table === wmsTables.salesVariantPolicies) {
            salesVariantPolicy = Array.isArray(values) ? values[0] : values;
          }

          return {
            returning: jest.fn().mockResolvedValue([]),
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    const result = await service.upsert(variantId, {
      links: [],
      policy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    } as any);

    expect(tx.delete).toHaveBeenCalledWith(wmsTables.productVariantSkuLinks);
    expect(tx.insert).not.toHaveBeenCalledWith(wmsTables.productVariantSkuLinks);
    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)?.set).toMatchObject({
      status: 'matched',
      strategy: 'variant',
      isResolved: true,
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(result).toMatchObject({
      id: matchingId,
      variantId,
      links: [],
      stockPolicy: {
        preStockSellable: true,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    });
  });

  it('registers SKU 구성 matching and wakes only variant-related fulfillment backlog', async () => {
    const variantId = 'variant-1';
    const matchingId = 'matching-1';
    const skuId = 'sku-1';
    const inserts: Array<{ table: unknown; values: any }> = [];
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    let matching: Record<string, any> = {
      id: matchingId,
      variantId,
      masterId: 'master-1',
      status: 'pending',
      strategy: null,
      isResolved: false,
    };
    let links: Array<{ productMatchingId: string; skuId: string; quantity: number }> = [];
    let salesVariantPolicy: Record<string, any> | null = null;

    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockImplementation(async () => matching),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockImplementation(async () => salesVariantPolicy),
        },
        productVariantSkuLinks: {
          findMany: jest.fn().mockImplementation(async () => links),
        },
      },
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          return {
            where: () => {
              if (table === wmsTables.productMatchings) {
                return {
                  returning: async () => {
                    matching = { ...matching, ...set };
                    return [matching];
                  },
                };
              }

              return Promise.resolve([]);
            },
          };
        },
      })),
      delete: jest.fn(() => ({
        where: jest.fn(async () => {
          links = [];
        }),
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: any) => {
          inserts.push({ table, values });

          if (table === wmsTables.productVariantSkuLinks) {
            links = Array.isArray(values) ? values : [values];
          }
          if (table === wmsTables.salesVariantPolicies) {
            salesVariantPolicy = Array.isArray(values) ? values[0] : values;
          }

          return {
            returning: async () => {
              if (table === wmsTables.productMatchings) {
                matching = { ...matching, ...values };
                return [matching];
              }

              return [];
            },
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn(),
    };
    const service = new ProductSkuMappingService(
      dbService as any,
      productSellableQuantity as any,
      fulfillmentBacklog as any,
    );

    const result = await service.upsert(variantId, {
      links: [{ skuId, quantity: 2 }],
      policy: {
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
    } as any);

    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)?.set).toMatchObject({
      status: 'matched',
      strategy: 'variant',
      isResolved: true,
    });
    expect(inserts.find((entry) => entry.table === wmsTables.productVariantSkuLinks)?.values).toEqual([
      {
        productMatchingId: matchingId,
        skuId,
        quantity: 2,
      },
    ]);
    expect(inserts.find((entry) => entry.table === wmsTables.salesVariantPolicies)?.values).toMatchObject({
      variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(result).toMatchObject({
      id: matchingId,
      variantId,
      status: 'matched',
      strategy: 'variant',
      stockPolicy: {
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
      links: [{ productMatchingId: matchingId, skuId, quantity: 2 }],
    });
  });

  it('reads variant matching batch while preserving input order, duplicates, missing variants, policies, and projections', async () => {
    const variantA = '11111111-1111-1111-1111-111111111111';
    const variantB = '22222222-2222-2222-2222-222222222222';
    const unknownVariant = '33333333-3333-3333-3333-333333333333';
    const matchingId = '44444444-4444-4444-4444-444444444444';
    const calculatedAt = new Date('2026-01-01T00:00:00.000Z');
    const tx = {
      select: createSelectMock(
        new Map<unknown, unknown[]>([
          [productVariants, [{ id: variantA }, { id: variantB }]],
          [
            wmsTables.productMatchings,
            [
              {
                id: matchingId,
                variantId: variantA,
                masterId: '55555555-5555-5555-5555-555555555555',
                skuGroupId: null,
                status: 'matched',
                priority: 'normal',
                strategy: 'variant',
                isResolved: true,
                preStockSellable: false,
                alwaysSellableZeroStock: true,
                createdAt: calculatedAt,
                updatedAt: calculatedAt,
              },
            ],
          ],
          [
            wmsTables.salesVariantPolicies,
            [
              {
                variantId: variantA,
                preStockSellable: true,
                alwaysSellableZeroStock: false,
                availabilityOverride: 'manual_out_of_stock',
              },
              {
                variantId: variantB,
                preStockSellable: false,
                alwaysSellableZeroStock: true,
                availabilityOverride: null,
              },
            ],
          ],
          [
            wmsTables.productVariantSkuLinks,
            [
              {
                productMatchingId: matchingId,
                skuId: '66666666-6666-6666-6666-666666666666',
                quantity: 2,
                skuName: 'SKU A',
                skuCode: 'SKU-A',
              },
            ],
          ],
        ]),
      ),
    };
    const dbService = {
      db: {
        transaction: jest.fn((fn) => fn(tx)),
      },
    };
    const productSellableQuantity = {
      getByVariantIds: jest.fn().mockResolvedValue([
        {
          variantId: variantA,
          masterId: '55555555-5555-5555-5555-555555555555',
          versionId: '77777777-7777-7777-7777-777777777777',
          matchingId,
          sellableQuantity: 0,
          stockBoundQuantity: 0,
          isSellable: false,
          reason: 'MANUAL_OUT_OF_STOCK',
          preStockSellable: false,
          alwaysSellableZeroStock: true,
          availabilityOverride: 'manual_out_of_stock',
          calculatedAt,
          components: [],
        },
      ]),
      recalculateAndPublishForVariant: jest.fn(),
    };
    const service = createService(dbService, productSellableQuantity);

    const result = await service.getVariantMatchingBatch([variantB, variantA, variantA, unknownVariant]);

    expect(result.data.map((item) => item.variantId)).toEqual([variantB, variantA, variantA, unknownVariant]);
    expect(result.data[0]).toMatchObject({
      variantId: variantB,
      exists: true,
      matching: null,
      stockPolicy: {
        preStockSellable: false,
        alwaysSellableZeroStock: true,
        availabilityOverride: null,
      },
      projection: null,
    });
    expect(result.data[1]).toMatchObject({
      variantId: variantA,
      exists: true,
      stockPolicy: {
        preStockSellable: false,
        alwaysSellableZeroStock: true,
        availabilityOverride: 'manual_out_of_stock',
      },
      matching: {
        id: matchingId,
        links: [{ skuId: '66666666-6666-6666-6666-666666666666', skuName: 'SKU A', skuCode: 'SKU-A', quantity: 2 }],
      },
      projection: {
        reason: 'MANUAL_OUT_OF_STOCK',
        calculatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(result.data[2]).toEqual(result.data[1]);
    expect(result.data[3]).toMatchObject({
      variantId: unknownVariant,
      exists: false,
      matching: null,
      projection: null,
    });
    expect(productSellableQuantity.getByVariantIds).toHaveBeenCalledWith([variantB, variantA, unknownVariant], tx);
  });

  it('rejects variant matching batch requests over 500 IDs', async () => {
    const service = createService(
      { db: { transaction: jest.fn() } },
      { getByVariantIds: jest.fn(), recalculateAndPublishForVariant: jest.fn() },
    );

    await expect(
      service.getVariantMatchingBatch(Array.from({ length: 501 }, (_, index) => `variant-${index}`)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 when saving stock policy for a nonexistent variant', async () => {
    const tx = {
      select: createSelectMock(new Map<unknown, unknown[]>([[productVariants, []]])),
    };
    const service = createService(
      { db: { transaction: jest.fn((fn) => fn(tx)) } },
      { getByVariantIds: jest.fn(), recalculateAndPublishForVariant: jest.fn() },
    );

    await expect(
      service.updateVariantStockPolicy('variant-missing', { preStockSellable: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates matching policy fields, upserts sales policy, and recalculates for stock policy saves', async () => {
    const variantId = '11111111-1111-1111-1111-111111111111';
    const matchingId = '22222222-2222-2222-2222-222222222222';
    const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    const inserts: Array<{ table: unknown; values: Record<string, unknown>; conflictSet?: Record<string, unknown> }> =
      [];
    let salesVariantPolicy = {
      variantId,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      availabilityOverride: null,
    };
    const matching = {
      id: matchingId,
      variantId,
      masterId: null,
      skuGroupId: null,
      status: 'matched',
      priority: 'normal',
      strategy: 'variant',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockResolvedValue(matching),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockImplementation(async () => salesVariantPolicy),
        },
      },
      select: createSelectMock(
        new Map<unknown, unknown[]>([
          [productVariants, [{ id: variantId }]],
          [wmsTables.productMatchings, [matching]],
          [wmsTables.salesVariantPolicies, [salesVariantPolicy]],
          [wmsTables.productVariantSkuLinks, []],
        ]),
      ),
      update: jest.fn((table: unknown) => ({
        set: (set: Record<string, unknown>) => {
          updates.push({ table, set });
          if (table === wmsTables.productMatchings) {
            Object.assign(matching, set);
          }
          return {
            where: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn((config: { set: Record<string, unknown> }) => {
            inserts.push({ table, values, conflictSet: config.set });
            if (table === wmsTables.salesVariantPolicies) {
              Object.assign(salesVariantPolicy, values);
            }
            return Promise.resolve(undefined);
          }),
        }),
      })),
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
      getByVariantIds: jest.fn().mockResolvedValue([]),
    };
    const service = createService({ db: { transaction: jest.fn((fn) => fn(tx)) } }, productSellableQuantity);

    const result = await service.updateVariantStockPolicy(variantId, {
      preStockSellable: false,
      alwaysSellableZeroStock: true,
      availabilityOverride: 'manual_out_of_stock',
    });

    expect(updates.find((entry) => entry.table === wmsTables.productMatchings)?.set).toMatchObject({
      preStockSellable: false,
      alwaysSellableZeroStock: true,
    });
    expect(inserts.find((entry) => entry.table === wmsTables.salesVariantPolicies)?.values).toMatchObject({
      variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: true,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(result).toMatchObject({
      variantId,
      exists: true,
      stockPolicy: {
        preStockSellable: false,
        alwaysSellableZeroStock: true,
        availabilityOverride: 'manual_out_of_stock',
      },
    });
  });

  it('saves stock policy without a matching row and preserves omitted availability override', async () => {
    const variantId = '11111111-1111-1111-1111-111111111111';
    const inserts: Array<{ table: unknown; values: Record<string, unknown>; conflictSet?: Record<string, unknown> }> =
      [];
    const existingPolicy = {
      variantId,
      preStockSellable: false,
      alwaysSellableZeroStock: true,
      availabilityOverride: 'manual_out_of_stock',
    };
    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockResolvedValue(existingPolicy),
        },
      },
      select: createSelectMock(
        new Map<unknown, unknown[]>([
          [productVariants, [{ id: variantId }]],
          [wmsTables.productMatchings, []],
          [wmsTables.salesVariantPolicies, [existingPolicy]],
          [wmsTables.productVariantSkuLinks, []],
        ]),
      ),
      update: jest.fn(),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn((config: { set: Record<string, unknown> }) => {
            inserts.push({ table, values, conflictSet: config.set });
            return Promise.resolve(undefined);
          }),
        }),
      })),
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
      getByVariantIds: jest.fn().mockResolvedValue([]),
    };
    const service = createService({ db: { transaction: jest.fn((fn) => fn(tx)) } }, productSellableQuantity);

    await service.updateVariantStockPolicy(variantId, { preStockSellable: true });

    const salesPolicyWrite = inserts.find((entry) => entry.table === wmsTables.salesVariantPolicies);
    expect(tx.update).not.toHaveBeenCalled();
    expect(salesPolicyWrite?.values).toMatchObject({
      variantId,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: true,
    });
    expect(salesPolicyWrite?.values).not.toHaveProperty('availabilityOverride');
    expect(salesPolicyWrite?.conflictSet).not.toHaveProperty('availabilityOverride');
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
  });

  it('clears availability override only when stock policy explicitly passes null', async () => {
    const variantId = '11111111-1111-1111-1111-111111111111';
    const inserts: Array<{ table: unknown; values: Record<string, unknown>; conflictSet?: Record<string, unknown> }> =
      [];
    const existingPolicy = {
      variantId,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    };
    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        salesVariantPolicies: {
          findFirst: jest.fn().mockResolvedValue(existingPolicy),
        },
      },
      select: createSelectMock(
        new Map<unknown, unknown[]>([
          [productVariants, [{ id: variantId }]],
          [wmsTables.productMatchings, []],
          [wmsTables.salesVariantPolicies, [{ ...existingPolicy, availabilityOverride: null }]],
          [wmsTables.productVariantSkuLinks, []],
        ]),
      ),
      update: jest.fn(),
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: jest.fn((config: { set: Record<string, unknown> }) => {
            inserts.push({ table, values, conflictSet: config.set });
            return Promise.resolve(undefined);
          }),
        }),
      })),
    };
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn(),
      getByVariantIds: jest.fn().mockResolvedValue([]),
    };
    const service = createService({ db: { transaction: jest.fn((fn) => fn(tx)) } }, productSellableQuantity);

    await service.updateVariantStockPolicy(variantId, { availabilityOverride: null });

    const salesPolicyWrite = inserts.find((entry) => entry.table === wmsTables.salesVariantPolicies);
    expect(salesPolicyWrite?.values).toMatchObject({
      availabilityOverride: null,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    });
    expect(salesPolicyWrite?.conflictSet).toMatchObject({
      availabilityOverride: null,
    });
  });
});
