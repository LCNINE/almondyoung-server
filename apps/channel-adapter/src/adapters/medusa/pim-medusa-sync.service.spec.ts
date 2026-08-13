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
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
    );

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

  it('throws when the event lacks masterId because channel-adapter must not guess product identity', async () => {
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
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
    );

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
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
    );
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

  it('신규 생성 상품이면 remove 를 건너뛰고 add 만 한다', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, { skipRemove: true });

    expect(medusaClient.removeProductFromPriceList).not.toHaveBeenCalled();
    expect(medusaClient.addPricesToPriceList).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['add']);
  });

  it('기존 상품이면 지금까지대로 remove 후 add 한다', async () => {
    const { service, medusaClient, calls } = createService();
    const snapshot = {
      variants: [{ id: 'pim-var-1', membershipPrice: 34000, tieredPrices: [] }],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants, { skipRemove: false });

    expect(medusaClient.removeProductFromPriceList).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['remove', 'add']);
  });
});

describe('PimMedusaSyncService 카테고리 조상 처리', () => {
  const makeService = () => {
    const ensureCategoryFromSnapshot = jest.fn().mockResolvedValue('pcat_x');
    const medusaClient = { ensureCategoryFromSnapshot } as any;
    const service = Object.create(PimMedusaSyncService.prototype) as PimMedusaSyncService;
    Object.defineProperties(service, {
      medusaClient: { value: medusaClient },
      logger: { value: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      storefrontRevalidate: { value: { revalidateCategory: jest.fn() } },
    });
    return { service, ensureCategoryFromSnapshot };
  };

  const cat = (id: string, parentId: string | null, membersOnly = false) => ({
    id,
    name: id,
    slug: id,
    description: null,
    parentId,
    level: 0,
    path: id,
    sortOrder: 0,
    isActive: true,
    visibility: true,
    thumbnail: null,
    displaySettings: membersOnly ? { isVisibleToMembersOnly: true } : null,
    seoConfig: null,
    templateConfig: null,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
  });

  it('조상을 루트부터 먼저 보장하고 대상 카테고리는 마지막에 처리한다', async () => {
    const { service, ensureCategoryFromSnapshot } = makeService();

    await service.handleCategoryChanged({
      categoryId: 'grand',
      changeType: 'created',
      timestamp: '2026-07-27T00:00:00.000Z',
      category: cat('grand', 'child') as any,
      ancestors: [cat('root', null) as any, cat('child', 'root') as any],
    });

    expect(ensureCategoryFromSnapshot.mock.calls.map((c) => c[0].id)).toEqual(['root', 'child', 'grand']);
  });

  it('조상이 멤버십 전용이면 자손과 중간 조상까지 상속시킨다', async () => {
    const { service, ensureCategoryFromSnapshot } = makeService();

    await service.handleCategoryChanged({
      categoryId: 'grand',
      changeType: 'created',
      timestamp: '2026-07-27T00:00:00.000Z',
      category: cat('grand', 'child') as any,
      ancestors: [cat('root', null, true) as any, cat('child', 'root') as any],
    });

    const flags = ensureCategoryFromSnapshot.mock.calls.map((c) => [c[0].id, c[0].isVisibleToMembersOnly]);
    expect(flags).toEqual([
      ['root', true],
      ['child', true],
      ['grand', true],
    ]);
  });

  it('조상이 일반이면 자손도 자기 값만 쓴다', async () => {
    const { service, ensureCategoryFromSnapshot } = makeService();

    await service.handleCategoryChanged({
      categoryId: 'child',
      changeType: 'created',
      timestamp: '2026-07-27T00:00:00.000Z',
      category: cat('child', 'root') as any,
      ancestors: [cat('root', null) as any],
    });

    const flags = ensureCategoryFromSnapshot.mock.calls.map((c) => [c[0].id, c[0].isVisibleToMembersOnly]);
    expect(flags).toEqual([
      ['root', false],
      ['child', false],
    ]);
  });
});

import { isBulkOrigin } from './pim-medusa-sync.service';

describe('isBulkOrigin', () => {
  it('bulk_import 를 대량으로 판정한다', () => {
    expect(isBulkOrigin('bulk_import')).toBe(true);
  });

  it('출처가 없으면 단건으로 판정한다', () => {
    expect(isBulkOrigin(undefined)).toBe(false);
    expect(isBulkOrigin('')).toBe(false);
  });

  it('모르는 출처는 단건으로 판정한다 — 안전한 쪽이 즉시 반영이다', () => {
    expect(isBulkOrigin('admin_ui')).toBe(false);
  });
});
