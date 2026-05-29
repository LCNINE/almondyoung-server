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
    const transactionTxs = [...(options.transactionTxs ?? [])];
    const dbService = {
      db: {
        transaction: jest.fn(async (fn) => fn(transactionTxs.shift() ?? makeTx())),
      },
    };

    const service = new ProductMatchingService(
      dbService as never,
      {} as never,
      {} as never,
      {} as never,
      productSellableQuantity as never,
    );

    return { service, productSellableQuantity, dbService };
  }

  function makeTx(selectRowsQueue: unknown[][] = [[]]) {
    const inserts: unknown[] = [];
    const updates: unknown[] = [];
    const deletes: unknown[] = [];

    const tx = {
      inserts,
      updates,
      deletes,
      select: jest.fn(() => {
        const rows = selectRowsQueue.shift() ?? [];
        const builder: Record<string, jest.Mock> = {};
        builder.from = jest.fn(() => builder);
        builder.where = jest.fn(() => builder);
        builder.limit = jest.fn().mockResolvedValue(rows);
        return builder;
      }),
      insert: jest.fn(() => ({
        values: jest.fn((values: unknown) => {
          inserts.push(values);
          return Promise.resolve();
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
    const { service, productSellableQuantity } = makeService();
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

  it('uses one transaction for void update and sellable projection recalculation', async () => {
    const selectTx = makeTx([[matching]]);
    const updateTx = makeTx();
    const { service, productSellableQuantity, dbService } = makeService({
      transactionTxs: [selectTx, updateTx],
    });

    await service.resolveMatchingPending(matching.id, { strategy: 'void' } as ResolveMatchingDto);

    expect(dbService.db.transaction).toHaveBeenCalledTimes(2);
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
});
