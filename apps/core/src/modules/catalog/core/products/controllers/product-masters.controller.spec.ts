jest.mock(
  '@packages/event-contracts',
  () => ({
    PRODUCT_STREAM: { topic: { topic: 'product-stream' } },
  }),
  { virtual: true },
);

import { ProductMastersController } from './product-masters.controller';

describe('ProductMastersController', () => {
  function makeController() {
    const productMastersService = {
      getMasters: jest.fn().mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
    };
    const controller = new ProductMastersController(null as any, productMastersService as any, null as any);

    return { controller, productMastersService };
  }

  it('maps q to the keyword(name) filter and forwards typed fields', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({ page: 2, limit: 20, q: '립스틱' } as any);

    expect(productMastersService.getMasters).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      categoryId: undefined,
      brand: undefined,
      name: '립스틱',
      mode: undefined,
      productType: undefined,
      approvalStatus: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      sort: undefined,
      order: undefined,
      deleted: false,
      ids: undefined,
    });
  });

  it('forwards the new filter and sort fields to the service', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({
      productType: 'limited_edition',
      approvalStatus: 'pending',
      createdFrom: '2026-01-01',
      createdTo: '2026-01-31',
      sort: 'name',
      order: 'asc',
      deleted: true,
      ids: ['id-1', 'id-2'],
    } as any);

    expect(productMastersService.getMasters).toHaveBeenCalledWith(
      expect.objectContaining({
        productType: 'limited_edition',
        approvalStatus: 'pending',
        createdFrom: '2026-01-01',
        createdTo: '2026-01-31',
        sort: 'name',
        order: 'asc',
        deleted: true,
        ids: ['id-1', 'id-2'],
      }),
    );
  });

  it('falls back to the name alias when q is absent', async () => {
    const { controller, productMastersService } = makeController();
    await controller.getMasters({ name: '토너' } as any);
    expect(productMastersService.getMasters).toHaveBeenCalledWith(expect.objectContaining({ name: '토너' }));
  });
});
