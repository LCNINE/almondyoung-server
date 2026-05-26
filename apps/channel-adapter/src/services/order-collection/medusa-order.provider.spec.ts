jest.mock('../../adapters/medusa/medusa.client', () => ({
  MedusaClient: class MedusaClient {},
}));

import { MedusaOrderProvider } from './medusa-order.provider';

describe('MedusaOrderProvider', () => {
  it('builds a Payment Accepted order candidate from an authorized Medusa order', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_auth_1',
          customer_id: 'cus_1',
          currency_code: 'KRW',
          total: 12000,
          subtotal: 10000,
          shipping_total: 2000,
          discount_total: 0,
          created_at: '2026-05-26T01:00:00.000Z',
          updated_at: '2026-05-26T01:05:00.000Z',
          items: [
            {
              id: 'item_1',
              title: 'Product',
              quantity: 2,
              unit_price: 5000,
              variant_id: 'variant_1',
              variant: {
                metadata: { pimVariantId: 'pim_variant_1' },
                product: { metadata: { pimMasterId: 'master_1', pimVersionId: 'version_1' } },
              },
            },
          ],
          shipping_address: {
            first_name: 'Jane',
            last_name: 'Kim',
            phone: '010-0000-0000',
            postal_code: '12345',
            address_1: 'Seoul',
            address_2: '101',
          },
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.skipped).toBe(0);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      externalOrderId: 'order_auth_1',
      sourceUpdatedAt: '2026-05-26T01:05:00.000Z',
      createPayload: {
        externalOrderId: 'order_auth_1',
        salesChannel: 'medusa',
        status: 'confirmed',
        totalAmount: 12000,
      },
    });
  });
});
