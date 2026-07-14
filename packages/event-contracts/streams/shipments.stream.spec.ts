import {
  FULFILLMENT_STREAM,
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
  createFulfillmentShippedV1Projection,
  type FulfillmentProgressedPayload,
  type ShipmentShippedPayload,
} from './index';

const SHIPPED_PAYLOAD = {
  shipmentId: '11111111-1111-4111-8111-111111111111',
  dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
  attemptNo: 1,
  warehouseId: '33333333-3333-4333-8333-333333333333',
  dispatchedAt: '2026-07-14T01:00:00.000Z',
  invoice: {
    invoiceId: '44444444-4444-4444-8444-444444444444',
    carrier: 'CJ' as const,
    trackingNo: 'tracking-1',
  },
  orders: [
    {
      salesOrderId: '55555555-5555-4555-8555-555555555555',
      fulfillmentOrderId: '66666666-6666-4666-8666-666666666666',
      salesChannel: 'naver' as const,
      channelOrderId: 'channel-order-1',
      isPartial: true,
      lines: [
        {
          shipmentLineId: '77777777-7777-4777-8777-777777777777',
          fulfillmentOrderItemId: '88888888-8888-4888-8888-888888888888',
          salesOrderLineId: '99999999-9999-4999-8999-999999999999',
          channelOrderItemId: 'channel-order-item-1',
          skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          isPartialQuantity: false,
        },
      ],
    },
  ],
} satisfies ShipmentShippedPayload;

const PROGRESS_PAYLOAD = {
  fulfillmentOrderId: '66666666-6666-4666-8666-666666666666',
  salesOrderId: '55555555-5555-4555-8555-555555555555',
  dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
  progressedAt: '2026-07-14T01:00:00.000Z',
  shippedQty: 1,
  canceledQty: 0,
  outstandingQty: 1,
} satisfies FulfillmentProgressedPayload;

