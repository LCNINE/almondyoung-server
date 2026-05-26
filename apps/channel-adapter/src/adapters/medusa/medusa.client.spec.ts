jest.mock('@medusajs/js-sdk', () => function Medusa() {});
jest.mock('./medusa-sdk.config', () => ({
  createMedusaSdk: jest.fn(),
}));

import { MedusaClient } from './medusa.client';

describe('MedusaClient.listOrders', () => {
  it('filters Payment Accepted orders client-side without unsupported payment_status query filters', async () => {
    const authorizedOrder = {
      id: 'order_authorized',
      payment_status: 'authorized',
      payment_collections: [{ payments: [{ id: 'pay_authorized', captures: [] }] }],
    };
    const capturedOrder = {
      id: 'order_captured',
      payment_status: 'captured',
      payment_collections: [{ payments: [{ id: 'pay_captured', captures: [{ id: 'cap_1' }] }] }],
    };
    const unpaidOrder = {
      id: 'order_unpaid',
      payment_status: 'not_paid',
      payment_collections: [{ payments: [] }],
    };
    const refundedOrderWithPayment = {
      id: 'order_refunded',
      payment_status: 'refunded',
      payment_collections: [{ payments: [{ id: 'pay_refunded', captures: [{ id: 'cap_refunded' }] }] }],
    };
    const fetch = jest
      .fn()
      .mockResolvedValue({ orders: [authorizedOrder, capturedOrder, unpaidOrder, refundedOrderWithPayment], count: 4 });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };

    const orders = await client.listOrders({ since: new Date('2026-05-26T00:00:00.000Z') });

    expect(orders).toEqual([authorizedOrder, capturedOrder]);

    expect(fetch).toHaveBeenCalledWith(
      '/admin/orders',
      expect.objectContaining({
        method: 'GET',
        query: expect.objectContaining({
          updated_at: { gt: '2026-05-26T00:00:00.000Z' },
        }),
      }),
    );
    const query = fetch.mock.calls[0][1].query;
    expect(query.fields).toContain('payment_status');
    expect(query.fields).toContain('payment_collections.payments.captures.id');
    expect(query).not.toHaveProperty('payment_status');
  });
});
