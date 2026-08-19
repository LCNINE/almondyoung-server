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
      status: undefined,
      productType: undefined,
      createdFrom: undefined,
      createdTo: undefined,
      sort: undefined,
      order: undefined,
      stock: undefined,
      deleted: false,
      ids: undefined,
    });
    // jest.fn() 의 mock.calls 는 any 라 인덱싱이 unsafe 로 잡힌다. 이 단언은 키 부재를
    // 확인하는 게 목적이라 값 타입이 필요 없다.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(productMastersService.getMasters.mock.calls[0][0]).not.toHaveProperty('approvalStatus');
  });

  it('forwards the new filter and sort fields to the service', async () => {
    const { controller, productMastersService } = makeController();

    await controller.getMasters({
      productType: 'limited_edition',
      status: 'inactive',
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
        mode: 'active-or-inactive',
        status: 'inactive',
        createdFrom: '2026-01-01',
        createdTo: '2026-01-31',
        sort: 'name',
        order: 'asc',
        deleted: true,
        ids: ['id-1', 'id-2'],
      }),
    );
    // jest.fn() 의 mock.calls 는 any 라 인덱싱이 unsafe 로 잡힌다. 이 단언은 키 부재를
    // 확인하는 게 목적이라 값 타입이 필요 없다.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(productMastersService.getMasters.mock.calls[0][0]).not.toHaveProperty('approvalStatus');
  });

  it('falls back to the name alias when q is absent', async () => {
    const { controller, productMastersService } = makeController();
    await controller.getMasters({ name: '토너' } as any);
    expect(productMastersService.getMasters).toHaveBeenCalledWith(expect.objectContaining({ name: '토너' }));
  });

  it('widens mode automatically for draft status filtering', async () => {
    const { controller, productMastersService } = makeController();
    await controller.getMasters({ status: 'draft' } as any);
    expect(productMastersService.getMasters).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'all', status: 'draft' }),
    );
  });
});
