jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductVersionsService } from './product-versions.service';

describe('ProductVersionsService Medusa projection outbox events', () => {
  function makeService() {
    const productPublisher = {
      publishEvent: jest.fn().mockResolvedValue(undefined),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };

    const service = new ProductVersionsService(
      {} as any,
      productPublisher as any,
      outboxPublisher as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    return { service, productPublisher, outboxPublisher };
  }

  it('enqueues ProductMasterActiveVersionChanged through the transactional outbox using the provided tx', async () => {
    const { service, productPublisher, outboxPublisher } = makeService();
    const tx = {} as any;
    const snapshot = {
      masterId: 'master-1',
      versionId: 'version-2',
      version: 2,
      name: 'Lip Tint',
      variants: [],
      status: 'active',
      isWholesaleOnly: false,
      isMembershipOnly: false,
      isGiftcard: false,
      discountable: true,
      categories: [{ id: 'cat-1' }],
    };

    (service as any)._buildFullSnapshot = jest.fn().mockResolvedValue(snapshot);
    (service as any).getPrimaryCategoryId = jest.fn().mockResolvedValue('cat-1');

    await (service as any)._emitActiveVersionChangedEvent(
      {
        id: 'version-2',
        masterId: 'master-1',
        name: 'Lip Tint',
      },
      null,
      'active',
      tx,
    );

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'ProductMasterActiveVersionChanged',
        aggregateType: 'Product',
        aggregateId: 'master-1',
        payload: expect.objectContaining({
          masterId: 'master-1',
          versionId: 'version-2',
          name: 'Lip Tint',
          previousActiveVersionId: null,
          categoryIds: ['cat-1'],
          primaryCategoryId: 'cat-1',
          changeReason: 'published',
          snapshot,
        }),
      }),
      tx,
    );
    expect(productPublisher.publishEvent).not.toHaveBeenCalled();
  });

  it('fails published/rollback events before enqueueing when the full snapshot cannot be built', async () => {
    const { service, outboxPublisher } = makeService();
    const tx = {} as any;
    (service as any)._buildFullSnapshot = jest.fn().mockRejectedValue(new Error('snapshot unavailable'));

    await expect(
      (service as any)._emitActiveVersionChangedEvent(
        {
          id: 'version-2',
          masterId: 'master-1',
          name: 'Lip Tint',
        },
        null,
        'active',
        tx,
      ),
    ).rejects.toThrow('snapshot unavailable');

    expect(outboxPublisher.saveEvent).not.toHaveBeenCalled();
  });
});
