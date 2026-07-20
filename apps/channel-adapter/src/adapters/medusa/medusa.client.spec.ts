jest.mock('@medusajs/js-sdk', () => function Medusa() {});
jest.mock('./medusa-sdk.config', () => ({
  createMedusaSdk: jest.fn(),
}));

import { MedusaClient } from './medusa.client';

function makeShippingProjectionClient(initialMetadata: Record<string, unknown>) {
  let postedMetadata: Record<string, unknown> | undefined;
  const fetch = jest.fn((_path: string, options: { method: string; body?: { metadata: Record<string, unknown> } }) => {
    if (options.method === 'GET') return Promise.resolve({ order: { metadata: initialMetadata } });
    if (!options.body) throw new Error('POST metadata body is required');

    postedMetadata = options.body.metadata;
    return Promise.resolve({ order: { metadata: postedMetadata } });
  });
  const client = Object.create(MedusaClient.prototype) as MedusaClient;
  Object.defineProperties(client, {
    sdk: { value: { client: { fetch } } },
    logger: { value: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
  });
  return { client, fetch, postedMetadata: () => postedMetadata };
}

function makeV2Dispatch(attemptNo: number, isPartial: boolean) {
  const order = {
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    fulfillmentOrderId: '22222222-2222-4222-8222-222222222222',
    salesChannel: 'medusa' as const,
    channelOrderId: 'order_medusa_projection',
    isPartial,
    lines: [
      {
        shipmentLineId: '33333333-3333-4333-8333-333333333333',
        fulfillmentOrderItemId: '44444444-4444-4444-8444-444444444444',
        salesOrderLineId: '55555555-5555-4555-8555-555555555555',
        channelOrderItemId: 'item-1',
        skuId: '66666666-6666-4666-8666-666666666666',
        qty: 1,
        isPartialQuantity: false,
      },
    ],
  };
  const payload = {
    shipmentId: '77777777-7777-4777-8777-777777777777',
    dispatchAttemptId:
      attemptNo === 1 ? '88888888-8888-4888-8888-888888888888' : '99999999-9999-4999-8999-999999999999',
    attemptNo,
    warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    dispatchedAt: `2026-07-15T0${attemptNo}:00:00.000Z`,
    invoice: {
      invoiceId: attemptNo === 1 ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      carrier: 'HANJIN' as const,
      trackingNo: `TRACK-${attemptNo}`,
    },
    orders: [order],
  };
  return { order, payload };
}

describe('MedusaClient V1 shipping projection precedence', () => {
  it('keeps an existing V1 delivered state when a late V2 dispatch performs metadata GET then POST', async () => {
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({
      coreShippingStatus: 'delivered',
      coreFulfillmentId: 'fo-v1',
      coreDeliveredAt: '2026-07-15T00:30:00.000Z',
    });
    const dispatch = makeV2Dispatch(1, false);

    await client.updateOrderShipmentAttemptProjection('order_medusa_projection', {
      operation: 'dispatch',
      payload: dispatch.payload,
      order: dispatch.order,
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_projection', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_projection',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual(
      expect.objectContaining({
        coreShippingStatus: 'delivered',
        coreShipmentAttempts: [expect.objectContaining({ dispatchAttemptId: dispatch.payload.dispatchAttemptId })],
      }),
    );
  });

  it('advances an all-recalled V2 history when a new higher attempt is dispatched', async () => {
    const recalledAttempt = {
      shipmentId: '77777777-7777-4777-8777-777777777777',
      dispatchAttemptId: '88888888-8888-4888-8888-888888888888',
      attemptNo: 1,
      status: 'recalled',
      isPartial: false,
    };
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({
      coreShippingStatus: 'recalled',
      coreShipmentAttempts: [recalledAttempt],
      coreShipments: [
        {
          shipmentId: recalledAttempt.shipmentId,
          attemptIds: [recalledAttempt.dispatchAttemptId],
          latestAttemptId: recalledAttempt.dispatchAttemptId,
          status: 'recalled',
        },
      ],
    });
    const redispatch = makeV2Dispatch(2, false);

    await client.updateOrderShipmentAttemptProjection('order_medusa_projection', {
      operation: 'dispatch',
      payload: redispatch.payload,
      order: redispatch.order,
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_projection', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_projection',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual(
      expect.objectContaining({
        coreShippingStatus: 'shipped',
        coreShipmentAttempts: [
          recalledAttempt,
          expect.objectContaining({
            dispatchAttemptId: redispatch.payload.dispatchAttemptId,
            attemptNo: 2,
            status: 'shipped',
          }),
        ],
      }),
    );
  });

  it('promotes a partial V2 shipped projection when V1 full-completion delivered arrives', async () => {
    const partialAttempt = {
      shipmentId: '77777777-7777-4777-8777-777777777777',
      dispatchAttemptId: '88888888-8888-4888-8888-888888888888',
      attemptNo: 1,
      status: 'shipped',
      isPartial: true,
    };
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({
      coreShippingStatus: 'partially_shipped',
      coreShipmentAttempts: [partialAttempt],
    });

    await client.updateOrderShippingProjection('order_medusa_projection', {
      status: 'delivered',
      fulfillmentId: 'fo-v1',
      deliveredAt: '2026-07-15T03:00:00.000Z',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_projection', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_projection',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual(
      expect.objectContaining({
        coreShippingStatus: 'delivered',
        coreShipmentAttempts: [partialAttempt],
        coreDeliveredAt: '2026-07-15T03:00:00.000Z',
      }),
    );
  });

  it('keeps recalled V2 state when a late V1 shipped event performs metadata GET then POST', async () => {
    const attempts = [
      {
        shipmentId: 'shipment-1',
        dispatchAttemptId: 'attempt-1',
        attemptNo: 1,
        status: 'recalled',
        isPartial: false,
      },
    ];
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({
      storefrontValue: 'keep-me',
      coreShippingStatus: 'recalled',
      coreShipmentAttempts: attempts,
    });

    await client.updateOrderShippingProjection('order_medusa_recalled', {
      status: 'shipped',
      fulfillmentId: 'fo-1',
      carrier: 'HANJIN',
      trackingNumber: 'TRACK-1',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_recalled', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_recalled',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual(
      expect.objectContaining({
        storefrontValue: 'keep-me',
        coreShippingStatus: 'recalled',
        coreShipmentAttempts: attempts,
        coreFulfillmentId: 'fo-1',
        coreTrackingNumber: 'TRACK-1',
      }),
    );
  });

  it('keeps delivered V2 state when a late V1 shipped event performs metadata GET then POST', async () => {
    const attempts = [
      {
        shipmentId: 'shipment-1',
        dispatchAttemptId: 'attempt-1',
        attemptNo: 1,
        status: 'delivered',
        isPartial: false,
      },
    ];
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({
      coreShippingStatus: 'delivered',
      coreShipmentAttempts: attempts,
      coreDeliveredAt: '2026-07-15T03:00:00.000Z',
    });

    await client.updateOrderShippingProjection('order_medusa_delivered', {
      status: 'shipped',
      fulfillmentId: 'fo-1',
      shippedAt: '2026-07-15T01:00:00.000Z',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_delivered', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_delivered',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual(
      expect.objectContaining({
        coreShippingStatus: 'delivered',
        coreShipmentAttempts: attempts,
        coreDeliveredAt: '2026-07-15T03:00:00.000Z',
      }),
    );
  });

  it('also preserves a more advanced existing top-level state while V2 delivery projection is still lagging', async () => {
    const { client, postedMetadata } = makeShippingProjectionClient({
      coreShippingStatus: 'delivered',
      coreShipmentAttempts: [
        {
          shipmentId: 'shipment-1',
          dispatchAttemptId: 'attempt-1',
          attemptNo: 1,
          status: 'shipped',
          isPartial: false,
        },
      ],
    });

    await client.updateOrderShippingProjection('order_medusa_lagging_v2', {
      status: 'shipped',
      fulfillmentId: 'fo-1',
    });

    expect(postedMetadata()).toEqual(expect.objectContaining({ coreShippingStatus: 'delivered' }));
  });

  it('keeps the existing V1-only projection behavior when no V2 attempt history exists', async () => {
    const { client, fetch, postedMetadata } = makeShippingProjectionClient({ storefrontValue: 'keep-me' });

    await client.updateOrderShippingProjection('order_medusa_v1_only', {
      status: 'shipped',
      fulfillmentId: 'fo-v1',
      shippedAt: '2026-07-15T01:00:00.000Z',
    });

    expect(fetch).toHaveBeenNthCalledWith(1, '/admin/orders/order_medusa_v1_only', { method: 'GET' });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/admin/orders/order_medusa_v1_only',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(postedMetadata()).toEqual({
      storefrontValue: 'keep-me',
      coreShippingStatus: 'shipped',
      coreFulfillmentId: 'fo-v1',
      coreShippedAt: '2026-07-15T01:00:00.000Z',
    });
  });
});

describe('MedusaClient shipment attempt projection', () => {
  it('keeps split shipment history as arrays and recalls only the referenced attempt', async () => {
    let metadata: Record<string, unknown> = {};
    const fetch = jest.fn(async (_path: string, options: { method: string; body?: any }) => {
      if (options.method === 'GET') return { order: { metadata } };
      metadata = options.body.metadata;
      return { order: { metadata } };
    });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };

    const order = {
      salesOrderId: 'so-1',
      fulfillmentOrderId: 'fo-1',
      salesChannel: 'medusa' as const,
      channelOrderId: 'order_medusa_1',
      isPartial: true,
      lines: [
        {
          shipmentLineId: 'shipment-line-1',
          fulfillmentOrderItemId: 'foi-1',
          salesOrderLineId: 'sales-order-line-1',
          channelOrderItemId: 'item-1',
          skuId: 'sku-1',
          qty: 1,
          isPartialQuantity: false,
        },
      ],
    };
    const first = {
      shipmentId: 'shipment-1',
      dispatchAttemptId: 'attempt-1',
      attemptNo: 1,
      warehouseId: 'warehouse-1',
      dispatchedAt: '2026-07-14T00:00:00.000Z',
      invoice: { invoiceId: 'invoice-1', carrier: 'HANJIN' as const, trackingNo: 'TRACK-1' },
      orders: [order],
    };
    await client.updateOrderShipmentAttemptProjection('order_medusa_1', {
      operation: 'dispatch',
      payload: first,
      order,
    });

    const completedOrder = { ...order, isPartial: false, lines: [{ ...order.lines[0], shipmentLineId: 'line-2' }] };
    await client.updateOrderShipmentAttemptProjection('order_medusa_1', {
      operation: 'dispatch',
      payload: {
        ...first,
        shipmentId: 'shipment-2',
        dispatchAttemptId: 'attempt-2',
        attemptNo: 2,
        invoice: { ...first.invoice, invoiceId: 'invoice-2', trackingNo: 'TRACK-2' },
        orders: [completedOrder],
      },
      order: completedOrder,
    });

    await client.updateOrderShipmentAttemptProjection('order_medusa_1', {
      operation: 'recall',
      payload: {
        shipmentId: 'shipment-1',
        dispatchAttemptId: 'attempt-1',
        attemptNo: 1,
        recallOperationId: 'recall-1',
        recalledAt: '2026-07-14T01:00:00.000Z',
      },
    });

    await client.updateOrderShipmentAttemptProjection('order_medusa_1', {
      operation: 'delivery',
      payload: {
        shipmentId: 'shipment-1',
        dispatchAttemptId: 'attempt-1',
        attemptNo: 1,
        providerEventId: 'late-delivery-1',
        deliveredAt: '2026-07-14T02:00:00.000Z',
      },
    });

    expect(metadata.coreShippingStatus).toBe('shipped');
    expect(metadata.coreShipments).toHaveLength(2);
    expect(metadata.coreShipmentAttempts).toEqual([
      expect.objectContaining({
        dispatchAttemptId: 'attempt-1',
        status: 'recalled',
        recallOperationId: 'recall-1',
        ignoredDeliveryEvents: [
          expect.objectContaining({
            providerEventId: 'late-delivery-1',
            ignoredReason: 'dispatch_attempt_recalled',
          }),
        ],
      }),
      expect.objectContaining({
        dispatchAttemptId: 'attempt-2',
        status: 'shipped',
        invoice: expect.objectContaining({ invoiceId: 'invoice-2', trackingNo: 'TRACK-2' }),
      }),
    ]);
    expect(metadata.coreShipmentProgress).toEqual({
      attemptCount: 2,
      activeAttemptCount: 1,
      deliveredAttemptCount: 0,
      recalledAttemptCount: 1,
    });
  });

  it('serializes concurrent updates for one order so neither attempt is lost', async () => {
    let metadata: Record<string, unknown> = {};
    const fetch = jest.fn(async (_path: string, options: { method: string; body?: any }) => {
      if (options.method === 'GET') {
        await Promise.resolve();
        return { order: { metadata } };
      }
      metadata = options.body.metadata;
      return { order: { metadata } };
    });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };
    const order = {
      salesOrderId: '55555555-5555-4555-8555-555555555555',
      fulfillmentOrderId: '66666666-6666-4666-8666-666666666666',
      salesChannel: 'medusa' as const,
      channelOrderId: 'order_medusa_1',
      isPartial: true,
      lines: [
        {
          shipmentLineId: '77777777-7777-4777-8777-777777777777',
          fulfillmentOrderItemId: '88888888-8888-4888-8888-888888888888',
          salesOrderLineId: '99999999-9999-4999-8999-999999999999',
          channelOrderItemId: 'item-1',
          skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          isPartialQuantity: false,
        },
      ],
    };
    const event = (suffix: '1' | '2') => ({
      operation: 'dispatch' as const,
      payload: {
        shipmentId: suffix === '1' ? '11111111-1111-4111-8111-111111111111' : '12121212-1212-4212-8212-121212121212',
        dispatchAttemptId:
          suffix === '1' ? '22222222-2222-4222-8222-222222222222' : '13131313-1313-4313-8313-131313131313',
        attemptNo: Number(suffix),
        warehouseId: '33333333-3333-4333-8333-333333333333',
        dispatchedAt: `2026-07-14T00:0${suffix}:00.000Z`,
        invoice: {
          invoiceId: suffix === '1' ? '44444444-4444-4444-8444-444444444444' : '14141414-1414-4414-8414-141414141414',
          carrier: 'HANJIN' as const,
          trackingNo: `TRACK-${suffix}`,
        },
        orders: [order],
      },
      order,
    });

    await Promise.all([
      client.updateOrderShipmentAttemptProjection('order_medusa_1', event('1')),
      client.updateOrderShipmentAttemptProjection('order_medusa_1', event('2')),
    ]);

    expect(metadata.coreShipmentAttempts).toHaveLength(2);
  });

  it('rejects delivery or recall of an attempt that has never been projected', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = {
      client: { fetch: jest.fn().mockResolvedValue({ order: { metadata: {} } }) },
    };

    await expect(
      client.updateOrderShipmentAttemptProjection('order_medusa_1', {
        operation: 'recall',
        payload: {
          shipmentId: '11111111-1111-4111-8111-111111111111',
          dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
          attemptNo: 1,
          recallOperationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          recalledAt: '2026-07-14T01:00:00.000Z',
        },
      }),
    ).rejects.toThrow('unknown dispatch attempt');
  });
});

describe('MedusaClient.listOrders', () => {
  it('keeps Payment Accepted and lifecycle orders client-side without unsupported payment_status query filters', async () => {
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
      payment_collections: [
        {
          payments: [
            {
              id: 'pay_refunded',
              captures: [{ id: 'cap_refunded' }],
              refunds: [{ id: 'ref_1', amount: 5000 }],
            },
          ],
        },
      ],
    };
    const canceledOrder = {
      id: 'order_canceled',
      status: 'canceled',
      payment_status: 'canceled',
    };
    const fetch = jest.fn().mockResolvedValue({
      orders: [authorizedOrder, capturedOrder, unpaidOrder, refundedOrderWithPayment, canceledOrder],
      count: 5,
    });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };

    const orders = await client.listOrders({ since: new Date('2026-05-26T00:00:00.000Z') });

    expect(orders).toEqual([authorizedOrder, capturedOrder, refundedOrderWithPayment, canceledOrder]);

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
    expect(query.fields).toContain('status');
    expect(query.fields).toContain('payment_collections.payments.captures.id');
    expect(query.fields).toContain('transactions.reference_id');
    expect(query).not.toHaveProperty('payment_status');
  });
});

describe('MedusaClient product sellable inventory projection', () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves existing manage_inventory when enriching existing variant ids', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      variants: [
        {
          id: 'variant_medusa_1',
          sku: 'SKU-1',
          manage_inventory: true,
          metadata: { pimVariantId: 'pim-var-1' },
        },
      ],
    });

    const result = await (client as any).enrichPayloadWithExistingVariantIds('prod_1', {
      variants: [
        {
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-1' },
        },
        {
          title: 'Blue',
          sku: 'SKU-2',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-2' },
        },
      ],
    });

    expect(result.variants[0]).toMatchObject({
      id: 'variant_medusa_1',
      manage_inventory: true,
    });
    expect(result.variants[1]).toMatchObject({
      sku: 'SKU-2',
      manage_inventory: false,
    });
    expect(result.variants[1]).not.toHaveProperty('id');
  });

  it('creates variant projection inventory items instead of reusing product SKU inventory identities', async () => {
    const batchVariantInventoryItems = jest.fn().mockResolvedValue({});
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).sdk = {
      admin: {
        inventoryItem: {
          list: jest.fn().mockResolvedValue({ inventory_items: [] }),
          create: jest.fn().mockResolvedValue({ inventory_item: { id: 'iitem_projection' } }),
        },
        product: {
          retrieve: jest.fn().mockResolvedValue({
            product: {
              id: 'prod_1',
              variants: [
                {
                  id: 'variant_medusa_1',
                  title: 'Red',
                  sku: 'CORE-SKU-1',
                  metadata: { pimVariantId: 'pim-var-1' },
                  inventory_items: [
                    {
                      inventory_item_id: 'iitem_old_sku',
                      inventory: { sku: 'CORE-SKU-1', metadata: {} },
                    },
                  ],
                },
              ],
            },
          }),
          batchVariantInventoryItems,
        },
      },
    };

    await (client as any).ensureVariantInventoryLinks('prod_1', [
      {
        title: 'Red',
        sku: 'CORE-SKU-1',
        metadata: { pimVariantId: 'pim-var-1' },
      },
    ]);

    expect((client as any).sdk.admin.inventoryItem.list).toHaveBeenCalledWith(
      expect.objectContaining({ sku: 'psq_pim-var-1' }),
    );
    expect((client as any).sdk.admin.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'psq_pim-var-1',
        metadata: expect.objectContaining({
          projectionType: 'product_sellable_quantity',
          pimVariantId: 'pim-var-1',
        }),
      }),
    );
    expect(batchVariantInventoryItems).toHaveBeenCalledWith('prod_1', {
      create: [
        {
          inventory_item_id: 'iitem_projection',
          variant_id: 'variant_medusa_1',
          required_quantity: 1,
        },
      ],
      update: [],
      delete: [
        {
          inventory_item_id: 'iitem_old_sku',
          variant_id: 'variant_medusa_1',
        },
      ],
    });
  });

  it('turns off managed inventory for missing matching projection events', async () => {
    const batchVariants = jest.fn().mockResolvedValue({});
    const upsertProjectionInventoryLevel = jest.fn().mockResolvedValue(undefined);
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: true,
          metadata: { pimVariantId: 'pim-var-1' },
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection',
              inventory: {
                sku: 'psq_pim-var-1',
                metadata: { projectionType: 'product_sellable_quantity', pimVariantId: 'pim-var-1' },
              },
            },
          ],
        },
      ],
    });
    (client as any).sdk = {
      admin: {
        product: { batchVariants },
      },
    };
    (client as any).upsertProjectionInventoryLevel = upsertProjectionInventoryLevel;

    await client.applyProductSellableQuantityProjection({
      medusaProductId: 'prod_1',
      variantId: 'pim-var-1',
      masterId: 'master-1',
      sellableQuantity: 0,
      isSellable: false,
      reason: 'MATCHING_MISSING',
      calculatedAt: '2026-05-27T00:00:00.000Z',
    });

    expect(batchVariants).toHaveBeenCalledWith('prod_1', {
      update: [{ id: 'variant_medusa_1', manage_inventory: false }],
    });
    expect(upsertProjectionInventoryLevel).toHaveBeenCalledWith('iitem_projection', 0);
  });

  it('skips stock projection and removes projection links for digital products', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_digital',
      metadata: { fulfillmentKind: 'digital', requiresShipping: false },
      variants: [
        {
          id: 'variant_medusa_1',
          title: '기본 품목',
          sku: 'SKU-D',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-1' },
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection',
              inventory: {
                sku: 'psq_pim-var-1',
                metadata: { projectionType: 'product_sellable_quantity', pimVariantId: 'pim-var-1' },
              },
            },
          ],
        },
      ],
    });
    const removeProjectionInventoryLinks = jest.fn().mockResolvedValue(undefined);
    const ensureVariantInventoryLinks = jest.fn();
    const batchVariants = jest.fn();
    (client as any).removeProjectionInventoryLinks = removeProjectionInventoryLinks;
    (client as any).ensureVariantInventoryLinks = ensureVariantInventoryLinks;
    (client as any).sdk = { admin: { product: { batchVariants } } };

    const result = await client.applyProductSellableQuantityProjection({
      medusaProductId: 'prod_digital',
      variantId: 'pim-var-1',
      masterId: 'master-1',
      sellableQuantity: 7,
      isSellable: true,
      reason: 'SELLABLE',
      calculatedAt: '2026-05-27T00:00:00.000Z',
    });

    expect(result).toEqual({ soldOutChanged: false });
    // 디지털은 projection inventory 를 만들지 않고 기존 링크를 제거한다.
    expect(removeProjectionInventoryLinks).toHaveBeenCalledWith(
      'prod_digital',
      expect.objectContaining({ id: 'prod_digital' }),
    );
    expect(ensureVariantInventoryLinks).not.toHaveBeenCalled();
    expect(batchVariants).not.toHaveBeenCalled();
  });

  it('turns on managed inventory and stores sellable quantity for stock-gated projection events', async () => {
    const batchVariants = jest.fn().mockResolvedValue({});
    const upsertProjectionInventoryLevel = jest.fn().mockResolvedValue(undefined);
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).logger = logger;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          manage_inventory: false,
          metadata: { pimVariantId: 'pim-var-1' },
          inventory_items: [
            {
              inventory_item_id: 'iitem_projection',
              inventory: {
                sku: 'psq_pim-var-1',
                metadata: { projectionType: 'product_sellable_quantity', pimVariantId: 'pim-var-1' },
              },
            },
          ],
        },
      ],
    });
    (client as any).sdk = {
      admin: {
        product: { batchVariants },
      },
    };
    (client as any).upsertProjectionInventoryLevel = upsertProjectionInventoryLevel;

    await client.applyProductSellableQuantityProjection({
      medusaProductId: 'prod_1',
      variantId: 'pim-var-1',
      masterId: 'master-1',
      sellableQuantity: 7,
      isSellable: true,
      reason: 'SELLABLE',
      calculatedAt: '2026-05-27T00:00:00.000Z',
    });

    expect(batchVariants).toHaveBeenCalledWith('prod_1', {
      update: [{ id: 'variant_medusa_1', manage_inventory: true }],
    });
    expect(upsertProjectionInventoryLevel).toHaveBeenCalledWith('iitem_projection', 7);
  });

  it('throws when no Medusa variant has the matching pimVariantId', async () => {
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).getProductWithVariantDetails = jest.fn().mockResolvedValue({
      id: 'prod_1',
      variants: [
        {
          id: 'variant_medusa_1',
          title: 'Red',
          sku: 'SKU-1',
          metadata: { pimVariantId: 'other-pim-var' },
        },
      ],
    });

    await expect(
      client.applyProductSellableQuantityProjection({
        medusaProductId: 'prod_1',
        variantId: 'pim-var-1',
        masterId: 'master-1',
        sellableQuantity: 7,
        isSellable: true,
        reason: 'SELLABLE',
        calculatedAt: '2026-05-27T00:00:00.000Z',
      }),
    ).rejects.toThrow('Medusa variant with pimVariantId=pim-var-1 not found on product prod_1');
  });

  it('links configured projection stock location to the default sales channel', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      stock_location: {
        id: 'sloc_configured',
        name: 'Projection Location',
        sales_channels: [],
      },
    });
    const updateSalesChannels = jest.fn().mockResolvedValue({});
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).configService = {
      get: jest.fn((key: string) =>
        key === 'MEDUSA_INVENTORY_PROJECTION_STOCK_LOCATION_ID' ? 'sloc_configured' : undefined,
      ),
    };
    (client as any).getDefaultSalesChannel = jest.fn().mockResolvedValue('sc_default');
    (client as any).sdk = {
      admin: {
        stockLocation: {
          retrieve,
          updateSalesChannels,
        },
      },
    };

    const stockLocationId = await (client as any).getProjectionStockLocationId();

    expect(stockLocationId).toBe('sloc_configured');
    expect(retrieve).toHaveBeenCalledWith('sloc_configured', {
      fields: 'id,name,*sales_channels',
    });
    expect(updateSalesChannels).toHaveBeenCalledWith('sloc_configured', {
      add: ['sc_default'],
    });
  });
});

