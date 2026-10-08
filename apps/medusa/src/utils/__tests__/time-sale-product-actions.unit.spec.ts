import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { productActionState, syncTimeSaleProductActions } from '../time-sale-product-actions';
import { listAllTimeSales } from '../time-sale';
import { loadTimeSaleSettings } from '../time-sale-settings';

jest.mock('../time-sale', () => ({ listAllTimeSales: jest.fn() }));

jest.mock('../time-sale-settings', () => ({
  loadTimeSaleSettings: jest.fn(),
  clearTimeSaleProductCache: jest.fn(),
  revalidateTimeSaleCache: jest.fn(),
  TIME_SALE_WRITE_LOCK: 'time-sale-write',
  TIME_SALE_WRITE_LOCK_TTL: 120,
}));

it('체크가 없으면 상태를 변경하지 않고, 연관 상품은 실행 때 끄고 중지 때 켠다', () => {
  expect(productActionState({}, true)).toEqual({ display: undefined, selling: undefined });

  const related = { productId: 'C', displayOffStart: true, displayOnStop: true };

  expect(productActionState(related, true).display).toBe(false);
  expect(productActionState(related, false).display).toBe(true);
});

it('시작·종료 시 실제 상품 메타데이터를 갱신하고 설정 제거 시 제어 값을 정리한다', async () => {
  const sale = {
    saleId: 'sale',
    status: 'active',
    productIds: ['A'],
    products: [],
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 60000).toISOString(),
  };
  const settings = {
    environment: { enabled: true },
    sales: {
      sale: {
        productActions: {
          A: {
            displayOnStart: true,
            displayOffStop: true,
            sellingOnStart: true,
            sellingOffStop: true,
            related: [{ productId: 'C', displayOffStart: true, displayOnStop: true }],
          },
        },
      },
    },
  };
  const products: { id: string; metadata: Record<string, unknown> }[] = [
    { id: 'A', metadata: {} },
    { id: 'C', metadata: {} },
  ];

  jest.mocked(listAllTimeSales).mockResolvedValue([sale] as never);
  jest.mocked(loadTimeSaleSettings).mockResolvedValue({ settings } as never);

  const services = {
    [Modules.LOCKING]: { acquire: jest.fn(), release: jest.fn() },
    [ContainerRegistrationKeys.PG_CONNECTION]: {
      raw: jest.fn(async () => ({ rows: products.filter((product) => product.metadata.timeSaleControlled) })),
    },
    [Modules.PRODUCT]: {
      listProducts: jest.fn(async () => products),
      updateProducts: jest.fn(async (id: string, update: { metadata: Record<string, unknown> }) => {
        Object.assign(products.find((product) => product.id === id)!, update);
      }),
    },
  };
  const container = { resolve: (key: string) => services[key] } as unknown as MedusaContainer;

  await syncTimeSaleProductActions(container);

  expect(products[0].metadata).toMatchObject({ timeSaleDisplay: true, timeSaleSelling: true });
  expect(products[1].metadata.timeSaleDisplay).toBe(false);

  sale.endsAt = new Date(Date.now() - 1).toISOString();
  await syncTimeSaleProductActions(container);

  expect(products[0].metadata).toMatchObject({ timeSaleDisplay: false, timeSaleSelling: false });
  expect(products[1].metadata.timeSaleDisplay).toBe(true);

  settings.sales.sale.productActions = {} as typeof settings.sales.sale.productActions;
  await syncTimeSaleProductActions(container);

  expect(products[0].metadata.timeSaleControlled).toBeUndefined();
  expect(products[1].metadata.timeSaleDisplay).toBeUndefined();
});
