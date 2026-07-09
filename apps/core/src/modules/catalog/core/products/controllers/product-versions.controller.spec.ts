// product-versions.service.ts transitively imports '@packages/event-contracts' with a bare
// specifier (no subpath), which the jest moduleNameMapper (only maps `@packages/event-contracts/*`)
// cannot resolve. Mirror the virtual mock used in product-versions.service.spec.ts.
jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'products.events.v1' }, aggregateType: 'Product' },
  }),
  { virtual: true },
);

import { ProductVersionsController } from './product-versions.controller';

describe('ProductVersionsController.getMyDrafts', () => {
  it('delegates with the authenticated user id and maps dates to ISO strings', async () => {
    const service = {
      getMyDraftVersions: jest.fn().mockResolvedValue({
        data: [
          {
            masterId: 'm1',
            versionId: 'v1',
            name: 'A',
            thumbnail: 't',
            brand: 'B',
            productType: 'regular_sale',
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            updatedAt: new Date('2026-07-06T00:00:00.000Z'),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      }),
    };
    const controller = new ProductVersionsController(service as any);

    const res = await controller.getMyDrafts({ userId: 'user-1' }, { page: 1, limit: 20 } as any);

    expect(service.getMyDraftVersions).toHaveBeenCalledWith('user-1', expect.objectContaining({ page: 1, limit: 20 }));
    expect(res.total).toBe(1);
    expect(res.data[0]).toEqual({
      masterId: 'm1',
      versionId: 'v1',
      name: 'A',
      thumbnail: 't',
      brand: 'B',
      productType: 'regular_sale',
      status: 'draft',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    });
  });
});
