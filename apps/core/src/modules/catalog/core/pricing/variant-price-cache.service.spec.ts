import { VariantPriceCacheService } from './variant-price-cache.service';
import { productMasterVariants, productMasterVersions, productVariantPriceCache } from '../../schema/catalog.schema';

function makePromiseTerminal<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
  };
}

function makeCacheTx(callbacks: { onConflictDoUpdate: jest.Mock; onConflictDoNothing: jest.Mock }) {
  const rowsForTable = (table: unknown) => {
    if (table === productMasterVersions) return [{ id: 'version-1' }];
    if (table === productMasterVariants) return [{ variantId: 'variant-1' }];
    return [];
  };

  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => ({
        where: jest.fn(() => makePromiseTerminal(rowsForTable(table))),
      })),
    })),
    insert: jest.fn((table: unknown) => {
      expect(table).toBe(productVariantPriceCache);
      return {
        values: jest.fn((values: unknown) => {
          expect(values).toEqual([
            expect.objectContaining({
              versionId: 'version-1',
              variantId: 'variant-1',
              basePrice: 12000,
              membershipPrice: 10000,
              tieredPrices: [{ minQuantity: 10, price: 9000 }],
            }),
          ]);
          return {
            onConflictDoUpdate: callbacks.onConflictDoUpdate,
            onConflictDoNothing: callbacks.onConflictDoNothing,
          };
        }),
      };
    }),
  };
}

describe('VariantPriceCacheService', () => {
  it('refreshes existing publish-time cache rows instead of ignoring conflicts', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const tx = makeCacheTx({ onConflictDoUpdate, onConflictDoNothing });
    const calculatorService = {
      calculateVariantPriceSet: jest.fn().mockResolvedValue({
        basePrice: 12000,
        membershipPrice: 10000,
        tieredPrices: [{ minQuantity: 10, price: 9000 }],
      }),
    };
    const service = new VariantPriceCacheService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      calculatorService as any,
    );

    await service.cachePricesForVersion('version-1', tx as any);

    expect(onConflictDoNothing).not.toHaveBeenCalled();
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [productVariantPriceCache.versionId, productVariantPriceCache.variantId],
        set: expect.objectContaining({
          basePrice: expect.anything(),
          membershipPrice: expect.anything(),
          tieredPrices: expect.anything(),
          createdAt: expect.anything(),
        }),
      }),
    );
  });
});