describe('SHIPMENT_STREAM', () => {
  const shippedSchema = SHIPMENT_STREAM.events.ShipmentShipped.schema!;

  it('publishes the shipment event types on shipments.events.v1', () => {
    expect(SHIPMENT_STREAM.topic.topic).toBe('shipments.events.v1');
    expect(Object.keys(SHIPMENT_STREAM.events)).toEqual([
      'ShipmentShipped',
      'ShipmentDelivered',
      'ShipmentDispatchRecalled',
    ]);
  });

  it('parses a shipment attempt with invoice identity and channel-grouped orders', () => {
    expect(shippedSchema.parse(SHIPPED_PAYLOAD)).toEqual(SHIPPED_PAYLOAD);
  });

  it('requires the explicit per-order partial-dispatch signal', () => {
    const { isPartial: _missing, ...order } = SHIPPED_PAYLOAD.orders[0];
    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, orders: [order] })).toThrow();
  });

  it('requires an explicit partial-quantity signal for every shipped line', () => {
    const { isPartialQuantity: _missing, ...line } = SHIPPED_PAYLOAD.orders[0].lines[0];
    expect(() =>
      shippedSchema.parse({
        ...SHIPPED_PAYLOAD,
        orders: [{ ...SHIPPED_PAYLOAD.orders[0], lines: [line] }],
      }),
    ).toThrow();
  });

  it('uses UUIDs for Core-owned identities while keeping external channel ids opaque', () => {
    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, shipmentId: 'opaque-shipment-id' })).toThrow();
    expect(() =>
      shippedSchema.parse({
        ...SHIPPED_PAYLOAD,
        orders: [{ ...SHIPPED_PAYLOAD.orders[0], channelOrderId: 'external-order/opaque' }],
      }),
    ).not.toThrow();
  });

  it('uses shipmentId as the fixed partition key for every shipment event', () => {
    expect(SHIPMENT_STREAM.partitionKey(SHIPPED_PAYLOAD)).toBe(SHIPPED_PAYLOAD.shipmentId);
    expect(
      SHIPMENT_STREAM.partitionKey({
        shipmentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        dispatchAttemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        attemptNo: 2,
        providerEventId: 'provider-event-1',
        deliveredAt: '2026-07-14T02:00:00.000Z',
      }),
    ).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(
      SHIPMENT_STREAM.partitionKey({
        shipmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        dispatchAttemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        attemptNo: 3,
        recallOperationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        recalledAt: '2026-07-14T03:00:00.000Z',
      }),
    ).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });

  it.each(['shipmentId', 'dispatchAttemptId', 'warehouseId'] as const)('rejects a missing %s identity', (field) => {
    const { [field]: _missing, ...payload } = SHIPPED_PAYLOAD;
    expect(() => shippedSchema.parse(payload)).toThrow();
  });

  it('rejects payloads without an attempt number', () => {
    const { attemptNo: _missing, ...payload } = SHIPPED_PAYLOAD;
    expect(() => shippedSchema.parse(payload)).toThrow();
  });

  it.each(['invoiceId', 'carrier', 'trackingNo'] as const)('rejects a missing invoice %s identity', (field) => {
    const { [field]: _missing, ...invoice } = SHIPPED_PAYLOAD.invoice;
    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, invoice })).toThrow();
  });

  it.each(['shipmentLineId', 'fulfillmentOrderItemId', 'salesOrderLineId', 'channelOrderItemId', 'skuId'] as const)(
    'rejects a missing line %s identity',
    (field) => {
      const { [field]: _missing, ...line } = SHIPPED_PAYLOAD.orders[0].lines[0];
      const orders = [{ ...SHIPPED_PAYLOAD.orders[0], lines: [line] }];
      expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, orders })).toThrow();
    },
  );

  it('rejects duplicate shipment line identity across order groups', () => {
    const duplicateOrder = {
      ...SHIPPED_PAYLOAD.orders[0],
      salesOrderId: '12121212-1212-4212-8212-121212121212',
      fulfillmentOrderId: '13131313-1313-4313-8313-131313131313',
      salesChannel: 'coupang' as const,
      channelOrderId: 'channel-order-2',
    };

    expect(() =>
      shippedSchema.parse({
        ...SHIPPED_PAYLOAD,
        orders: [...SHIPPED_PAYLOAD.orders, duplicateOrder],
      }),
    ).toThrow();
  });

  it('rejects duplicate sales-channel/channel-order groups', () => {
    const duplicateOrder = {
      ...SHIPPED_PAYLOAD.orders[0],
      salesOrderId: '12121212-1212-4212-8212-121212121212',
      fulfillmentOrderId: '13131313-1313-4313-8313-131313131313',
      lines: [
        {
          ...SHIPPED_PAYLOAD.orders[0].lines[0],
          shipmentLineId: '14141414-1414-4414-8414-141414141414',
          fulfillmentOrderItemId: '15151515-1515-4515-8515-151515151515',
          salesOrderLineId: '16161616-1616-4616-8616-161616161616',
          channelOrderItemId: 'channel-order-item-2',
        },
      ],
    };

    expect(() =>
      shippedSchema.parse({
        ...SHIPPED_PAYLOAD,
        orders: [...SHIPPED_PAYLOAD.orders, duplicateOrder],
      }),
    ).toThrow();
  });

  it('rejects duplicate sales-order line identity across order groups', () => {
    const duplicateOrder = {
      ...SHIPPED_PAYLOAD.orders[0],
      salesOrderId: '12121212-1212-4212-8212-121212121212',
      fulfillmentOrderId: '13131313-1313-4313-8313-131313131313',
      salesChannel: 'coupang' as const,
      channelOrderId: 'channel-order-2',
      lines: [
        {
          ...SHIPPED_PAYLOAD.orders[0].lines[0],
          shipmentLineId: '14141414-1414-4414-8414-141414141414',
          fulfillmentOrderItemId: '15151515-1515-4515-8515-151515151515',
          channelOrderItemId: 'channel-order-item-2',
        },
      ],
    };

    expect(() =>
      shippedSchema.parse({ ...SHIPPED_PAYLOAD, orders: [...SHIPPED_PAYLOAD.orders, duplicateOrder] }),
    ).toThrow();
  });

  it('rejects duplicate channel item identity within one channel-order group', () => {
    const order = {
      ...SHIPPED_PAYLOAD.orders[0],
      lines: [
        SHIPPED_PAYLOAD.orders[0].lines[0],
        {
          ...SHIPPED_PAYLOAD.orders[0].lines[0],
          shipmentLineId: '14141414-1414-4414-8414-141414141414',
          fulfillmentOrderItemId: '15151515-1515-4515-8515-151515151515',
          salesOrderLineId: '16161616-1616-4616-8616-161616161616',
        },
      ],
    };

    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, orders: [order] })).toThrow();
  });

  it.each([0, -1, 1.5])('rejects invalid shipped qty %p', (qty) => {
    const orders = [
      {
        ...SHIPPED_PAYLOAD.orders[0],
        lines: [{ ...SHIPPED_PAYLOAD.orders[0].lines[0], qty }],
      },
    ];
    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, orders })).toThrow();
  });

  it('rejects recipient and address PII at every payload nesting point', () => {
    expect(() => shippedSchema.parse({ ...SHIPPED_PAYLOAD, recipientName: '홍길동' })).toThrow();
    expect(() =>
      shippedSchema.parse({
        ...SHIPPED_PAYLOAD,
        orders: [{ ...SHIPPED_PAYLOAD.orders[0], shippingAddress: '서울시' }],
      }),
    ).toThrow();
  });

  it('parses delivery identity and rejects delivery PII', () => {
    const payload = {
      shipmentId: SHIPPED_PAYLOAD.shipmentId,
      dispatchAttemptId: SHIPPED_PAYLOAD.dispatchAttemptId,
      attemptNo: 1,
      providerEventId: 'provider-event-1',
      deliveredAt: '2026-07-14T02:00:00.000Z',
    };

    expect(SHIPMENT_STREAM.events.ShipmentDelivered.schema!.parse(payload)).toEqual(payload);
    expect(() =>
      SHIPMENT_STREAM.events.ShipmentDelivered.schema!.parse({ ...payload, recipientName: '홍길동' }),
    ).toThrow();
  });

  it('parses recall operation identity and requires the referenced attempt', () => {
    const payload = {
      shipmentId: SHIPPED_PAYLOAD.shipmentId,
      dispatchAttemptId: SHIPPED_PAYLOAD.dispatchAttemptId,
      attemptNo: 1,
      recallOperationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      recalledAt: '2026-07-14T03:00:00.000Z',
    };

    expect(SHIPMENT_STREAM.events.ShipmentDispatchRecalled.schema!.parse(payload)).toEqual(payload);
    const { dispatchAttemptId: _missing, ...withoutAttempt } = payload;
    expect(() => SHIPMENT_STREAM.events.ShipmentDispatchRecalled.schema!.parse(withoutAttempt)).toThrow();
  });
});

