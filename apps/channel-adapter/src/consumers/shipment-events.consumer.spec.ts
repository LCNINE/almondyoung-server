import type { ShipmentShippedPayload } from '@packages/event-contracts/streams';
import { inboxEvents } from '../schema';
import { ShipmentEventsConsumer } from './shipment-events.consumer';

const PAYLOAD: ShipmentShippedPayload = {
  shipmentId: '11111111-1111-4111-8111-111111111111',
  dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
  attemptNo: 1,
  warehouseId: '33333333-3333-4333-8333-333333333333',
  dispatchedAt: '2026-07-14T00:00:00.000Z',
  invoice: { invoiceId: '44444444-4444-4444-8444-444444444444', carrier: 'HANJIN', trackingNo: 'TRACK-1' },
  orders: [
    {
      salesOrderId: '55555555-5555-4555-8555-555555555555',
      fulfillmentOrderId: '66666666-6666-4666-8666-666666666666',
      salesChannel: 'naver',
      channelOrderId: '1000000001',
      isPartial: false,
      lines: [
        {
          shipmentLineId: '77777777-7777-4777-8777-777777777777',
          fulfillmentOrderItemId: '88888888-8888-4888-8888-888888888888',
          salesOrderLineId: '99999999-9999-4999-8999-999999999999',
          channelOrderItemId: '100000001',
          skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          qty: 1,
          isPartialQuantity: false,
        },
      ],
    },
  ],
};

const ENVELOPE = { correlationId: 'correlation-1', causationId: 'causation-1', messageId: 'message-1' } as any;

function makeConsumer() {
  const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
  const values = jest.fn().mockReturnValue({ onConflictDoNothing });
  const insert = jest.fn().mockReturnValue({ values });
  return {
    consumer: new ShipmentEventsConsumer({ db: { insert } } as any),
    insert,
    values,
    onConflictDoNothing,
  };
}

describe('ShipmentEventsConsumer', () => {
  it('validates and durably inserts ShipmentShipped using attempt idempotency', async () => {
    const { consumer, insert, values, onConflictDoNothing } = makeConsumer();

    await consumer.handleShipmentShipped(PAYLOAD, ENVELOPE);

    expect(insert).toHaveBeenCalledWith(inboxEvents);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ShipmentShipped',
        idempotencyKey: PAYLOAD.dispatchAttemptId,
        aggregateId: PAYLOAD.shipmentId,
        partitionKey: PAYLOAD.shipmentId,
        status: 'pending',
      }),
    );
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('uses the database uniqueness boundary for duplicate Kafka delivery', async () => {
    const { consumer, onConflictDoNothing } = makeConsumer();

    await consumer.handleShipmentShipped(PAYLOAD, ENVELOPE);
    await consumer.handleShipmentShipped(PAYLOAD, ENVELOPE);

    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it('rejects missing external item identity before inserting inbox work', async () => {
    const { consumer, insert } = makeConsumer();
    const invalid = structuredClone(PAYLOAD) as any;
    delete invalid.orders[0].lines[0].channelOrderItemId;

    await expect(consumer.handleShipmentShipped(invalid, ENVELOPE)).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it('uses recall operation identity for recall idempotency', async () => {
    const { consumer, values } = makeConsumer();

    await consumer.handleShipmentDispatchRecalled(
      {
        shipmentId: PAYLOAD.shipmentId,
        dispatchAttemptId: PAYLOAD.dispatchAttemptId,
        attemptNo: 1,
        recallOperationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        recalledAt: '2026-07-14T01:00:00.000Z',
      },
      ENVELOPE,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'ShipmentDispatchRecalled',
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    );
  });
});
