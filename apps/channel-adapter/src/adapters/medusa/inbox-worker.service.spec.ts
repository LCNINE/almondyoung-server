import { InboxWorkerService } from './inbox-worker.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || value === undefined) return [];
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
    db: { select, update },
    updates,
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
  }) {
    const dbMock = createDbMock(params?.newerEvents);
    const syncService = {
      handleActiveVersionChanged: jest.fn().mockResolvedValue(undefined),
      handleProductMasterDeleted: jest.fn().mockResolvedValue(undefined),
      handleProductSellableQuantityChanged: params?.syncError
        ? jest.fn().mockRejectedValue(params.syncError)
        : jest.fn().mockResolvedValue(undefined),
    };
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'INBOX_POLL_INTERVAL_MS') return 5000;
        if (key === 'INBOX_BATCH_SIZE') return 10;
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
      { status: 'processing' },
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
      attempts: 0,
      createdAt: new Date('2026-05-27T00:00:00.000Z'),
      metadata: { messageId: 'msg-1', chainId: 'chain-1' },
    };

    await (service as any).doProcessInboxEvent(event);

    expect(syncService.handleProductSellableQuantityChanged).toHaveBeenCalledWith(payload);
    expect(dbMock.updates[0]).toEqual({ status: 'processing' });
    expect(dbMock.updates[1]).toEqual({
      status: 'pending',
      attempts: 1,
      errorMessage: 'Medusa API down',
      nextAttemptAt: new Date('2026-05-27T00:00:02.000Z'),
    });
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
});
