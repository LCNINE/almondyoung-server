jest.mock('../../adapters/medusa/medusa.client', () => ({
  MedusaClient: class MedusaClient {},
}));

import { MedusaOrderProvider } from './medusa-order.provider';
import { CHANNEL_PRODUCT_IDENTIFICATION_FAILED } from './channel-order-provider.interface';
import { ORDER_STREAM } from '@packages/event-contracts/streams';

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

  it('수집 시 라인의 fulfillmentKind/requiresShipping 을 보존한다 (디지털 라인은 requiresShipping=false)', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_mixed_1',
          payment_status: 'authorized',
          customer_id: 'cus_1',
          currency_code: 'KRW',
          total: 10000,
          subtotal: 10000,
          shipping_total: 0,
          discount_total: 0,
          created_at: '2026-06-24T01:00:00.000Z',
          updated_at: '2026-06-24T01:05:00.000Z',
          items: [
            {
              id: 'item_phys',
              title: 'Physical',
              quantity: 1,
              unit_price: 10000,
              variant_id: 'v_phys',
              variant: {
                metadata: { pimVariantId: 'pv_phys' },
                product: { metadata: { pimMasterId: 'm1', pimVersionId: 'ver1' } },
              },
            },
            {
              id: 'item_dig',
              title: 'E-book',
              quantity: 1,
              unit_price: 0,
              variant_id: 'v_dig',
              requires_shipping: false,
              variant: {
                metadata: { pimVariantId: 'pv_dig' },
                product: {
                  metadata: { pimMasterId: 'm2', pimVersionId: 'ver2', fulfillmentKind: 'digital', requiresShipping: false },
                },
              },
            },
          ],
          shipping_address: { first_name: 'Jane', last_name: 'Kim', phone: '010', postal_code: '12345', address_1: 'Seoul', address_2: '' },
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);
    const items = result.orders[0].createPayload.items;
    const phys = items.find((i) => i.orderItemId === 'item_phys');
    const dig = items.find((i) => i.orderItemId === 'item_dig');

    expect(phys).toMatchObject({ fulfillmentKind: 'physical', requiresShipping: true });
    expect(dig).toMatchObject({ fulfillmentKind: 'digital', requiresShipping: false });
  });

  it('line item requires_shipping 이 있으면 product metadata 보다 fulfillmentKind 판별에 우선한다', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_physical_snapshot_1',
          payment_status: 'authorized',
          customer_id: 'cus_1',
          currency_code: 'KRW',
          total: 10000,
          subtotal: 10000,
          shipping_total: 0,
          discount_total: 0,
          created_at: '2026-06-24T01:00:00.000Z',
          updated_at: '2026-06-24T01:05:00.000Z',
          items: [
            {
              id: 'item_phys_snapshot',
              title: 'Physical item before product edit',
              quantity: 1,
              unit_price: 10000,
              variant_id: 'v_phys_snapshot',
              requires_shipping: true,
              variant: {
                metadata: { pimVariantId: 'pv_phys_snapshot' },
                product: {
                  metadata: {
                    pimMasterId: 'm1',
                    pimVersionId: 'ver1',
                    fulfillmentKind: 'digital',
                    requiresShipping: false,
                  },
                },
              },
            },
          ],
          shipping_address: {
            first_name: 'Jane',
            last_name: 'Kim',
            phone: '010',
            postal_code: '12345',
            address_1: 'Seoul',
            address_2: '',
          },
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);
    const item = result.orders[0].createPayload.items[0];

    expect(item).toMatchObject({ fulfillmentKind: 'physical', requiresShipping: true });
  });

  // 무통장입금 선생성 주문은 입금 확인(capture) 전까지 WMS 출고 수집에서 제외
  const bankTransferOrder = (overrides: Record<string, unknown>) => ({
    id: 'order_bt_1',
    customer_id: 'cus_1',
    currency_code: 'KRW',
    total: 10000,
    subtotal: 10000,
    shipping_total: 0,
    discount_total: 0,
    created_at: '2026-06-23T01:00:00.000Z',
    updated_at: '2026-06-23T01:05:00.000Z',
    items: [
      {
        id: 'item_1',
        title: 'Product',
        quantity: 1,
        unit_price: 10000,
        variant_id: 'variant_1',
        variant: {
          metadata: { pimVariantId: 'pim_variant_1' },
          product: { metadata: { pimMasterId: 'master_1', pimVersionId: 'version_1' } },
        },
      },
    ],
    shipping_address: { first_name: 'Jane', last_name: 'Kim', phone: '010-0000-0000', postal_code: '12345', address_1: 'Seoul', address_2: '' },
    ...overrides,
  });

  it('무통장 입금대기(awaiting_deposit + authorized) 주문은 수집(OrderCreated)에서 제외한다', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        bankTransferOrder({ payment_status: 'authorized', metadata: { bank_transfer_status: 'awaiting_deposit' } }),
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders).toHaveLength(0);
    expect(result.failures).toHaveLength(0);
    expect(result.lifecycleEvents ?? []).toHaveLength(0);
  });

  it('입금 확인 후(captured)에는 awaiting_deposit metadata 가 남아있어도 수집한다', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        // confirmed metadata 갱신이 실패해 awaiting_deposit 가 남았더라도, captured 면 수집
        bankTransferOrder({ payment_status: 'captured', metadata: { bank_transfer_status: 'awaiting_deposit' } }),
      ]),
    } as any);

    const result = await provider.fetchOrders(null);

    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].externalOrderId).toBe('order_bt_1');
  });

  it('builds an OrderCreated payload that passes stream validation when optional address details are blank', async () => {
    const provider = new MedusaOrderProvider({
      listOrders: jest.fn().mockResolvedValue([
        {
          id: 'order_blank_address_1',
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
                metadata: { pimVariantId: '11111111-1111-4111-8111-111111111111' },
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
            address_2: '',
          },
        },
      ]),
    } as any);

    const result = await provider.fetchOrders(null);
    const payload = result.orders[0].createPayload;
    const schema = ORDER_STREAM.events.OrderCreated.schema;

    expect(schema?.safeParse(payload).success).toBe(true);
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

  it('quarantines a Medusa order when line item PIM master or version metadata is missing', async () => {
    const rawOrder = {
      id: 'order_missing_product_identity_1',
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
          id: 'item_missing_master',
          title: 'Missing Master Product',
          quantity: 1,
          unit_price: 5000,
          variant_id: 'variant_missing_master',
          variant: {
            metadata: { pimVariantId: 'pim_variant_1' },
            product: { metadata: { pimVersionId: 'version_1' } },
          },
        },
        {
          id: 'item_missing_version',
          title: 'Missing Version Product',
          quantity: 1,
          unit_price: 5000,
          variant_id: 'variant_missing_version',
          variant: {
            metadata: { pimVariantId: 'pim_variant_2' },
            product: { metadata: { pimMasterId: 'master_2' } },
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
      externalOrderId: 'order_missing_product_identity_1',
      sourceUpdatedAt: '2026-05-26T01:05:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['item_missing_master', 'item_missing_version'],
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
