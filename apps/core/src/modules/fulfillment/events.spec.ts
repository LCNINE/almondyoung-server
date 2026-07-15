import { FULFILLMENT_STREAM, FULFILLMENT_V2_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import {
  fulfillmentProgressedOutboxEvent,
  fulfillmentDeliveredV1OutboxEvent,
  fulfillmentShippedV1OutboxEvent,
  shipmentDeliveredOutboxEvent,
  shipmentShippedOutboxEvent,
} from './events';

const shipmentId = '11111111-1111-4111-8111-111111111111';
const attemptId = '22222222-2222-4222-8222-222222222222';
const warehouseId = '33333333-3333-4333-8333-333333333333';
const invoiceId = '44444444-4444-4444-8444-444444444444';
const salesOrderId = '55555555-5555-4555-8555-555555555555';
const fulfillmentOrderId = '66666666-6666-4666-8666-666666666666';
const shipmentLineId = '77777777-7777-4777-8777-777777777777';
const fulfillmentOrderItemId = '88888888-8888-4888-8888-888888888888';
const salesOrderLineId = '99999999-9999-4999-8999-999999999999';
const skuId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const shipmentPayload = {
  shipmentId,
  dispatchAttemptId: attemptId,
  attemptNo: 1,
  warehouseId,
  dispatchedAt: '2026-07-15T01:02:03.000Z',
  invoice: { invoiceId, carrier: 'CJ' as const, trackingNo: 'TRACK-001' },
  orders: [
    {
      salesOrderId,
      fulfillmentOrderId,
      salesChannel: 'naver' as const,
      channelOrderId: 'NAVER-ORDER-1',
      isPartial: false,
      lines: [
        {
          shipmentLineId,
          fulfillmentOrderItemId,
          salesOrderLineId,
          channelOrderItemId: 'NAVER-ITEM-1',
          skuId,
          qty: 2,
          isPartialQuantity: false,
        },
      ],
    },
  ],
};

describe('Task 18 fulfillment outbox event contracts', () => {
  it('builds ShipmentShipped with shipment partitioning and attempt idempotency', () => {
    expect(shipmentShippedOutboxEvent(shipmentPayload)).toEqual({
      topic: SHIPMENT_STREAM.topic.topic,
      eventType: 'ShipmentShipped',
      aggregateType: 'Shipment',
      aggregateId: shipmentId,
      partitionKey: shipmentId,
      idempotencyKey: attemptId,
      payload: shipmentPayload,
    });
  });

  it('builds one FulfillmentProgressed key per attempt and affected FO', () => {
    const payload = {
      fulfillmentOrderId,
      salesOrderId,
      dispatchAttemptId: attemptId,
      progressedAt: '2026-07-15T01:02:03.000Z',
      shippedQty: 2,
      canceledQty: 0,
      outstandingQty: 3,
    };

    expect(fulfillmentProgressedOutboxEvent(payload)).toEqual({
      topic: FULFILLMENT_V2_STREAM.topic.topic,
      eventType: 'FulfillmentProgressed',
      aggregateType: 'FulfillmentOrder',
      aggregateId: fulfillmentOrderId,
      partitionKey: fulfillmentOrderId,
      idempotencyKey: `${attemptId}:${fulfillmentOrderId}`,
      payload,
    });
  });

  it('builds the once-only v1 projection only for full uncancelled completion', () => {
    const payload = {
      fulfillmentId: fulfillmentOrderId,
      orderId: salesOrderId,
      channelOrderId: 'NAVER-ORDER-1',
      trackingInfo: { carrier: 'CJ' as const, trackingNumber: 'TRACK-001' },
      shippedAt: '2026-07-15T01:02:03.000Z',
      shippedItems: [{ fulfillmentItemId: fulfillmentOrderItemId, skuId, shippedQty: 2 }],
    };

    expect(
      fulfillmentShippedV1OutboxEvent(payload, {
        fulfillmentOrderId,
        salesOrderId,
        shippedQty: 2,
        canceledQty: 0,
        outstandingQty: 0,
      }),
    ).toEqual({
      topic: FULFILLMENT_STREAM.topic.topic,
      eventType: 'FulfillmentShipped',
      aggregateType: 'Fulfillment',
      aggregateId: fulfillmentOrderId,
      partitionKey: fulfillmentOrderId,
      idempotencyKey: `${fulfillmentOrderId}:fully-shipped`,
      payload,
    });

    expect(() =>
      fulfillmentShippedV1OutboxEvent(payload, {
        fulfillmentOrderId,
        salesOrderId,
        shippedQty: 2,
        canceledQty: 0,
        outstandingQty: 1,
      }),
    ).toThrow('full-completion');
  });

  it('supports an SO-less shipment fact but fails closed on incomplete channel/progress identities', () => {
    expect(shipmentShippedOutboxEvent({ ...shipmentPayload, orders: [] }).payload.orders).toEqual([]);
    expect(() =>
      shipmentShippedOutboxEvent({
        ...shipmentPayload,
        orders: [
          {
            ...shipmentPayload.orders[0],
            lines: [{ ...shipmentPayload.orders[0].lines[0], channelOrderItemId: undefined }],
          },
        ],
      } as never),
    ).toThrow();
    expect(() =>
      fulfillmentProgressedOutboxEvent({
        fulfillmentOrderId,
        dispatchAttemptId: attemptId,
        progressedAt: '2026-07-15T01:02:03.000Z',
        shippedQty: 1,
        canceledQty: 0,
        outstandingQty: 0,
      } as never),
    ).toThrow();
  });

  it('rejects PII additions before durable enqueue', () => {
    expect(() => shipmentShippedOutboxEvent({ ...shipmentPayload, recipientName: 'not-allowed' } as never)).toThrow();
  });

  it('builds attempt-stable shipment and FO delivery projections', () => {
    const deliveredAt = '2026-07-15T04:05:06.000Z';
    const shipmentDelivered = {
      shipmentId,
      dispatchAttemptId: attemptId,
      attemptNo: 1,
      providerEventId: 'provider-delivered-1',
      deliveredAt,
    };
    expect(shipmentDeliveredOutboxEvent(shipmentDelivered)).toEqual({
      topic: SHIPMENT_STREAM.topic.topic,
      eventType: 'ShipmentDelivered',
      aggregateType: 'Shipment',
      aggregateId: shipmentId,
      partitionKey: shipmentId,
      idempotencyKey: attemptId,
      payload: shipmentDelivered,
    });

    const fulfillmentDelivered = {
      fulfillmentId: fulfillmentOrderId,
      orderId: salesOrderId,
      channelOrderId: 'NAVER-ORDER-1',
      deliveredAt,
    };
    expect(fulfillmentDeliveredV1OutboxEvent(fulfillmentDelivered)).toEqual({
      topic: FULFILLMENT_STREAM.topic.topic,
      eventType: 'FulfillmentDelivered',
      aggregateType: 'Fulfillment',
      aggregateId: fulfillmentOrderId,
      partitionKey: fulfillmentOrderId,
      idempotencyKey: `${fulfillmentOrderId}:fully-delivered`,
      payload: fulfillmentDelivered,
    });
  });
});
