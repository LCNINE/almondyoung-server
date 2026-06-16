import { InboxWorkerService } from './inbox-worker.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';
import { PgDialect } from 'drizzle-orm/pg-core';

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || value === undefined) return [];
  if (value instanceof Date) return [value.toISOString()];
  if (typeof value !== 'object') return [value];
  if (seen.has(value)) return [];

  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectValues(item, seen));
  }

  return Object.values(value as Record<string, unknown>).flatMap((item) => collectValues(item, seen));
}

function createDbMock(newerEvents: unknown[] | ((condition: unknown) => unknown[]) = []) {
  const updates: any[] = [];
  const execute = jest.fn().mockResolvedValue([]);
  const where = jest.fn((condition: unknown) => ({
    limit: jest.fn().mockResolvedValue(typeof newerEvents === 'function' ? newerEvents(condition) : newerEvents),
  }));
  const from = jest.fn(() => ({ where }));
  const select = jest.fn(() => ({ from }));
  const update = jest.fn(() => ({
    set: jest.fn((values: any) => {
      updates.push(values);
      return {
        where: jest.fn().mockResolvedValue(undefined),
      };
    }),
  }));

  return {
    db: { execute, select, update },
    updates,
    execute,
  };
}

describe('InboxWorkerService ProductSellableQuantityChanged handling', () => {
  const payload: ProductSellableQuantityChangedPayload = {
    variantId: 'pim-var-1',
    masterId: 'master-1',
    versionId: 'version-1',
    matchingId: 'matching-1',
    sellableQuantity: 7,
    stockBoundQuantity: 7,
    isSellable: true,
    reason: 'SELLABLE',
    calculatedAt: '2026-05-27T00:00:00.000Z',
  };

  function createService(params?: {
    syncError?: Error;
    maxRetries?: number;
    newerEvents?: unknown[] | ((condition: unknown) => unknown[]);
    config?: Record<string, string | number | undefined>;
    syncPromise?: Promise<void>;
  }) {
    const dbMock = createDbMock(params?.newerEvents);
    const syncService = {
      handleActiveVersionChanged: jest.fn().mockResolvedValue(undefined),
      handleProductMasterDeleted: jest.fn().mockResolvedValue(undefined),
      handleProductSellableQuantityChanged: jest.fn(() => {
        if (params?.syncError) return Promise.reject(params.syncError);
        if (params?.syncPromise) return params.syncPromise;
        return Promise.resolve();
      }),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (Object.prototype.hasOwnProperty.call(params?.config ?? {}, key)) return params?.config?.[key];
        if (key === 'INBOX_MAX_RETRIES') return params?.maxRetries ?? 5;
        return undefined;
      }),
    };

    const service = new InboxWorkerService(
      { db: dbMock.db } as any,
      syncService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      configService as any,
      { runWithChain: jest.fn((_chainId: string, _eventId: string, fn: () => Promise<void>) => fn()) } as any,
    );

    return { service, dbMock, syncService };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-27T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks a successful sellable quantity sync as published', async () => {
    const { service, dbMock, syncService } = createService();
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 0,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates).toEqual([
      { status: 'published', publishedAt: new Date('2026-05-27T00:00:00.000Z') },
    ]);
  });

  it('keeps a Medusa API failure pending with exponential backoff so it can be retried', async () => {
    const { service, dbMock, syncService } = createService({
      syncError: new Error('Medusa API down'),
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 1,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 1,
      errorMessage: 'Medusa API down',
      nextAttemptAt: new Date('2026-05-27T00:00:02.000Z'),
    });
  });

  it('does not increment attempts again when a claimed event fails', async () => {
    const { service, dbMock, syncService } = createService({
      syncError: new Error('Medusa API down'),
      maxRetries: 5,
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 2,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 2,
      errorMessage: 'Medusa API down',
      nextAttemptAt: new Date('2026-05-27T00:00:04.000Z'),
    });
  });

  it('marks a claimed event failed when attempts already reached max retries', async () => {
    const { service, dbMock } = createService({
      syncError: new Error('Medusa API down'),
      maxRetries: 2,
    });
    const event = {
      id: 'inbox_1',
      eventType: 'ProductSellableQuantityChanged',
      aggregateId: 'pim-var-1',
      payload,
      attempts: 2,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(dbMock.updates[0]).toEqual({
      status: 'failed',
      attempts: 2,
      errorMessage: 'Medusa API down',
      failedAt: new Date('2026-05-27T00:00:00.000Z'),
    });
  });

  it('keeps unsupported event types retryable instead of publishing them', async () => {
    const { service, dbMock } = createService();
    const event = {
      id: 'inbox_unknown',
      eventType: 'SomeUnexpectedEvent',
      aggregateId: 'aggregate-1',
      payload: {},
      attempts: 1,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(dbMock.updates[0]).toEqual({
      status: 'pending',
      attempts: 1,
      errorMessage: 'Unsupported inbox event type: SomeUnexpectedEvent',
      nextAttemptAt: new Date('2026-05-27T00:00:02.000Z'),
    });
  });

  it('coerces string worker env config to numbers', () => {
    const { service } = createService({
      config: {
        INBOX_MAX_CONCURRENT_HANDLERS: '3',
        INBOX_HANDLER_START_INTERVAL_MS: '10000',
        INBOX_PROCESSING_LEASE_MS: '900000',
        INBOX_SHUTDOWN_DRAIN_MS: '25000',
        INBOX_MAX_RETRIES: '7',
      },
    });

    expect((service as any).maxConcurrentHandlers).toBe(3);
    expect((service as any).handlerStartIntervalMs).toBe(10000);
    expect((service as any).processingLeaseMs).toBe(900000);
    expect((service as any).shutdownDrainMs).toBe(25000);
    expect((service as any).maxRetries).toBe(7);
  });

  it('starts at most one handler per tick and skips claims while at local concurrency limit', async () => {
    const neverResolves = new Promise<void>(() => undefined);
    const { service, dbMock } = createService({
      config: {
        INBOX_MAX_CONCURRENT_HANDLERS: '1',
        INBOX_HANDLER_START_INTERVAL_MS: '10000',
      },
      syncPromise: neverResolves,
    });
    dbMock.execute.mockResolvedValueOnce([
      {
        id: '01930000-0000-7000-8000-000000000001',
        eventType: 'ProductSellableQuantityChanged',
        aggregateType: 'ProductVariant',
        aggregateId: 'pim-var-1',
        partitionKey: 'pim-var-1',
        payload,
        metadata: { messageId: 'msg-1', chainId: 'chain-1' },
        status: 'processing',
        attempts: 1,
        nextAttemptAt: new Date('2026-05-27T00:15:00.000Z'),
        errorMessage: null,
        eventOccurredAt: null,
        createdAt: new Date('2026-05-27T00:00:00.000Z'),
        publishedAt: null,
        failedAt: null,
      },
    ]);

    (service as any).isRunning = true;
    await (service as any).tryStartNextHandler();
    await (service as any).tryStartNextHandler();

    expect(dbMock.execute).toHaveBeenCalledTimes(1);
    expect((service as any).inFlightHandlers).toBe(1);
  });

  it('renders the atomic claim query with an IN list instead of an invalid ANY row cast', async () => {
    const { service, dbMock } = createService();

    await (service as any).claimNextInboxEvent();

    const claimSql = new PgDialect().sqlToQuery(dbMock.execute.mock.calls[0][0]);
    expect(claimSql.sql).toContain('WHERE event_type IN (');
    expect(claimSql.sql).not.toContain('ANY((');
    expect(claimSql.sql).not.toContain('::text[]');
    expect(claimSql.params[0]).toBe(900000);
    expect(claimSql.params).toContain('ProductMasterActiveVersionChanged');
    expect(claimSql.params).toContain('CoreOrderCancelled');
  });

  it('does not publish an older active-version retry after a newer product delete is present', async () => {
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) =>
        collectValues(condition).includes('ProductMasterDeleted') ? [{ id: 'delete-event-1' }] : [],
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      createdAt: new Date('2026-05-26T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });

  it('treats a failed newer lifecycle event as superseding older lifecycle retries', async () => {
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) => (collectValues(condition).includes('failed') ? [{ id: 'delete-event-1' }] : []),
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      eventOccurredAt: new Date('2026-05-26T00:00:00.000Z'),
      createdAt: new Date('2026-05-26T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });

  it('orders lifecycle superseding by event occurrence time instead of inbox insertion time', async () => {
    const { service, dbMock, syncService } = createService({
      newerEvents: (condition) =>
        collectValues(condition).includes('2026-05-26T00:00:00.000Z') ? [{ id: 'delete-event-1' }] : [],
    });
    const event = {
      id: 'active-event-1',
      eventType: 'ProductMasterActiveVersionChanged',
      aggregateId: 'master-1',
      payload: {
        masterId: 'master-1',
        versionId: 'version-1',
        changeReason: 'published',
        changedAt: '2026-05-26T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      },
      attempts: 1,
      eventOccurredAt: new Date('2026-05-26T00:00:00.000Z'),
      createdAt: new Date('2026-05-28T00:00:00.000Z'),
      metadata: { messageId: 'active-msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleActiveVersionChanged).not.toHaveBeenCalled();
    expect(dbMock.updates).toEqual([
      {
        status: 'published',
        publishedAt: new Date('2026-05-27T00:00:00.000Z'),
        errorMessage: 'Superseded by newer event (aggregateId: master-1)',
      },
    ]);
  });
});
