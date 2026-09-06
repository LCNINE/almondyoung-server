import { ProductMatchingService } from './product-matching.service';
import { ResolveMatchingDto } from '../dto/resolve-matching.dto';

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
  const linkResolver = {
    resolve: jest.fn(async (links: Array<{ skuId?: string; newSku?: unknown; quantity?: number }>) =>
      links.map((link, index) => ({
        skuId: link.skuId ?? `created-${index + 1}`,
        quantity: link.quantity ?? 1,
      })),
    ),
  };
  const transactionTxs = [...(options.transactionTxs ?? [])];
  const dbService = {
    run: jest.fn(async (fn, tx) => (tx ? fn(tx) : fn(transactionTxs.shift() ?? makeTx()))),
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
    productSellableQuantity as never,
    fulfillmentBacklog as never,
    auditService as never,
    linkResolver as never,
  );

  return {
    service,
    productSellableQuantity,
    fulfillmentBacklog,
    dbService,
    auditService,
    linkResolver,
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

describe('ProductMatchingService strategy semantics', () => {
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
    const tx = makeTx([[matching], [{ id: '44444444-4444-4444-4444-444444444444' }]]);
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
    const tx = makeTx([[matching], [{ id: '44444444-4444-4444-4444-444444444444' }]]);
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
    const { service, fulfillmentBacklog } = makeService();
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
      comingSoonDate: null,
    });
  });
});

// makeService · makeTx · matching 은 Step 2 앞부분에서 파일 최상위로 끌어올린 것을 그대로 쓴다.
describe('ProductMatchingService links input', () => {
  const EXISTING_SKU = '44444444-4444-4444-4444-444444444444';

  it('resolves links by creating new SKUs on the same transaction', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }, { id: 'created-2' }]]);

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        links: [
          { skuId: EXISTING_SKU, quantity: 2 },
          { newSku: { name: 'S / 검정' } as never },
        ],
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).toHaveBeenCalledWith(
      [{ skuId: EXISTING_SKU, quantity: 2 }, { newSku: { name: 'S / 검정' } }],
      tx,
    );
    expect(tx.inserts[0]).toMatchObject({ productMatchingId: matching.id, skuId: EXISTING_SKU, quantity: 2 });
    expect(tx.inserts[1]).toMatchObject({ productMatchingId: matching.id, skuId: 'created-2', quantity: 1 });
    expect(tx.updates[0]).toMatchObject({ status: 'matched', strategy: 'variant', isResolved: true });
  });

  it('resolves links on the transaction it opens, not on an ambient connection', async () => {
    // run 이 여는 «내부» 트랜잭션. 바깥에서 tx 를 넘기지 않으므로 이것이 콜백의 trx 가 된다.
    // makeService 에 같은 innerTx 를 두 번 넣으므로 selectRowsQueue 도 공유된다 —
    // 첫 run(매칭 조회)이 [matching] 을 소진하고, 두 번째 run(validate) 이 [{id:…},{id:…}] 를 받는다.
    const innerTx = makeTx([[matching], [{ id: EXISTING_SKU }, { id: 'created-2' }]]);
    const { service, linkResolver } = makeService({ transactionTxs: [innerTx, innerTx] });

    await service.resolveMatchingPending(matching.id, {
      strategy: 'variant',
      links: [
        { skuId: EXISTING_SKU, quantity: 2 },
        { newSku: { name: 'S / 검정' } as never },
      ],
    } as ResolveMatchingDto); // ← tx 를 넘기지 않는다: 구현이 어떤 트랜잭션을 여는지가 이 테스트의 핵심이다

    // 리졸버는 «그 내부 트랜잭션»을 받아야 한다. 구현이 run 밖에서 불렀다면 여기서 깨진다.
    expect(linkResolver.resolve).toHaveBeenCalledWith(
      [{ skuId: EXISTING_SKU, quantity: 2 }, { newSku: { name: 'S / 검정' } }],
      innerTx,
    );
    expect(innerTx.inserts[0]).toMatchObject({ productMatchingId: matching.id, skuId: EXISTING_SKU, quantity: 2 });
    expect(innerTx.inserts[1]).toMatchObject({ productMatchingId: matching.id, skuId: 'created-2', quantity: 1 });
  });

  it('prefers links over the deprecated skuMappings input', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }]]);

    await service.resolveMatchingPending(
      matching.id,
      {
        strategy: 'variant',
        links: [{ skuId: EXISTING_SKU, quantity: 3 }],
        skuMappings: [{ skuId: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
      } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).toHaveBeenCalledTimes(1);
    expect(tx.inserts[0]).toMatchObject({ skuId: EXISTING_SKU, quantity: 3 });
  });

  it('rejects links together with the void strategy', async () => {
    const { service } = makeService();
    const tx = makeTx([[matching]]);

    await expect(
      service.resolveMatchingPending(
        matching.id,
        { strategy: 'void', links: [{ skuId: EXISTING_SKU }] } as ResolveMatchingDto,
        tx as never,
      ),
    ).rejects.toThrow('void strategy does not accept SKU mappings.');
  });

  it('does not call the resolver when no links are supplied', async () => {
    const { service, linkResolver } = makeService();
    const tx = makeTx([[matching], [{ id: EXISTING_SKU }]]);

    await service.resolveMatchingPending(
      matching.id,
      { strategy: 'variant', skuMappings: [{ skuId: EXISTING_SKU, quantity: 1 }] } as ResolveMatchingDto,
      tx as never,
    );

    expect(linkResolver.resolve).not.toHaveBeenCalled();
  });
});
