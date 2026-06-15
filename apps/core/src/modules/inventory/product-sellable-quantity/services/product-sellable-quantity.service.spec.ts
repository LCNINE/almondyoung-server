import { DbService } from '@app/db';
import { MergedSchema } from '../../../../platform/database/merged-schema';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from './product-sellable-quantity.service';
import { ProductSellableQuantityResult } from './product-sellable-quantity.calculator';

describe('ProductSellableQuantityService.recalculateAndPublishForVariant', () => {
  type RecalculateTx = NonNullable<Parameters<ProductSellableQuantityService['recalculateAndPublishForVariant']>[1]>;
  type PreviousProjection = {
    masterId: string | null;
    versionId: string | null;
    matchingId: string | null;
    sellableQuantity: number;
    stockBoundQuantity: number;
    isSellable: boolean;
    reason: string;
  };
  type OutboxMock = {
    enqueue: jest.Mock<ReturnType<OutboxService['enqueue']>, Parameters<OutboxService['enqueue']>>;
  };

  const projection: ProductSellableQuantityResult = {
    variantId: '11111111-1111-1111-1111-111111111111',
    masterId: '22222222-2222-2222-2222-222222222222',
    versionId: '33333333-3333-3333-3333-333333333333',
    matchingId: '44444444-4444-4444-4444-444444444444',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    preStockSellable: false,
    alwaysSellableZeroStock: false,
    availabilityOverride: null,
    components: [],
    calculatedAt: new Date('2026-05-26T00:00:00.000Z'),
  };

  function makeTx(previous: PreviousProjection | null = null): {
    tx: RecalculateTx;
    inserted: Array<Record<string, unknown>>;
  } {
    const inserted: Array<Record<string, unknown>> = [];
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      query: {
        productSellableQuantityProjections: {
          findFirst: jest.fn().mockResolvedValue(previous),
        },
      },
      insert: jest.fn(() => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    } as unknown as RecalculateTx;

    return {
      inserted,
      tx,
    };
  }

  function makeSelectBuilder(rows: unknown[]) {
    const builder = {
      from: jest.fn(() => builder),
      innerJoin: jest.fn(() => builder),
      where: jest.fn(() => builder),
      orderBy: jest.fn(() => Promise.resolve(rows)),
      groupBy: jest.fn(() => Promise.resolve(rows)),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };

    return builder;
  }

  function makePolicyCalculationTx(): {
    tx: RecalculateTx;
    inserted: Array<Record<string, unknown>>;
  } {
    const inserted: Array<Record<string, unknown>> = [];
    const selectResults: unknown[][] = [
      [{ id: projection.variantId, status: 'active' }],
      [
        {
          variantId: projection.variantId,
          masterId: projection.masterId,
          versionId: projection.versionId,
          salesStartDate: null,
          salesEndDate: null,
        },
      ],
      [],
      [{ variantId: projection.variantId, availabilityOverride: 'manual_out_of_stock' }],
    ];
    const tx = {
      execute: jest.fn().mockResolvedValue(undefined),
      select: jest.fn(() => makeSelectBuilder(selectResults.shift() ?? [])),
      query: {
        productSellableQuantityProjections: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      },
      insert: jest.fn(() => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
          };
        },
      })),
    } as unknown as RecalculateTx;

    return {
      inserted,
      tx,
    };
  }

  function makeOutbox(): OutboxMock {
    return {
      enqueue: jest
        .fn<ReturnType<OutboxService['enqueue']>, Parameters<OutboxService['enqueue']>>()
        .mockResolvedValue(undefined),
    };
  }

  function makeService(outbox: OutboxMock) {
    const db = { db: { transaction: jest.fn() } } as unknown as DbService<MergedSchema>;
    const service = new ProductSellableQuantityService(db, outbox as unknown as OutboxService);
    const getByVariantId = jest.spyOn(service, 'getByVariantId').mockResolvedValue(projection);
    return { service, getByVariantId };
  }

  it('이전 projection이 없으면 상태를 저장하고 ProductSellableQuantityChanged를 enqueue한다', async () => {
    const outbox = makeOutbox();
    const { service } = makeService(outbox);
    const { tx, inserted } = makeTx();

    const result = await service.recalculateAndPublishForVariant(projection.variantId, tx);

    expect(result.published).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [params, enqueueTx] = outbox.enqueue.mock.calls[0];
    expect(enqueueTx).toBe(tx);
    expect(params.eventType).toBe('ProductSellableQuantityChanged');
    expect(params.aggregateType).toBe('ProductSellableQuantity');
    expect(params.aggregateId).toBe(projection.variantId);
    expect(params.partitionKey).toBe(projection.variantId);
    expect(params.payload).toMatchObject({
      variantId: projection.variantId,
      sellableQuantity: 7,
      isSellable: true,
      calculatedAt: projection.calculatedAt.toISOString(),
    });
  });

  it('sales variant policy override가 있으면 매칭이 없어도 수동 품절 projection을 publish한다', async () => {
    const outbox = makeOutbox();
    const db = { db: { transaction: jest.fn() } } as unknown as DbService<MergedSchema>;
    const service = new ProductSellableQuantityService(db, outbox as unknown as OutboxService);
    const { tx, inserted } = makePolicyCalculationTx();

    const result = await service.recalculateAndPublishForVariant(projection.variantId, tx);

    expect(result.published).toBe(true);
    expect(result.projection).toMatchObject({
      variantId: projection.variantId,
      sellableQuantity: 0,
      stockBoundQuantity: 0,
      isSellable: false,
      reason: 'MANUAL_OUT_OF_STOCK',
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(inserted[0]).toMatchObject({
      variantId: projection.variantId,
      sellableQuantity: 0,
      stockBoundQuantity: 0,
      isSellable: false,
      reason: 'MANUAL_OUT_OF_STOCK',
    });
    const [params] = outbox.enqueue.mock.calls[0];
    expect(params.payload).toMatchObject({
      variantId: projection.variantId,
      sellableQuantity: 0,
      stockBoundQuantity: 0,
      isSellable: false,
      reason: 'MANUAL_OUT_OF_STOCK',
      availabilityOverride: 'manual_out_of_stock',
    });
  });

  it('계산 결과가 이전 projection과 같으면 outbox enqueue 없이 no-op 처리한다', async () => {
    const outbox = makeOutbox();
    const { service } = makeService(outbox);
    const { tx, inserted } = makeTx({
      masterId: projection.masterId,
      versionId: projection.versionId,
      matchingId: projection.matchingId,
      sellableQuantity: projection.sellableQuantity,
      stockBoundQuantity: projection.stockBoundQuantity,
      isSellable: projection.isSellable,
      reason: projection.reason,
    });

    const result = await service.recalculateAndPublishForVariant(projection.variantId, tx);

    expect(result.published).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('여러 variant 재계산은 advisory lock 순서를 안정화하기 위해 정렬하고 중복 제거한다', async () => {
    const outbox = makeOutbox();
    const { service, getByVariantId } = makeService(outbox);
    const { tx } = makeTx();

    await service.recalculateAndPublishForVariants(
      [
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      ],
      tx,
    );

    expect(getByVariantId.mock.calls.map((call) => call[0])).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
  });
});
