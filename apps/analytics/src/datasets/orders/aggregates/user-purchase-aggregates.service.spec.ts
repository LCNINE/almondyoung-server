import { aggUserProductPurchase } from '../../../schema';
import { UserPurchaseAggregatesService } from './user-purchase-aggregates.service';

describe('UserPurchaseAggregatesService', () => {
  it('stores a missing channelProductId as null', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    const executor = {
      insert: jest.fn((table: unknown) => {
        if (table !== aggUserProductPurchase) throw new Error('Unexpected analytics table');
        return {
          values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return { onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) };
          },
        };
      }),
    };
    const dbService = { db: { transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(executor)) } };
    const service = new UserPurchaseAggregatesService(dbService as never);

    await service.applyOrderCreated(
      'customer-1',
      [
        {
          skuId: 'sku-1',
          masterId: 'master-1',
          versionId: 'version-1',
          variantId: 'variant-1',
          productName: 'Legacy product',
          quantity: 1,
          unitPrice: 1000,
          totalPrice: 1000,
        },
      ],
      new Date('2026-07-14T01:00:00.000Z'),
    );

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      customerId: 'customer-1',
      masterId: 'master-1',
      channelProductId: null,
    });
  });
});
