jest.mock('@/const', () => ({ ALMONDYOUNG_API_BASE_URL: '/core' }), {
  virtual: true,
});

jest.mock('../../client', () => ({
  client: { get: jest.fn() },
}));

import { client } from '../../client';
import { salesOrders } from './sales-orders.client';

const get = jest.mocked(client.get);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { data: [], total: 0 } });
});

it('여러 판매처를 단일 쉼표 구분 파라미터로 직렬화한다', async () => {
  await salesOrders.getSalesOrders({
    channels: ['naver', 'coupang'],
    limit: 50,
  });

  expect(get).toHaveBeenCalledWith(
    '/core/sales-orders?channels=naver%2Ccoupang&limit=50'
  );
});

it.each([undefined, []])(
  '판매처가 %j 이면 파라미터를 생략한다',
  async (channels) => {
    await salesOrders.getSalesOrders({ channels, limit: 50 });

    expect(get).toHaveBeenCalledWith('/core/sales-orders?limit=50');
  }
);
