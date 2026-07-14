import { PgDialect } from 'drizzle-orm/pg-core';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

describe('OutboxDispatcherService workflow filtering', () => {
  function makeDispatcher(shouldDispatchFulfillmentEvents: boolean) {
    let acquiredQuery: unknown;
    const tx = {
      execute: jest.fn(async (query: unknown) => {
        acquiredQuery = query;
        return [];
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
  });

  it('does not add the maintenance filter in legacy or v2 operation', async () => {
    const { dispatcher, getAcquiredSql } = makeDispatcher(true);

    await dispatcher.dispatch();

    expect(getAcquiredSql()).not.toContain('LOWER(aggregate_type) NOT IN');
    expect(getAcquiredSql()).not.toContain("LOWER(event_type) NOT LIKE 'fulfillment%'");
  });
});
