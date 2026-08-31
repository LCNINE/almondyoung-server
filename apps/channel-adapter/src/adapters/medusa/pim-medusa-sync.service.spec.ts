import { PimMedusaSyncService } from './pim-medusa-sync.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import type { PimProductSnapshot } from '../../types';
import { CategoryEnsureMemoService } from './category-ensure-memo.service';

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
    const deferredRevalidate = { enqueue: jest.fn() };
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
      deferredRevalidate as any,
      new CategoryEnsureMemoService({ get: () => undefined } as never),
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

describe('PimMedusaSyncService.syncFromSnapshot 의 revalidate 분기', () => {
  const snapshot: PimProductSnapshot = {
    masterId: 'master-1',
    versionId: 'version-1',
    version: 1,
    name: 'Test Product',
    variants: [
      {
        id: 'pim-var-1',
        isDefault: true,
        status: 'active',
        basePrice: 10000,
      },
    ],
    status: 'active',
  };

  function createService() {
    const medusaClient = {
      ensureProductType: jest.fn().mockResolvedValue('ptype_1'),
      getDefaultSalesChannel: jest.fn().mockResolvedValue('sc_1'),
      getShippingProfileIdForGroup: jest.fn().mockResolvedValue('ship_1'),
      upsertProduct: jest.fn().mockResolvedValue({
        product: { id: 'prod_1', variants: [] },
        action: 'created',
      }),
    };
    const mappingRepo = {
      findByPimMasterId: jest.fn().mockResolvedValue(null),
      recordSuccess: jest.fn().mockResolvedValue(undefined),
    };
    const storefrontRevalidate = { revalidateProduct: jest.fn().mockResolvedValue(undefined) };
    const deferredRevalidate = { enqueue: jest.fn() };
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
      deferredRevalidate as any,
      new CategoryEnsureMemoService({ get: () => undefined } as never),
    );

    return { service, storefrontRevalidate, deferredRevalidate };
  }

  it('대량등록(isBulk=true)이면 buffer 에 쌓고 즉시 revalidate 하지 않는다', async () => {
    const { service, storefrontRevalidate, deferredRevalidate } = createService();

    await service.syncFromSnapshot(snapshot, { skipCategorySync: true, isBulk: true });

    expect(deferredRevalidate.enqueue).toHaveBeenCalledWith('master-1');
    expect(storefrontRevalidate.revalidateProduct).not.toHaveBeenCalled();
  });

  it('단건 동기화(isBulk 없음)면 즉시 revalidate 하고 buffer 에 쌓지 않는다', async () => {
    const { service, storefrontRevalidate, deferredRevalidate } = createService();

    await service.syncFromSnapshot(snapshot, { skipCategorySync: true });

    expect(storefrontRevalidate.revalidateProduct).toHaveBeenCalledWith('master-1');
    expect(deferredRevalidate.enqueue).not.toHaveBeenCalled();
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
    const deferredRevalidate = { enqueue: jest.fn() };
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
      deferredRevalidate as any,
      new CategoryEnsureMemoService({ get: () => undefined } as never),
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
      ensurePriceList: jest.fn(async (payload: { name: string; rules?: Record<string, string[]> }) => {
        if (payload.name === 'Membership Prices') return 'plist_membership';
        return `plist_${payload.name.replace(/\s+/g, '_')}`;
      }),
      getAllVisitorsPriceListRule: jest.fn(async () => ({ region_id: ['reg_kr'] })),
      removeProductFromPriceList: jest.fn(async () => {
        calls.push('remove');
      }),
      addPricesToPriceList: jest.fn(async () => {
        calls.push('add');
      }),
    };
    const mappingRepo = { findByPimMasterId: jest.fn(), update: jest.fn() };
    const storefrontRevalidate = { revalidateProduct: jest.fn() };
    const deferredRevalidate = { enqueue: jest.fn() };
    const service = new PimMedusaSyncService(
      medusaClient as any,
      mappingRepo as any,
      storefrontRevalidate as any,
      deferredRevalidate as any,
      new CategoryEnsureMemoService({ get: () => undefined } as never),
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

  // Medusa 는 `rules_count 내림 → amount 오름` 으로 가격을 고른다. 룰이 0 개인 수량 할인 리스트는
  // 아무리 싸도 룰 1 개인 멤버십 리스트에 지므로, 둘을 동률(각 1개)로 맞춰야 최저가가 나간다.
  it('수량 할인 리스트에 region 룰을 붙여 멤버십 리스트와 rules_count 를 맞춘다', async () => {
    const { service, medusaClient } = createService();
    const snapshot = {
      variants: [
        {
          id: 'pim-var-1',
          membershipPrice: 8000,
          tieredPrices: [{ minQuantity: 5, price: 7000 }],
        },
      ],
    };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants);

    const payloads = medusaClient.ensurePriceList.mock.calls.map(([p]: [any]) => p);
    const membership = payloads.find((p: any) => p.name === 'Membership Prices');
    const tiered = payloads.find((p: any) => p.name === 'Tiered Prices - Min 5');

    expect(Object.keys(membership.rules)).toHaveLength(1);
    expect(membership.rules).toEqual({ 'customer.groups.id': ['cusgroup_membership'] });
    expect(Object.keys(tiered.rules)).toHaveLength(1);
    expect(tiered.rules).toEqual({ region_id: ['reg_kr'] });
  });

  it('수량 할인이 없으면 리전을 조회하지 않는다', async () => {
    const { service, medusaClient } = createService();
    const snapshot = { variants: [{ id: 'pim-var-1', membershipPrice: 8000, tieredPrices: [] }] };
    const medusaVariants = [{ id: 'variant_m1', metadata: { pimVariantId: 'pim-var-1' } }];

    await (service as any).syncPriceLists(snapshot, 'prod_1', medusaVariants);

    expect(medusaClient.getAllVisitorsPriceListRule).not.toHaveBeenCalled();
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
      categoryEnsureMemo: { value: new CategoryEnsureMemoService({ get: () => undefined } as never) },
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

describe('PimMedusaSyncService.handleCategoryChanged — 조상 재보장 메모', () => {
  const snapshot = (id: string, parentId: string | null, overrides: Record<string, unknown> = {}) =>
    ({
      id,
      name: `name-${id}`,
      slug: `slug-${id}`,
      description: null,
      parentId,
      level: parentId ? 1 : 0,
      path: id,
      sortOrder: 0,
      isActive: true,
      visibility: true,
      thumbnail: null,
      displaySettings: {},
      seoConfig: null,
      templateConfig: null,
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
      ...overrides,
    }) as any;

  const changed = (categoryId: string, category: unknown, ancestors: unknown[]) =>
    ({
      categoryId,
      changeType: 'updated',
      timestamp: '2026-08-14T00:00:00.000Z',
      category,
      ancestors,
    }) as any;

  function createService() {
    const medusaClient = {
      ensureCategoryFromSnapshot: jest.fn().mockResolvedValue('medusa-cat'),
      findCategoryByPimRef: jest.fn().mockResolvedValue({ id: 'medusa-cat', handle: 'handle-p1' }),
      softDeleteCategory: jest.fn().mockResolvedValue(undefined),
      invalidateCategoryCacheByHandle: jest.fn(),
    };
    const storefrontRevalidate = { revalidateCategory: jest.fn().mockResolvedValue(undefined) };
    const memo = new CategoryEnsureMemoService({ get: () => undefined } as never);
    const service = new PimMedusaSyncService(
      medusaClient as any,
      {} as any,
      storefrontRevalidate as any,
      { enqueue: jest.fn() } as any,
      memo,
    );

    const ensuredIds = () =>
      medusaClient.ensureCategoryFromSnapshot.mock.calls.map(([arg]: [{ id: string }]) => arg.id);

    return { service, medusaClient, ensuredIds };
  }

  it('같은 조상 체인이 연달아 오면 조상은 한 번만 보장한다', async () => {
    const { service, ensuredIds } = createService();
    const parent = snapshot('p1', null);

    await service.handleCategoryChanged(changed('c1', snapshot('c1', 'p1'), [parent]));
    await service.handleCategoryChanged(changed('c2', snapshot('c2', 'p1'), [parent]));

    expect(ensuredIds()).toEqual(['p1', 'c1', 'c2']);
  });

  it('조상 내용이 바뀌면 다시 보장한다', async () => {
    const { service, ensuredIds } = createService();

    await service.handleCategoryChanged(changed('c1', snapshot('c1', 'p1'), [snapshot('p1', null)]));
    await service.handleCategoryChanged(
      changed('c2', snapshot('c2', 'p1'), [snapshot('p1', null, { name: '이름 바뀜' })]),
    );

    expect(ensuredIds()).toEqual(['p1', 'c1', 'p1', 'c2']);
  });

  it('조상의 멤버십 전용 상속이 켜지면 내용이 달라지므로 다시 보장한다', async () => {
    const { service, ensuredIds } = createService();

    await service.handleCategoryChanged(changed('c1', snapshot('c1', 'p1'), [snapshot('p1', null)]));
    await service.handleCategoryChanged(
      changed('c2', snapshot('c2', 'p1'), [
        snapshot('p1', null, { displaySettings: { isVisibleToMembersOnly: true } }),
      ]),
    );

    expect(ensuredIds()).toEqual(['p1', 'c1', 'p1', 'c2']);
  });

  it('조상 자신은 그대로여도 그 위에서 멤버십 전용이 켜지면 다시 보장한다 — 판정은 누적된 값으로 한다', async () => {
    const { service, ensuredIds } = createService();
    const parent = snapshot('p1', 'g1');

    await service.handleCategoryChanged(changed('c1', snapshot('c1', 'p1'), [snapshot('g1', null), parent]));
    await service.handleCategoryChanged(
      changed('c2', snapshot('c2', 'p1'), [
        snapshot('g1', null, { displaySettings: { isVisibleToMembersOnly: true } }),
        parent,
      ]),
    );

    expect(ensuredIds()).toEqual(['g1', 'p1', 'c1', 'g1', 'p1', 'c2']);
  });

  it('삭제된 카테고리는 메모에서 지운다 — 다시 조상으로 오면 실제로 보장해야 한다', async () => {
    const { service, ensuredIds } = createService();
    const parent = snapshot('p1', null);

    await service.handleCategoryChanged(changed('c1', snapshot('c1', 'p1'), [parent]));
    await service.handleCategoryChanged({
      categoryId: 'p1',
      changeType: 'deleted',
      timestamp: '2026-08-14T00:00:00.000Z',
      category: null,
    } as any);
    await service.handleCategoryChanged(changed('c2', snapshot('c2', 'p1'), [parent]));

    expect(ensuredIds()).toEqual(['p1', 'c1', 'p1', 'c2']);
  });
});
