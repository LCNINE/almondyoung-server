import { InboxWorkerService } from './inbox-worker.service';
import type { ProductSellableQuantityChangedPayload } from '@packages/event-contracts/streams/inventory.stream';

function createDbMock(newerEvents: unknown[] = []) {
  const updates: any[] = [];
  const limit = jest.fn().mockResolvedValue(newerEvents);
  const where = jest.fn(() => ({ limit }));
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

  function createService(params?: { syncError?: Error; maxRetries?: number }) {
    const dbMock = createDbMock();
    const syncService = {
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
});
