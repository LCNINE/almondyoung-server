import { ProductMatchingService } from './product-matching.service';
import { ResolveMatchingDto } from '../dto/resolve-matching.dto';

describe('ProductMatchingService strategy semantics', () => {
  const matching = {
    id: '11111111-1111-1111-1111-111111111111',
    variantId: '22222222-2222-2222-2222-222222222222',
    masterId: '33333333-3333-3333-3333-333333333333',
  };

  function makeService(options: { transactionTxs?: Array<ReturnType<typeof makeTx>> } = {}) {
    const productSellableQuantity = {
      recalculateAndPublishForVariant: jest.fn().mockResolvedValue({ projection: null, published: false }),
    };
    const fulfillmentBacklog = {
      wakeBacklogsWaitingForVariant: jest.fn().mockResolvedValue(0),
    };
    const auditService = {
      log: jest.fn().mockResolvedValue(undefined),
    };
    const stockEventService = {
      createStockEntryBySkuId: jest.fn().mockImplementation(async ({ quantity }) => {
        if (quantity <= 0) {
          throw new Error('quantity must be positive');
        }

        return { skuId: 'unused' };
      }),
    };
    const warehouseService = {
      getDefaultId: jest.fn(() => '44444444-4444-4444-4444-444444444444'),
    };
    const transactionTxs = [...(options.transactionTxs ?? [])];
    const dbService = {
      run: jest.fn(async (fn, tx) => tx ? fn(tx) : fn(transactionTxs.shift() ?? makeTx())),
      db: {
        query: {
          skus: {
            findFirst: jest.fn().mockResolvedValue({ id: '44444444-4444-4444-4444-444444444444' }),
          },
        },
      },
    };

    const service = new ProductMatchingService(
      dbService as never,
      {} as never,
      stockEventService as never,
      warehouseService as never,
      productSellableQuantity as never,
      fulfillmentBacklog as never,
      auditService as never,
    );

    return {
      service,
      productSellableQuantity,
      fulfillmentBacklog,
      stockEventService,
      warehouseService,
      dbService,
      auditService,
    };
  }

  function makeTx(selectRowsQueue: unknown[][] = [[]]) {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    const deletes: unknown[] = [];

    const tx = {
      inserts,
      updates,
      deletes,
      query: {
        skus: {
          findFirst: jest.fn().mockResolvedValue({ id: '44444444-4444-4444-4444-444444444444' }),
        },
      },
      select: jest.fn(() => {
        const rows = selectRowsQueue.shift() ?? [];
        const builder: Record<string, jest.Mock> = {};
        builder.from = jest.fn(() => builder);
        builder.where = jest.fn(() => builder);
        builder.leftJoin = jest.fn(() => builder);
        builder.orderBy = jest.fn(() => builder);
        builder.limit = jest.fn(() => builder);
        builder.offset = jest.fn(() => builder);
        builder.then = jest.fn((resolve, reject) => Promise.resolve(rows).then(resolve, reject));
        builder.catch = jest.fn((reject) => Promise.resolve(rows).catch(reject));
        return builder;
      }),
      insert: jest.fn(() => ({
        values: jest.fn((values: unknown) => {
          inserts.push(values);
          return {
            returning: jest.fn().mockResolvedValue([{ ...matching, ...(values as object) }]),
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        }),
      })),
      update: jest.fn(() => ({
        set: jest.fn((values: unknown) => {
          updates.push(values);
          return {
            where: jest.fn(() => ({
              returning: jest.fn().mockResolvedValue([{ ...matching, ...(values as object) }]),
            })),
          };
        }),
      })),
      delete: jest.fn(() => ({
        where: jest.fn((where: unknown) => {
          deletes.push(where);
          return Promise.resolve();
        }),
      })),
    };

    return tx;
  }

  it('maps legacy ignore=true input to matched + void without SKU links', async () => {
    const { service, productSellableQuantity, fulfillmentBacklog } = makeService();
    const tx = makeTx([[matching]]);

    const result = await service.resolveMatchingPending(
      matching.id,
      { ignore: true } as ResolveMatchingDto,
      tx as never,
    );

    expect(tx.inserts).toHaveLength(0);
    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'void',
      isResolved: true,
    });
    expect(result).toMatchObject({
      id: matching.id,
      status: 'matched',
      strategy: 'void',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('resolves strategy=void without requiring SKU links', async () => {
    const { service } = makeService();
    const tx = makeTx([[matching]]);

    await service.resolveMatchingPending(matching.id, { strategy: 'void' } as ResolveMatchingDto, tx as never);

    expect(tx.inserts).toHaveLength(0);
    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'void',
      isResolved: true,
    });
  });

  it('persists accepted availability override when resolving as void', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = makeTx([[matching]]);

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'void',
        stockPolicy: {
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'void',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    });
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('resolves SKU 구성 매칭 and wakes waiting fulfillment backlog', async () => {
    const { service, fulfillmentBacklog } = makeService();
    const tx = makeTx([[matching]]);
    const skuId = '44444444-4444-4444-4444-444444444444';

    const result = await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        skuMappings: [{ skuId, quantity: 2 }],
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(tx.inserts[0]).toMatchObject({
      productMatchingId: matching.id,
      skuId,
      quantity: 2,
    });
    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'variant',
      isResolved: true,
    });
    expect(result).toMatchObject({
      id: matching.id,
      status: 'matched',
      strategy: 'variant',
    });
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('persists accepted availability override when resolving SKU 구성 matching', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = makeTx([[matching]]);
    const skuId = '44444444-4444-4444-4444-444444444444';

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        skuMappings: [{ skuId, quantity: 2 }],
        stockPolicy: {
          preStockSellable: false,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(tx.inserts[0]).toMatchObject({
      productMatchingId: matching.id,
      skuId,
      quantity: 2,
    });
    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'variant',
      isResolved: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
    });
    expect(tx.inserts[1]).toMatchObject({
      variantId: matching.variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('uses one transaction for void update and sellable projection recalculation', async () => {
    const selectTx = makeTx([[matching]]);
    const updateTx = makeTx();
    const { service, productSellableQuantity, dbService } = makeService({
      transactionTxs: [selectTx, updateTx],
    });

    await service.resolveMatchingPending(matching.id, { strategy: 'void' } as ResolveMatchingDto);

    expect(dbService.run).toHaveBeenCalledTimes(2);
    expect(updateTx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'void',
      isResolved: true,
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, updateTx);
  });

  it('creates non-inventory-managed variants as matched + void', async () => {
    const { service } = makeService();
    const tx = makeTx([[]]);

    const result = await service.handleAutomaticMatchingRequest(
      {
        masterId: matching.masterId,
        name: 'Product',
        variants: [
          {
            id: matching.variantId,
            name: 'Variant',
            inventoryManagement: false,
            components: [],
          },
        ],
      },
      tx as never,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      masterId: matching.masterId,
      status: 'matched',
      strategy: 'void',
      isResolved: true,
    });
  });

  it('converts existing matchings to void when inventory management is turned off', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = makeTx([
      [
        {
          ...matching,
          status: 'matched',
          strategy: 'variant',
          isResolved: true,
        },
      ],
    ]);

    const result = await service.handleAutomaticMatchingRequest(
      {
        masterId: matching.masterId,
        name: 'Product',
        variants: [
          {
            id: matching.variantId,
            name: 'Variant',
            inventoryManagement: false,
            components: [],
          },
        ],
      },
      tx as never,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(tx.inserts).toHaveLength(0);
    expect(tx.deletes).toHaveLength(1);
    expect(tx.updates[0]).toMatchObject({
      masterId: matching.masterId,
      status: 'matched',
      strategy: 'void',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('creates inventory-managed variants without SKU components as pending and does not wake fulfillment backlog', async () => {
    const { service, productSellableQuantity, fulfillmentBacklog } = makeService();
    const tx = makeTx([[]]);

    const result = await service.handleAutomaticMatchingRequest(
      {
        masterId: matching.masterId,
        name: 'Product',
        variants: [
          {
            id: matching.variantId,
            name: 'Variant',
            inventoryManagement: true,
            components: [],
          },
        ],
      },
      tx as never,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      masterId: matching.masterId,
      status: 'pending',
      strategy: null,
      isResolved: false,
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
  });

  it('resolves existing pending automatic SKU 구성 matching without stock entry and wakes waiting fulfillment backlog', async () => {
    const { service, fulfillmentBacklog, stockEventService, warehouseService } = makeService();
    const skuId = '55555555-5555-5555-5555-555555555555';
    const tx = makeTx([
      [
        {
          ...matching,
          status: 'pending',
          strategy: null,
          isResolved: false,
        },
      ],
    ]);

    const result = await service.handleAutomaticMatchingRequest(
      {
        masterId: matching.masterId,
        name: 'Product',
        variants: [
          {
            id: matching.variantId,
            name: 'Variant',
            inventoryManagement: true,
            components: [{ skuId, skuName: 'SKU' }],
          },
        ],
      },
      tx as never,
    );

    expect(result).toEqual({ created: 1, skipped: 0 });
    expect(tx.deletes).toHaveLength(1);
    expect(tx.inserts[0]).toMatchObject({
      productMatchingId: matching.id,
      skuId,
      quantity: 1,
    });
    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'variant',
      isResolved: true,
    });
    expect(warehouseService.getDefaultId).not.toHaveBeenCalled();
    expect(stockEventService.createStockEntryBySkuId).not.toHaveBeenCalled();
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('rejects SKU mappings when resolving explicitly as void', async () => {
    const { service } = makeService();
    const tx = makeTx([[matching]]);

    await expect(
      service.resolveMatchingPending(
        matching.id,
        { strategy: 'void', skuIds: ['44444444-4444-4444-4444-444444444444'] } as ResolveMatchingDto,
        tx as never,
      ),
    ).rejects.toThrow('void strategy does not accept SKU mappings');

    expect(tx.updates).toHaveLength(0);
  });

  it('lists legacy ignored matchings with variant identity, product name, and SKU link state', async () => {
    const { service } = makeService();
    const createdAt = new Date('2026-05-01T00:00:00.000Z');
    const updatedAt = new Date('2026-05-02T00:00:00.000Z');
    const tx = makeTx([
      [{ total: 1 }],
      [
        {
          ...matching,
          status: 'ignored',
          priority: 'normal',
          strategy: 'variant',
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          createdAt,
          updatedAt,
        },
      ],
      [
        {
          productMatchingId: matching.id,
          skuId: '44444444-4444-4444-4444-444444444444',
          quantity: 2,
          skuName: 'SKU A',
          skuCode: 'SKU-A',
        },
      ],
      [
        {
          id: matching.variantId,
          variantName: '옵션 A',
          variantCode: 'VAR-A',
        },
      ],
      [
        {
          variantId: matching.variantId,
          availabilityOverride: 'manual_out_of_stock',
        },
      ],
      [
        {
          masterId: matching.masterId,
          versionId: '55555555-5555-5555-5555-555555555555',
          name: '상품 A',
          status: 'active',
          updatedAt,
          createdAt,
        },
      ],
    ]);

    const result = await service.getLegacyIgnoredMatchings({ limit: 20, offset: 0 }, tx as never);

    expect(result).toMatchObject({
      total: 1,
      data: [
        {
          id: matching.id,
          variantId: matching.variantId,
          status: 'ignored',
          strategy: 'variant',
          skuLinkCount: 1,
          hasSkuLinks: true,
          stockPolicy: {
            preStockSellable: true,
            alwaysSellableZeroStock: false,
            availabilityOverride: 'manual_out_of_stock',
          },
          master: {
            id: matching.masterId,
            name: '상품 A',
          },
          variant: {
            id: matching.variantId,
            name: '옵션 A',
          },
          matchedSkus: [
            {
              skuId: '44444444-4444-4444-4444-444444444444',
              skuName: 'SKU A',
              skuCode: 'SKU-A',
              quantity: 2,
            },
          ],
        },
      ],
    });
  });

  it('resolves legacy ignored matching back to pending and records audit log', async () => {
    const { service, auditService, productSellableQuantity, fulfillmentBacklog } = makeService();
    const ignoredMatching = {
      ...matching,
      status: 'ignored',
      strategy: 'variant',
      isResolved: false,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    };
    const tx = makeTx([[ignoredMatching], [{ skuId: '44444444-4444-4444-4444-444444444444', quantity: 1 }]]);

    const result = await service.resolveLegacyIgnoredMatching(
      matching.id,
      { target: 'pending' },
      { userId: 'operator-1' },
      tx as never,
    );

    expect(tx.deletes).toHaveLength(1);
    expect(tx.updates[0]).toMatchObject({
      status: 'pending',
      strategy: null,
      isResolved: false,
    });
    expect(result).toMatchObject({ status: 'pending', strategy: null, isResolved: false });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'USER_ACTION',
        action: 'legacy_ignored_to_pending',
        resourceId: matching.id,
        changesBefore: expect.objectContaining({
          status: 'ignored',
          skuLinks: [{ skuId: '44444444-4444-4444-4444-444444444444', quantity: 1 }],
        }),
        changesAfter: expect.objectContaining({
          status: 'pending',
          strategy: null,
          skuLinks: [],
        }),
      }),
      { userId: 'operator-1' },
      tx,
    );
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).not.toHaveBeenCalled();
  });

  it('resolves legacy ignored matching to matched + void and wakes waiting fulfillment backlog', async () => {
    const { service, auditService, fulfillmentBacklog } = makeService();
    const ignoredMatching = {
      ...matching,
      status: 'ignored',
      strategy: null,
      isResolved: false,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
    };
    const tx = makeTx([[ignoredMatching], []]);

    const result = await service.resolveLegacyIgnoredMatching(
      matching.id,
      {
        target: 'void',
        stockPolicy: {
          preStockSellable: true,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
      },
      { userId: 'operator-1' },
      tx as never,
    );

    expect(tx.updates[0]).toMatchObject({
      status: 'matched',
      strategy: 'void',
      isResolved: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
    });
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      inventoryManagement: true,
      preStockSellable: true,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(result).toMatchObject({ status: 'matched', strategy: 'void', isResolved: true });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'legacy_ignored_to_void',
        changesAfter: expect.objectContaining({
          status: 'matched',
          strategy: 'void',
          isResolved: true,
        }),
      }),
      { userId: 'operator-1' },
      tx,
    );
    expect(fulfillmentBacklog.wakeBacklogsWaitingForVariant).toHaveBeenCalledWith(matching.variantId, tx);
  });

  it('updates sales variant policy override and recalculates projection', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = makeTx([[matching]]);

    const result = await service.updateStockPolicy(
      matching.id,
      {
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
      tx as never,
    );

    expect(tx.updates[0]).toMatchObject({
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      updatedAt: expect.any(Date),
    });
    expect(tx.updates[0]).not.toHaveProperty('availabilityOverride');
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
    expect(result).toMatchObject({ id: matching.id });
  });

  it('returns sales variant policy when variant has no matching row', async () => {
    const { service } = makeService();
    const tx = makeTx([
      [],
      [
        {
          variantId: matching.variantId,
          preStockSellable: false,
          alwaysSellableZeroStock: false,
          availabilityOverride: 'manual_out_of_stock',
        },
      ],
    ]);

    await expect(service.getStockPolicyForVariant(matching.variantId, tx as never)).resolves.toEqual({
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
  });
});
