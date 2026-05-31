jest.mock('../../adapters/medusa/medusa.client', () => ({
  MedusaClient: class MedusaClient {},
}));

import { MedusaOrderProvider } from './medusa-order.provider';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';

describe('MedusaOrderProvider', () => {
  it('builds a Payment Accepted order candidate from an authorized Medusa order', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_auth_1',
          payment_status: 'authorized',
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

    expect(result.failures).toHaveLength(0);
    expect(result.lifecycleEvents ?? []).toHaveLength(0);
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

  it('quarantines a mixed valid/invalid Medusa order when any line item lacks pimVariantId', async () => {
    const rawOrder = {
      id: 'order_mixed_1',
      payment_status: 'authorized',
      customer_id: 'cus_1',
      currency_code: 'KRW',
      total: 17000,
      subtotal: 15000,
      shipping_total: 2000,
      discount_total: 0,
      created_at: '2026-05-26T01:00:00.000Z',
      updated_at: '2026-05-26T01:05:00.000Z',
      items: [
        {
          id: 'item_valid',
          title: 'Valid Product',
          quantity: 1,
          unit_price: 5000,
          variant_id: 'variant_valid',
          variant: {
            metadata: { pimVariantId: 'pim_variant_1' },
            product: { metadata: { pimMasterId: 'master_1', pimVersionId: 'version_1' } },
          },
        },
        {
          id: 'item_missing',
          title: 'Unidentified Product',
          quantity: 1,
          unit_price: 10000,
          variant_id: 'variant_missing',
          variant: {
            metadata: {},
            product: { metadata: {} },
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
    };
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([rawOrder]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      externalOrderId: 'order_mixed_1',
      sourceUpdatedAt: '2026-05-26T01:05:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['item_missing'],
      rawOrder,
    });
  });

  it('extracts cancellation and refund lifecycle events without requiring an order candidate', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_lifecycle_1',
          status: 'canceled',
          payment_status: 'refunded',
          currency_code: 'KRW',
          total: 12000,
          created_at: '2026-05-26T01:00:00.000Z',
          updated_at: '2026-05-26T01:20:00.000Z',
          canceled_at: '2026-05-26T01:15:00.000Z',
          transactions: [
            {
              id: 'txn_refund_1',
              reference: 'refund',
              reference_id: 'ref_1',
              amount: -12000,
              currency_code: 'KRW',
              created_at: '2026-05-26T01:18:00.000Z',
            },
          ],
          items: [],
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      externalOrderId: 'order_lifecycle_1',
      eligibleForOrderCreation: false,
      changes: {
        items: [],
        totalAmount: 12000,
      },
    });
    expect(result.failures).toHaveLength(0);
    expect(result.lifecycleEvents ?? []).toEqual([
      expect.objectContaining({
        externalOrderId: 'order_lifecycle_1',
        eventType: 'OrderCancelled',
        eventKey: 'cancelled',
        payload: expect.objectContaining({
          cancelledAt: '2026-05-26T01:15:00.000Z',
          refundRequired: false,
        }),
      }),
      expect.objectContaining({
        externalOrderId: 'order_lifecycle_1',
        eventType: 'OrderRefundCreated',
        eventKey: 'refund:ref_1',
        payload: expect.objectContaining({
          refundId: 'ref_1',
          amount: 12000,
          createdAt: '2026-05-26T01:18:00.000Z',
        }),
      }),
    ]);
    expect((result.lifecycleEvents ?? [])[0].payload).not.toHaveProperty('refundAmount');
    expect((result.lifecycleEvents ?? [])[0].rawEvent).not.toHaveProperty('refundedAmount');
  });

  it('marks a canceled order ineligible for creation even when payment is still captured', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_canceled_captured',
          status: 'canceled',
          payment_status: 'captured',
          currency_code: 'KRW',
          total: 12000,
          created_at: '2026-05-26T01:00:00.000Z',
          updated_at: '2026-05-26T01:20:00.000Z',
          canceled_at: '2026-05-26T01:15:00.000Z',
          items: [
            {
              id: 'item_1',
              variant: { metadata: { pimVariantId: 'pim_variant_1' } },
            },
          ],
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    // A canceled snapshot whose payment is still captured must NOT seed a new Core order; it is
    // observed only for the cancellation lifecycle handoff.
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      externalOrderId: 'order_canceled_captured',
      eligibleForOrderCreation: false,
    });
    expect(result.failures).toHaveLength(0);
    expect(result.lifecycleEvents ?? []).toEqual([
      expect.objectContaining({
        externalOrderId: 'order_canceled_captured',
        eventType: 'OrderCancelled',
        eventKey: 'cancelled',
        payload: expect.objectContaining({ cancelledAt: '2026-05-26T01:15:00.000Z' }),
      }),
    ]);
  });

  it('keeps cancellation observations stable when refund rows appear later', async () => {
    const withoutRefund = {
      id: 'order_cancelled_1',
      status: 'canceled',
      payment_status: 'canceled',
      currency_code: 'KRW',
      total: 12000,
      created_at: '2026-05-26T01:00:00.000Z',
      updated_at: '2026-05-26T01:20:00.000Z',
      canceled_at: '2026-05-26T01:15:00.000Z',
      transactions: [],
      items: [],
    };
    const withRefund = {
      ...withoutRefund,
      payment_status: 'refunded',
      transactions: [
        {
          id: 'txn_refund_1',
          reference: 'refund',
          reference_id: 'ref_1',
          amount: -12000,
          currency_code: 'KRW',
          created_at: '2026-05-26T01:18:00.000Z',
        },
      ],
    };
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValueOnce([withoutRefund]).mockResolvedValueOnce([withRefund]),
    } as any);

    const first = await provider.fetchOrders(null);
    const second = await provider.fetchOrders(null);
    const firstCancellation = (first.lifecycleEvents ?? []).find((event) => event.eventType === 'OrderCancelled');
    const secondCancellation = (second.lifecycleEvents ?? []).find((event) => event.eventType === 'OrderCancelled');

    expect(second.lifecycleEvents ?? []).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'OrderRefundCreated',
          eventKey: 'refund:ref_1',
        }),
      ]),
    );
    expect(secondCancellation).toBeDefined();
    expect(firstCancellation).toMatchObject({
      eventKey: secondCancellation?.eventKey,
      payload: secondCancellation?.payload,
      rawEvent: secondCancellation?.rawEvent,
    });
  });

  it('keeps refunded snapshots as ineligible order candidates without synthesizing refund events', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_refunded_without_rows',
          payment_status: 'refunded',
          currency_code: 'KRW',
          total: 12000,
          created_at: '2026-05-26T01:00:00.000Z',
          updated_at: '2026-05-26T01:20:00.000Z',
          summary: { refunded_total: 0 },
          payment_collections: [{ payments: [{ id: 'pay_1', refunds: [] }] }],
          transactions: [],
          items: [],
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({
      externalOrderId: 'order_refunded_without_rows',
      sourceUpdatedAt: '2026-05-26T01:20:00.000Z',
      eligibleForOrderCreation: false,
      changes: {
        items: [],
        totalAmount: 12000,
      },
    });
    expect(result.failures).toHaveLength(0);
    expect(result.lifecycleEvents ?? []).toHaveLength(0);
  });
});
