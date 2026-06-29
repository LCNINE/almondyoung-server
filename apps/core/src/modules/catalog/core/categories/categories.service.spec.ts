jest.mock(
  '@packages/event-contracts/streams/product.stream',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductCategoriesService } from './categories.service';

describe('ProductCategoriesService Medusa projection outbox events', () => {
  function makeCategory(overrides: Record<string, any> = {}) {
    return {
      id: 'cat-1',
      name: 'Lip',
      slug: 'lip',
      description: null,
      parentId: null,
      level: 0,
      path: 'cat-1',
      sortOrder: 0,
      isActive: true,
      visibility: true,
      imageUrl: null,
      displaySettings: null,
      seoConfig: null,
      templateConfig: null,
      createdAt: new Date('2026-06-07T00:00:00.000Z'),
      updatedAt: new Date('2026-06-07T00:00:00.000Z'),
      ...overrides,
    };
  }

  function makeService() {
    const tx = {
      update: jest.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => [makeCategory({ name: 'Updated Lip' })],
          }),
        }),
      })),
    };
    const db = {
      run: jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>, t?: typeof tx) => callback(t ?? tx)),
    };
    const outboxPublisher = {
      saveEvent: jest.fn().mockResolvedValue(undefined),
    };

    const service = new (ProductCategoriesService as any)(
      db,
      {} as any,
      outboxPublisher,
    ) as ProductCategoriesService;

    return { service, tx, outboxPublisher };
  }

  it('enqueues CategoryChanged through the transactional outbox using the category transaction', async () => {
    const { service, tx, outboxPublisher } = makeService();

    await service.updateCategory('cat-1', { name: 'Updated Lip' } as any);

    expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'products.events.v1',
        eventType: 'CategoryChanged',
        aggregateType: 'Product',
        aggregateId: 'cat-1',
        payload: expect.objectContaining({
          categoryId: 'cat-1',
          changeType: 'updated',
          category: expect.objectContaining({
            id: 'cat-1',
            name: 'Updated Lip',
            slug: 'lip',
          }),
        }),
      }),
      tx,
    );
  });
});
