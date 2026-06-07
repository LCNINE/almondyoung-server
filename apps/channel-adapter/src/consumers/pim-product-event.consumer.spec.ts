import { PimProductEventConsumer } from './pim-product-event.consumer';
import { inboxEvents, processedEvents } from '../schema';

type DbState = {
  processed: Array<Record<string, any>>;
  inbox: Array<Record<string, any>>;
};

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

function matchesProcessedCondition(row: Record<string, any>, condition: unknown): boolean {
  const values = collectValues(condition);
  const matchesIdempotencyKey = row.idempotencyKey ? values.includes(row.idempotencyKey) : false;
  const matchesLegacyTuple = [row.source, row.eventType, row.resourceId, row.eventVersion].every((value) =>
    values.includes(value),
  );

  return matchesIdempotencyKey || matchesLegacyTuple;
}

function makeDb(state: DbState, options: { failInboxInsert?: boolean } = {}) {
  const db: any = {
    select: jest.fn(() => ({
      from: (table: unknown) => ({
        where: (condition: unknown) => ({
          limit: () =>
            table === processedEvents
              ? state.processed.filter((row) => matchesProcessedCondition(row, condition)).slice(0, 1)
              : [],
        }),
      }),
    })),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn((value: Record<string, any>) => {
        if (table === processedEvents) {
          return {
            onConflictDoNothing: jest.fn(() => ({
              returning: jest.fn(() => {
                const hasTupleConflict = state.processed.some(
                  (row) =>
                    row.source === value.source &&
                    row.eventType === value.eventType &&
                    row.resourceId === value.resourceId &&
                    row.eventVersion === value.eventVersion,
                );

                if (hasTupleConflict) {
                  return [];
                }

                state.processed.push(value);
                return [{ eventVersion: value.eventVersion }];
              }),
            })),
          };
        }

        if (table === inboxEvents && options.failInboxInsert) {
          throw new Error('inbox insert failed');
        }
        if (table === inboxEvents) {
          state.inbox.push(value);
        }
        return Promise.resolve(undefined);
      }),
    })),
  };
  db.transaction = jest.fn(async (callback: (tx: typeof db) => Promise<unknown>) => {
    const processedBefore = [...state.processed];
    const inboxBefore = [...state.inbox];

    try {
      return await callback(db);
    } catch (error) {
      state.processed = processedBefore;
      state.inbox = inboxBefore;
      throw error;
    }
  });

  return db;
}

describe('PimProductEventConsumer product event idempotency', () => {
  it('deduplicates active-version events by messageId, so a same-version rollback with a new messageId is enqueued', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);
    const payload = {
      masterId: 'master-1',
      versionId: 'version-1',
      name: 'Lip Tint',
      previousActiveVersionId: 'version-2',
      categoryIds: [],
      primaryCategoryId: null,
      changeReason: 'rollback' as const,
      changedAt: '2026-06-07T00:00:00.000Z',
      snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
    };

    await consumer.onProductMasterActiveVersionChanged(
      { messageId: 'msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any,
      payload as any,
    );
    state.processed = [];
    await consumer.onProductMasterActiveVersionChanged(
      { messageId: 'msg-2', correlationId: 'corr-2', chainId: 'chain-2' } as any,
      payload as any,
    );

    expect(state.inbox).toHaveLength(2);
    expect(state.inbox[0].metadata.messageId).toBe('msg-1');
    expect(state.inbox[1].metadata.messageId).toBe('msg-2');
    expect(state.processed[0].idempotencyKey).toBe('products.events.v1:ProductMasterActiveVersionChanged:msg-2');
  });

  it('uses the documented aggregate fallback when messageId is missing', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);

    await consumer.onProductMasterActiveVersionChanged(
      { correlationId: 'corr-1' } as any,
      {
        masterId: 'master-1',
        versionId: 'version-1',
        name: 'Lip Tint',
        previousActiveVersionId: null,
        changeReason: 'published',
        changedAt: '2026-06-07T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      } as any,
    );

    expect(state.processed[0].idempotencyKey).toBe(
      'products.events.v1:ProductMasterActiveVersionChanged:master-1:version-1:published:2026-06-07T00:00:00.000Z',
    );
    expect(state.processed[0].eventVersion).toMatch(/^fallback:[a-f0-9]{40}$/);
    expect(state.processed[0].eventVersion).toHaveLength(49);
  });

  it('skips a redelivered active-version event when only the legacy processed tuple exists', async () => {
    const state: DbState = {
      processed: [
        {
          idempotencyKey: 'master-1:version-1:ProductMasterActiveVersionChanged',
          source: 'products.events.v1',
          eventType: 'ProductMasterActiveVersionChanged',
          resourceId: 'master-1',
          eventVersion: 'legacy-msg-1',
          status: 'PROCESSED',
        },
      ],
      inbox: [],
    };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);

    await consumer.onProductMasterActiveVersionChanged(
      { messageId: 'legacy-msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any,
      {
        masterId: 'master-1',
        versionId: 'version-1',
        name: 'Lip Tint',
        previousActiveVersionId: null,
        changeReason: 'published',
        changedAt: '2026-06-07T00:00:00.000Z',
        snapshot: { masterId: 'master-1', versionId: 'version-1', version: 1, name: 'Lip Tint', variants: [] },
      } as any,
    );

    expect(state.processed).toHaveLength(1);
    expect(state.inbox).toHaveLength(0);
  });

  it('stores ProductMasterDeleted in the inbox using event-instance idempotency', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state);
    const consumer = new PimProductEventConsumer({ db } as any);

    await consumer.onProductMasterDeleted(
      { messageId: 'delete-msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any,
      {
        masterId: 'master-1',
        deletedAt: '2026-06-07T00:00:00.000Z',
      } as any,
    );

    expect(state.processed[0]).toEqual(
      expect.objectContaining({
        idempotencyKey: 'products.events.v1:ProductMasterDeleted:delete-msg-1',
        eventVersion: 'delete-msg-1',
      }),
    );
    expect(state.inbox[0]).toEqual(
      expect.objectContaining({
        eventType: 'ProductMasterDeleted',
        aggregateType: 'Product',
        aggregateId: 'master-1',
        partitionKey: 'master-1',
      }),
    );
  });

  it('rolls back the ProductMasterDeleted processed marker when the inbox row is not durable', async () => {
    const state: DbState = { processed: [], inbox: [] };
    const db = makeDb(state, { failInboxInsert: true });
    const consumer = new PimProductEventConsumer({ db } as any);

    await expect(
      consumer.onProductMasterDeleted(
        { messageId: 'delete-msg-1', correlationId: 'corr-1', chainId: 'chain-1' } as any,
        {
          masterId: 'master-1',
          deletedAt: '2026-06-07T00:00:00.000Z',
        } as any,
      ),
    ).rejects.toThrow('inbox insert failed');

    expect(state.processed).toHaveLength(0);
    expect(state.inbox).toHaveLength(0);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
