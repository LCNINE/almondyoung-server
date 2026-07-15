import { FULFILLMENT_STREAM, FULFILLMENT_V2_STREAM, SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { PgDialect } from 'drizzle-orm/pg-core';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

describe('OutboxDispatcherService workflow filtering', () => {
  function makeDispatcher(shouldDispatchFulfillmentEvents: boolean) {
    let acquiredQuery: unknown;
    const tx = {
      execute: jest.fn((query: unknown) => {
        acquiredQuery = query;
        return Promise.resolve([]);
      }),
    };
    const db = {
      db: {
        transaction: jest.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      },
    };

    return {
      dispatcher: new OutboxDispatcherService(
        db as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { shouldDispatchFulfillmentEvents: () => shouldDispatchFulfillmentEvents } as never,
      ),
      getAcquiredSql: () => new PgDialect().sqlToQuery(acquiredQuery as never).sql.replace(/\s+/g, ' '),
    };
  }

  it('excludes fulfillment and shipment outbox rows during maintenance', async () => {
    const { dispatcher, getAcquiredSql } = makeDispatcher(false);

    await dispatcher.dispatch();

    expect(getAcquiredSql()).toContain("LOWER(aggregate_type) NOT IN ('fulfillment', 'fulfillment_order'");
    expect(getAcquiredSql()).toContain("LOWER(event_type) NOT LIKE 'fulfillment%'");
    expect(getAcquiredSql()).toContain("LOWER(event_type) NOT LIKE 'shipment%'");
    expect(getAcquiredSql()).toContain('topic IS DISTINCT FROM $1');
    expect(getAcquiredSql()).toContain('topic IS DISTINCT FROM $2');
  });

  it('does not add the maintenance filter in legacy or v2 operation', async () => {
    const { dispatcher, getAcquiredSql } = makeDispatcher(true);

    await dispatcher.dispatch();

    expect(getAcquiredSql()).not.toContain('LOWER(aggregate_type) NOT IN');
    expect(getAcquiredSql()).not.toContain("LOWER(event_type) NOT LIKE 'fulfillment%'");
  });
});

describe('OutboxDispatcherService explicit topic routing', () => {
  interface TestOutboxEvent {
    id: string;
    topic: string | null;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    partition_key: string;
    payload: Record<string, unknown>;
    attempts: number;
  }

  function publish(service: OutboxDispatcherService, event: TestOutboxEvent): Promise<void> {
    const testHarness = service as unknown as { publishEvent(row: TestOutboxEvent): Promise<void> };
    return testHarness.publishEvent(event);
  }

  function fixture() {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const db = { db: { update } };
    const fulfillment = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const inventory = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const coreOrder = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const shipment = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const fulfillmentV2 = { publishEvent: jest.fn().mockResolvedValue(undefined) };
    const workflowGate = { shouldDispatchFulfillmentEvents: jest.fn().mockReturnValue(true) };
    const service = new OutboxDispatcherService(
      db as never,
      fulfillment as never,
      inventory as never,
      coreOrder as never,
      shipment as never,
      fulfillmentV2 as never,
      workflowGate as never,
    );

    return { service, fulfillment, inventory, coreOrder, shipment, fulfillmentV2, set };
  }

  const baseEvent = {
    id: '00000000-0000-4000-8000-000000000001',
    topic: null,
    event_type: 'FulfillmentReady',
    aggregate_type: 'Fulfillment',
    aggregate_id: '00000000-0000-4000-8000-000000000002',
    partition_key: '00000000-0000-4000-8000-000000000002',
    payload: {},
    attempts: 0,
  };

  it('routes explicit fulfillment-v1, shipment and fulfillment-v2 topics only to their typed publishers', async () => {
    const f = fixture();
    await publish(f.service, {
      ...baseEvent,
      topic: FULFILLMENT_STREAM.topic.topic,
      event_type: 'FulfillmentShipped',
      aggregate_type: 'Fulfillment',
    });
    await publish(f.service, {
      ...baseEvent,
      id: '00000000-0000-4000-8000-000000000003',
      topic: SHIPMENT_STREAM.topic.topic,
      event_type: 'ShipmentShipped',
      aggregate_type: 'Shipment',
    });
    await publish(f.service, {
      ...baseEvent,
      id: '00000000-0000-4000-8000-000000000004',
      topic: FULFILLMENT_V2_STREAM.topic.topic,
      event_type: 'FulfillmentProgressed',
      aggregate_type: 'FulfillmentOrder',
    });

    expect(f.fulfillment.publishEvent).toHaveBeenCalledTimes(1);
    expect(f.fulfillment.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'FulfillmentShipped', metadata: { partitionKey: baseEvent.partition_key } }),
    );
    expect(f.shipment.publishEvent).toHaveBeenCalledTimes(1);
    expect(f.shipment.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ShipmentShipped', metadata: { partitionKey: baseEvent.partition_key } }),
    );
    expect(f.fulfillmentV2.publishEvent).toHaveBeenCalledTimes(1);
    expect(f.fulfillmentV2.publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'FulfillmentProgressed' }),
    );
    expect(f.inventory.publishEvent).not.toHaveBeenCalled();
    expect(f.coreOrder.publishEvent).not.toHaveBeenCalled();
  });

  it('uses aggregate/event inference only for topicless legacy rows', async () => {
    const f = fixture();
    await publish(f.service, baseEvent);
    expect(f.fulfillment.publishEvent).toHaveBeenCalledTimes(1);
  });

  it('fails an unknown explicit topic closed and leaves it retryable', async () => {
    const f = fixture();
    await expect(publish(f.service, { ...baseEvent, topic: 'unexpected.events.v1' })).rejects.toThrow(
      'Unknown explicit outbox topic: unexpected.events.v1',
    );

    expect(f.fulfillment.publishEvent).not.toHaveBeenCalled();
    expect(f.shipment.publishEvent).not.toHaveBeenCalled();
    expect(f.fulfillmentV2.publishEvent).not.toHaveBeenCalled();
    expect(f.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 1, nextAttemptAt: expect.any(Date) as unknown }),
    );
  });
});
