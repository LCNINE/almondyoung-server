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

  it('maps q query parameter to the product name search filter', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({
      page: '2',
      limit: '20',
      q: '립스틱',
    } as any);

    expect(productMastersService.getMasters).toHaveBeenCalledWith({
      page: 2,
      limit: 20,
      categoryId: undefined,
      brand: undefined,
      name: '립스틱',
      mode: undefined,
      deleted: false,
      ids: undefined,
    });
  });
});
