import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { CORE_LOOKUP_BATCH, CoreSalesOrderLookupClient } from './core-sales-order-lookup.client';

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('CoreSalesOrderLookupClient', () => {
  it('200건씩 나눠 묻고 결과를 externalOrderId 로 모은다', async () => {
    // 세 번째 인자(요청 설정)까지 선언해야 mock.calls[0][2] 가 타입 검사를 지난다
    const post = jest.fn((_url: string, body: { orders: { externalOrderId: string }[] }, _config?: unknown) =>
      of({
        data: {
          orders: body.orders.map((order) => ({
            externalOrderId: order.externalOrderId,
            salesOrder: null,
            openEventFailure: false,
          })),
        },
      }),
    );
    const client = new CoreSalesOrderLookupClient(
      { post } as unknown as HttpService,
      config({ CORE_INTERNAL_KEY: 'k', PIM_API_URL: 'http://core' }),
    );
    const orders = Array.from({ length: CORE_LOOKUP_BATCH + 1 }, (_, i) => ({ externalOrderId: `o${i}` }));

    const result = await client.lookup('medusa', orders);

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toBe('http://core/internal/sales-orders/lookup');
    expect(post.mock.calls[0][2]).toMatchObject({ headers: { Authorization: 'Bearer k' } });
    expect(result.size).toBe(CORE_LOOKUP_BATCH + 1);
  });

  it('빈 목록이면 부르지 않는다', async () => {
    const post = jest.fn();
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [])).resolves.toEqual(new Map());
    expect(post).not.toHaveBeenCalled();
  });

  it('키가 없으면 던진다', async () => {
    const client = new CoreSalesOrderLookupClient({ post: jest.fn() } as unknown as HttpService, config({}));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('CORE_INTERNAL_KEY');
  });

  it('HTTP 오류는 던진다', async () => {
    const post = jest.fn(() => throwError(() => new Error('502')));
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('502');
  });

  it('응답에 물은 주문이 빠져 있으면 던진다', async () => {
    const post = jest.fn(() => of({ data: { orders: [] } }));
    const client = new CoreSalesOrderLookupClient({ post } as unknown as HttpService, config({ CORE_INTERNAL_KEY: 'k' }));
    await expect(client.lookup('medusa', [{ externalOrderId: 'a' }])).rejects.toThrow('a');
  });
});
