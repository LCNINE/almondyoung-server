import { PimMedusaSyncService } from './pim-medusa-sync.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

describe('PimMedusaSyncService.handleProductSellableQuantityChanged', () => {
  const payload: ProductSellableQuantityChangedPayload = {
    variantId: 'pim-var-1',
    masterId: 'master-1',
    versionId: 'version-1',
    matchingId: 'matching-1',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    calculatedAt: '2026-05-27T00:00:00.000Z',
  };

  function createService(params?: {
    mapping?: { medusaProductId?: string | null } | null;
    productByHandle?: { id: string } | null;
  }) {
    const medusaClient = {
      applyProductSellableQuantityProjection: jest.fn().mockResolvedValue({ soldOutChanged: false }),
      findProductByHandle: jest.fn().mockResolvedValue(params?.productByHandle ?? null),
      setProductToDraft: jest.fn().mockResolvedValue(undefined),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(params?.mapping ?? null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const storefrontRevalidate = {
      revalidateProduct: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PimMedusaSyncService(medusaClient as any, mappingRepo as any, storefrontRevalidate as any);

    return { service, medusaClient, mappingRepo, storefrontRevalidate };
  }

  it('maps the PIM master to an existing Medusa product and applies the projection', async () => {
    const { service, medusaClient, mappingRepo } = createService({
      mapping: { medusaProductId: 'prod_1' },
    });

    await service.handleProductSellableQuantityChanged(payload);

    expect(mappingRepo.findByPimMasterId).toHaveBeenCalledWith('master-1');
    expect(medusaClient.findProductByHandle).not.toHaveBeenCalled();
    expect(medusaClient.applyProductSellableQuantityProjection).toHaveBeenCalledWith({
      ...payload,
      medusaProductId: 'prod_1',
    });
  });

  it('falls back to Medusa handle lookup when the persisted product mapping is missing', async () => {
    const { service, medusaClient } = createService({
      mapping: null,
      productByHandle: { id: 'prod_from_handle' },
    });

    await service.handleProductSellableQuantityChanged(payload);

    expect(medusaClient.findProductByHandle).toHaveBeenCalledWith('master-1');
    expect(medusaClient.applyProductSellableQuantityProjection).toHaveBeenCalledWith({
      ...payload,
      medusaProductId: 'prod_from_handle',
    });
  });

  it('throws when no Medusa product mapping can be resolved so the inbox worker can retry', async () => {
    const { service, medusaClient } = createService({
      mapping: null,
      productByHandle: null,
    });

    await expect(service.handleProductSellableQuantityChanged(payload)).rejects.toThrow(
      'Medusa product not found for ProductSellableQuantityChanged masterId=master-1, variantId=pim-var-1',
    );
    expect(medusaClient.applyProductSellableQuantityProjection).not.toHaveBeenCalled();
  });

  it('skips an inactive-version event without masterId because no Medusa product can exist for it', async () => {
    const { service, medusaClient, mappingRepo } = createService();

    await expect(
      service.handleProductSellableQuantityChanged({
        ...payload,
        masterId: null,
        versionId: null,
        reason: 'NOT_ACTIVE_VERSION',
      }),
    ).resolves.toBeUndefined();

    expect(mappingRepo.findByPimMasterId).not.toHaveBeenCalled();
    expect(medusaClient.findProductByHandle).not.toHaveBeenCalled();
    expect(medusaClient.applyProductSellableQuantityProjection).not.toHaveBeenCalled();
  });

  it('throws when another event lacks masterId because channel-adapter must not guess product identity', async () => {
    const { service, medusaClient } = createService();

    await expect(
      service.handleProductSellableQuantityChanged({
        ...payload,
        masterId: null,
      }),
    ).rejects.toThrow('ProductSellableQuantityChanged missing masterId for variant pim-var-1');
    expect(medusaClient.applyProductSellableQuantityProjection).not.toHaveBeenCalled();
  });
});

describe('PimMedusaSyncService.handleProductMasterDeleted', () => {
  function createService(mapping?: { medusaProductId?: string | null } | null) {
    const medusaClient = {
      setProductToDraft: jest.fn().mockResolvedValue(undefined),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(mapping ?? null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const storefrontRevalidate = {
      revalidateProduct: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PimMedusaSyncService(medusaClient as any, mappingRepo as any, storefrontRevalidate as any);

    return { service, medusaClient, mappingRepo, storefrontRevalidate };
  }

  it('drafts the mapped Medusa product and retains the PIM-Medusa mapping', async () => {
    const { service, medusaClient, mappingRepo } = createService({ medusaProductId: 'prod_1' });

    await service.handleProductMasterDeleted({
      masterId: 'master-1',
      deletedAt: '2026-06-07T00:00:00.000Z',
    });

    expect(mappingRepo.findByPimMasterId).toHaveBeenCalledWith('master-1');
    expect(medusaClient.setProductToDraft).toHaveBeenCalledWith('prod_1');
    expect(mappingRepo.update).toHaveBeenCalledWith(
      'master-1',
      expect.objectContaining({
        lastSyncAction: 'updated',
        lastSyncedAt: expect.any(Date),
      }),
    );
    expect((mappingRepo as any).delete).toBeUndefined();
  });

  it('does not call Medusa when a deleted master has no retained mapping', async () => {
    const { service, medusaClient, mappingRepo } = createService(null);

    await service.handleProductMasterDeleted({
      masterId: 'master-1',
      deletedAt: '2026-06-07T00:00:00.000Z',
    });

    expect(mappingRepo.update).not.toHaveBeenCalled();
    expect(medusaClient.setProductToDraft).not.toHaveBeenCalled();
  });
});

describe('PimMedusaSyncService.syncPriceLists (replace semantics)', () => {
  const OLD_GROUP = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

  beforeAll(() => {
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = 'cusgroup_membership';
  });
  afterAll(() => {
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = OLD_GROUP;
  });

  function createService() {
    const calls: string[] = [];
    const medusaClient = {
      ensurePriceList: jest.fn(async (payload: { name: string }) => {
        if (payload.name === 'Membership Prices') return 'plist_membership';
        return `plist_${payload.name.replace(/\s+/g, '_')}`;
      }),
      removeProductFromPriceList: jest.fn(async () => {
        calls.push('remove');
      }),
      addPricesToPriceList: jest.fn(async () => {
        calls.push('add');
      }),
    };
    const mappingRepo = { findByPimMasterId: jest.fn(), update: jest.fn() };
    const storefrontRevalidate = { revalidateProduct: jest.fn() };
    const service = new PimMedusaSyncService(medusaClient as any, mappingRepo as any, storefrontRevalidate as any);
    return { service, medusaClient, calls };
  }

  it('removes the product from the membership list before adding new prices so a re-sync replaces stale duplicates', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants);

    expect(medusaClient.removeProductFromPriceList).toHaveBeenCalledWith('plist_membership', 'prod_1');
    expect(medusaClient.addPricesToPriceList).toHaveBeenCalledWith('plist_membership', [
      { amount: 34000, currency_code: 'krw', variant_id: 'variant_m1' },
    ]);
    expect(calls).toEqual(['remove', 'add']);
  });

  it('removes the product from each tier list before adding tier prices so tier duplicates are replaced too', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [
        {
          id: 'pim-var-1',
          membershipPrice: 0,
          tieredPrices: [{ minQuantity: 5, price: 9000 }],
        },
      ],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants);

    const tierListId = 'plist_Tiered_Prices_-_Min_5';
    expect(medusaClient.removeProductFromPriceList).toHaveBeenCalledWith(tierListId, 'prod_1');
    expect(medusaClient.addPricesToPriceList).toHaveBeenCalledWith(tierListId, [
      { amount: 9000, currency_code: 'krw', variant_id: 'variant_m1', min_quantity: 5 },
    ]);
    expect(calls).toEqual(['remove', 'add']);
  });
});
