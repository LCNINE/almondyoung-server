jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductVariantsService } from './product-variants.service';
import type { DbTransaction } from '../../../catalog.types';
import { pricingRules, productMasterPricingRules } from '../../../schema/catalog.schema';

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
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
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

describe('ProductVariantsService variant→pricing cascade CoW (docs/adr/0004)', () => {
  function makeService() {
    return new ProductVariantsService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  function makeCascadeTx(draftRules: any[], otherMapping: Array<{ versionId: string }>) {
    const inserted: any[] = [];
    const repointed: any[] = [];
    const inPlace: any[] = [];
    let selectCall = 0;

    const tx: any = {
      select: jest.fn(() => {
        const current = selectCall++;
        if (current === 0) {
          // draftRules query: .from().innerJoin().where()
          return { from: () => ({ innerJoin: () => ({ where: () => draftRules }) }) };
        }
        // otherMapping query: .from().where().limit()
        return { from: () => ({ where: () => ({ limit: () => otherMapping }) }) };
      }),
      insert: jest.fn((table: unknown) => ({
        values: (vals: any) => {
          if (table === pricingRules) inserted.push(vals);
          return Promise.resolve();
        },
      })),
      update: jest.fn((table: unknown) => ({
        set: (vals: any) => ({
          where: () => {
            if (table === pricingRules) inPlace.push(vals);
            else if (table === productMasterPricingRules) repointed.push(vals);
            return Promise.resolve();
          },
        }),
      })),
    };

    return { tx, inserted, repointed, inPlace };
  }

  const sharedRule = {
    ruleId: 'rule-1',
    layer: 'base_price',
    order: 0,
    scopeType: 'variants',
    scopeTargetIds: ['old-variant', 'keep-variant'],
    operationType: 'fixed',
    operationValue: '1000',
    minQuantity: null,
  };

  it('clones and repoints a pricing rule shared with another version', async () => {
    const service = makeService() as any;
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([sharedRule], [{ versionId: 'other-version' }]);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toEqual([
      expect.objectContaining({
        layer: 'base_price',
        order: 0,
        scopeType: 'variants',
        scopeTargetIds: ['new-variant', 'keep-variant'],
        operationType: 'fixed',
        operationValue: '1000',
        minQuantity: null,
      }),
    ]);
    expect(repointed).toHaveLength(1);
    expect(inPlace).toHaveLength(0);
  });

  it('updates a pricing rule in place when it is not shared', async () => {
    const service = makeService() as any;
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([sharedRule], []);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toHaveLength(0);
    expect(repointed).toHaveLength(0);
    expect(inPlace).toEqual([
      expect.objectContaining({ scopeTargetIds: ['new-variant', 'keep-variant'] }),
    ]);
  });

  it('leaves a pricing rule untouched when it does not reference the cowed variant', async () => {
    const service = makeService() as any;
    const unrelatedRule = { ...sharedRule, ruleId: 'rule-2', scopeTargetIds: ['some-other-variant'] };
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([unrelatedRule], [{ versionId: 'other-version' }]);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toHaveLength(0);
    expect(repointed).toHaveLength(0);
    expect(inPlace).toHaveLength(0);
  });
});