describe('MedusaClient.removeProductFromPriceList', () => {
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("clears all of a product's prices in a price list via the products remove route so re-sync replaces instead of appends", async () => {
    const fetch = jest.fn().mockResolvedValue({ price_list: { id: 'plist_1' } });
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { client: { fetch } };
    (client as any).logger = logger;

    await client.removeProductFromPriceList('plist_1', 'prod_123');

    expect(fetch).toHaveBeenCalledWith('/admin/price-lists/plist_1/products', {
      method: 'post',
      body: { remove: ['prod_123'] },
    });
  });
});

describe('MedusaClient.addCustomerToGroup', () => {
  const GROUP = 'cusgroup_membership';

  function makeClient(groups: { id: string }[]) {
    const retrieve = jest.fn().mockResolvedValue({ customer: { id: 'cus_1', groups } });
    const batchCustomerGroups = jest.fn().mockResolvedValue({});
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    (client as any).sdk = { admin: { customer: { retrieve, batchCustomerGroups } } };
    (client as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { client, retrieve, batchCustomerGroups };
  }

  // 이미 소속인데 add 를 또 부르면 Medusa 가 link 행을 하나 더 만든다 (유니크 제약 없음).
  // 일일 정합성 크론이 매일 전체 회원을 돌기 때문에, 이 가드가 없으면 하루 한 행씩 쌓인다.
  it('skips the add when the customer already belongs to the group so links cannot pile up', async () => {
    const { client, batchCustomerGroups } = makeClient([{ id: GROUP }]);

    await client.addCustomerToGroup('cus_1', GROUP);

    expect(batchCustomerGroups).not.toHaveBeenCalled();
  });

  it('adds the customer when not yet in the group', async () => {
    const { client, batchCustomerGroups } = makeClient([{ id: 'cusgroup_other' }]);

    await client.addCustomerToGroup('cus_1', GROUP);

    expect(batchCustomerGroups).toHaveBeenCalledWith('cus_1', { add: [GROUP] });
  });
});
