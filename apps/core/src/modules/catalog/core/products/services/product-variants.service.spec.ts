jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductVariantsService } from './product-variants.service';
import type { DbTransaction } from '../../../catalog.types';

type RecalculateForVariant = (variantId: string, tx: DbTransaction) => Promise<{ projection: null; published: false }>;
type LegacySellableQuantityDependency = {
  recalculateAndPublishForVariant: jest.MockedFunction<RecalculateForVariant>;
};
type InstrumentedProductVariantsService = ProductVariantsService & {
  productSellableQuantity?: LegacySellableQuantityDependency;
};

describe('ProductVariantsService draft variant updates', () => {
  function makeLimitedSelect(rows: unknown[]) {
    return {
      from: () => ({
        where: () => ({
          limit: () => rows,
        }),
      }),
    };
  }

  function makeService() {
    const productVersionsService = {
      getVersionById: jest.fn().mockResolvedValue({
        id: 'version-draft',
        masterId: 'master-1',
        status: 'draft',
      }),
    };
    const productSellableQuantity: LegacySellableQuantityDependency = {
      recalculateAndPublishForVariant: jest
        .fn<ReturnType<RecalculateForVariant>, Parameters<RecalculateForVariant>>()
        .mockResolvedValue({ projection: null, published: false }),
    };

    const service: InstrumentedProductVariantsService = new ProductVariantsService(
      {} as ConstructorParameters<typeof ProductVariantsService>[0],
      productVersionsService as unknown as ConstructorParameters<typeof ProductVariantsService>[1],
      {} as ConstructorParameters<typeof ProductVariantsService>[2],
      {} as ConstructorParameters<typeof ProductVariantsService>[3],
    );
    service.productSellableQuantity = productSellableQuantity;

    return { service, productVersionsService, productSellableQuantity };
  }

  it('does not publish live sellable quantity events for draft-scoped status updates', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = {
      select: jest
        .fn()
        .mockReturnValueOnce(
          makeLimitedSelect([{ masterId: 'master-1', versionId: 'version-draft', variantId: 'variant-1' }]),
        )
        .mockReturnValueOnce(makeLimitedSelect([])),
      update: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn().mockResolvedValue(undefined),
        })),
      })),
    } as unknown as DbTransaction;

    await service.updateVariantInDraft('master-1', 'version-draft', 'variant-1', { status: 'inactive' }, tx);

    expect(productSellableQuantity.recalculateAndPublishForVariant).not.toHaveBeenCalled();
  });
});