describe('FULFILLMENT_V2_STREAM', () => {
  const progressedSchema = FULFILLMENT_V2_STREAM.events.FulfillmentProgressed.schema!;
  const reopenedSchema = FULFILLMENT_V2_STREAM.events.FulfillmentReopened.schema!;

  it('publishes progress events on fulfillments.events.v2', () => {
    expect(FULFILLMENT_V2_STREAM.topic.topic).toBe('fulfillments.events.v2');
    expect(Object.keys(FULFILLMENT_V2_STREAM.events)).toEqual(['FulfillmentProgressed', 'FulfillmentReopened']);
  });

  it('uses fulfillmentOrderId as the fixed partition key', () => {
    expect(FULFILLMENT_V2_STREAM.partitionKey(PROGRESS_PAYLOAD)).toBe(PROGRESS_PAYLOAD.fulfillmentOrderId);
  });

  it('parses shipped, canceled and outstanding progress summaries', () => {
    expect(progressedSchema.parse(PROGRESS_PAYLOAD)).toEqual(PROGRESS_PAYLOAD);
  });

  it.each([-1, 1.5])('rejects invalid progress quantity %p', (invalidQty) => {
    expect(() => progressedSchema.parse({ ...PROGRESS_PAYLOAD, outstandingQty: invalidQty })).toThrow();
  });

  it('parses a recall-driven fulfillment reopen summary', () => {
    expect(() =>
      reopenedSchema.parse({
        fulfillmentOrderId: PROGRESS_PAYLOAD.fulfillmentOrderId,
        salesOrderId: PROGRESS_PAYLOAD.salesOrderId,
        dispatchAttemptId: PROGRESS_PAYLOAD.dispatchAttemptId,
        recallOperationId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        reopenedAt: '2026-07-14T03:00:00.000Z',
        shippedQty: 0,
        canceledQty: 0,
        outstandingQty: 2,
      }),
    ).not.toThrow();
  });
});

describe('FulfillmentShipped v1 full-completion projection', () => {
  const v1Payload = {
    fulfillmentId: 'fulfillment-order-1',
    orderId: 'sales-order-1',
    channelOrderId: 'channel-order-1',
    trackingInfo: { carrier: 'CJ' as const, trackingNumber: 'tracking-1' },
    shippedAt: '2026-07-14T01:00:00.000Z',
    shippedItems: [{ fulfillmentItemId: 'foi-1', skuId: 'sku-1', shippedQty: 2 }],
  };

  it('constructs the compatibility event only for an uncancelled full completion', () => {
    expect(
      createFulfillmentShippedV1Projection(v1Payload, {
        fulfillmentOrderId: 'fulfillment-order-1',
        salesOrderId: 'sales-order-1',
        shippedQty: 2,
        canceledQty: 0,
        outstandingQty: 0,
      }),
    ).toEqual(v1Payload);
    expect(FULFILLMENT_STREAM.events.FulfillmentShipped.schema!.parse(v1Payload)).toEqual(v1Payload);
  });

  it('cannot construct FulfillmentShipped v1 from a partial shipment', () => {
    expect(() =>
      createFulfillmentShippedV1Projection(v1Payload, {
        fulfillmentOrderId: 'fulfillment-order-1',
        salesOrderId: 'sales-order-1',
        shippedQty: 2,
        canceledQty: 0,
        outstandingQty: 1,
      }),
    ).toThrow('full-completion');
  });

  it('cannot construct FulfillmentShipped v1 when any demand was canceled', () => {
    expect(() =>
      createFulfillmentShippedV1Projection(v1Payload, {
        fulfillmentOrderId: 'fulfillment-order-1',
        salesOrderId: 'sales-order-1',
        shippedQty: 2,
        canceledQty: 1,
        outstandingQty: 0,
      }),
    ).toThrow('full-completion');
  });

  it('cannot pair the compatibility payload with another FO summary that has equal totals', () => {
    expect(() =>
      createFulfillmentShippedV1Projection(v1Payload, {
        fulfillmentOrderId: 'fulfillment-order-2',
        salesOrderId: 'sales-order-2',
        shippedQty: 2,
        canceledQty: 0,
        outstandingQty: 0,
      }),
    ).toThrow('full-completion');
  });
});
