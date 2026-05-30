import { BadRequestException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { ProductSkuMappingService } from './product-sku-mapping.service';

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

    const tx = {
      query: {
        productMatchings: {
          findFirst: jest.fn().mockImplementation(async () => matching),
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

          return {
            returning: async () => {
              if (table === wmsTables.productMatchings) {
                matching = { ...matching, ...values };
                return [matching];
              }

              return [];
            },
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
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(variantId, tx);
    expect(result).toMatchObject({
      id: matchingId,
      variantId,
      status: 'matched',
      strategy: 'variant',
      links: [{ productMatchingId: matchingId, skuId, quantity: 2 }],
    });
  });
});
