import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { DemoCatalogClient } from './demo-catalog.client';

describe('DemoCatalogClient', () => {
  it('loads trusted catalog rows from PIM_API_URL and forwards the requesting admin bearer token', async () => {
    const get = jest.fn(() =>
      of({
        data: {
          data: {
            items: [
              {
                variantId: '11111111-1111-4111-8111-111111111111',
                masterId: '22222222-2222-4222-8222-222222222222',
                versionId: '33333333-3333-4333-8333-333333333333',
                skuId: '44444444-4444-4444-8444-444444444444',
                sku: 'SKU-1',
                productName: '상품 1',
                unitPrice: 12000,
                availableQuantity: 8,
                components: [{ skuId: '44444444-4444-4444-8444-444444444444', quantity: 1, availableQuantity: 8 }],
              },
            ],
            total: 1,
            page: 1,
            limit: 100,
          },
        },
      }),
    );
    const client = new DemoCatalogClient(
      { get } as unknown as HttpService,
      { get: () => 'https://core.demo.example/base/' } as unknown as ConfigService,
    );

    const result = await client.list({ variantIds: ['11111111-1111-4111-8111-111111111111'] }, 'Bearer admin-token');

    expect(result.map((item) => item.sku)).toEqual(['SKU-1']);
    expect(get).toHaveBeenCalledWith('https://core.demo.example/base/demo/catalog', {
      params: {
        page: 1,
        limit: 100,
        variantIds: '11111111-1111-4111-8111-111111111111',
      },
      headers: { Authorization: 'Bearer admin-token' },
      timeout: 5000,
    });
  });

  it('rejects malformed catalog responses instead of persisting untrusted partial snapshots', async () => {
    const client = new DemoCatalogClient(
      { get: () => of({ data: { items: [{ variantId: 'bad' }] } }) } as unknown as HttpService,
      { get: () => 'https://core.demo.example' } as unknown as ConfigService,
    );

    await expect(client.list({}, 'Bearer token')).rejects.toThrow('Invalid demo catalog response');
  });

  it('fails closed when the trusted PIM_API_URL origin is missing', () => {
    expect(
      () =>
        new DemoCatalogClient(
          { get: jest.fn() } as unknown as HttpService,
          { get: () => undefined } as unknown as ConfigService,
        ),
    ).toThrow('PIM_API_URL is required for demo catalog access');
  });
});
