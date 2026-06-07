jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductMastersService } from './product-masters.service';
import { productMasters, productMasterVersions } from '../../../schema/catalog.schema';

describe('ProductMastersService Medusa projection outbox events', () => {
  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };
    const productSellableQuantity = {
      recalculateAndPublishForMaster: jest.fn().mockResolvedValue([]),
    };

    const service = new ProductMastersService(
      {} as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      productSellableQuantity as any,
      null,
    );

    return { service, productPublisher, outboxPublisher, productSellableQuantity };
  }

  it('passes the delete transaction to the ProductMasterDeleted outbox enqueue', async () => {
    const { service } = makeService();
    const tx: any = {
      select: jest.fn(() => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: () =>
              table === productMasterVersions ? [{ id: 'version-1', masterId: 'master-1', status: 'active' }] : [],
          }),
        }),
      })),
      update: jest.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => [{ id: 'master-1', deletedAt: new Date('2026-06-07T00:00:00.000Z') }],
          }),
        }),
      })),
    };
    tx.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => {
          const rows =
            table === productMasters
              ? [{ id: 'master-1', deletedAt: null }]
              : [{ id: 'version-1', masterId: 'master-1', status: 'active' }];
          return {
            limit: () => rows,
            then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(resolve(rows)),
          };
        },
      }),
    }));
    (service as any)._emitMasterDeletedEvent = jest.fn().mockResolvedValue(undefined);

    await service.deleteMaster('master-1', 'user-1', tx);

    expect((service as any)._emitMasterDeletedEvent).toHaveBeenCalledWith('master-1', tx);
  });

  it('enqueues ProductMasterDeleted through the transactional outbox and does not publish directly to Kafka', async () => {
    const { service, productPublisher, outboxPublisher } = makeService();
    const tx = {} as any;

    await (service as any)._emitMasterDeletedEvent('master-1', tx);

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'ProductMasterDeleted',
        aggregateType: 'Product',
        aggregateId: 'master-1',
        payload: expect.objectContaining({
          masterId: 'master-1',
        }),
      }),
      tx,
    );
    expect(productPublisher.publishEvent).not.toHaveBeenCalled();
  });
});
