import { OrderPollerOrchestrator } from './order-poller.orchestrator';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  ChannelOrderProvider,
  OrderCollectionFailureItem,
  OrderFetchItem,
} from './channel-order-provider.interface';

describe('OrderPollerOrchestrator', () => {
  it('does not create a duplicate Core order when a Medusa order changes from authorized to captured', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z')], failures: [] }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(inbox.enqueue).toHaveBeenCalledTimes(1);
    expect(inbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCreated',
        aggregateId: 'medusa_order_1',
      }),
      expect.anything(),
    );
    expect(db.mappings.size).toBe(1);
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledTimes(2);
  });

  it('quarantines collected Medusa order modifications instead of emitting OrderModified', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({
          orders: [makeOrder('2026-05-26T01:10:00.000Z', { totalAmount: 12000 })],
          failures: [],
        })
        .mockResolvedValueOnce({
          orders: [makeOrder('2026-05-26T01:10:00.000Z', { totalAmount: 12000 })],
          failures: [],
        }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();
    await orchestrator.poll();

    expect(inbox.enqueue).toHaveBeenCalledTimes(1);
    expect(inbox.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderModified' }),
      expect.anything(),
    );
    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
    expect(failures.recordFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'medusa_order_1',
        reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
      }),
      expect.anything(),
    );
  });

  it('does not advance the polling watermark when processing fails before completion', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockRejectedValue(new Error('enqueue failed')) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', { message: 'enqueue failed' });
    expect(syncStatus.lastSyncAt()).toBeNull();
    expect(db.mappings.size).toBe(0);
  });

  it('rewinds the existing watermark by two minutes when fetching incremental orders', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }),
    };
    const syncStatus = makeSyncStatus(new Date('2026-05-26T01:10:00.000Z'));
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    expect(provider.fetchOrders).toHaveBeenCalledWith(new Date('2026-05-26T01:08:00.000Z'));
  });

  it('uses the mapping insert as the OrderCreated idempotency gate', async () => {
    const db = makeDb({ conflictOnInsert: true });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    expect(inbox.enqueue).not.toHaveBeenCalled();
    expect(hashes.upsert).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledWith(
      'medusa',
      'orders',
      expect.objectContaining({
        eventCount: 0,
        watermark: new Date('2026-05-26T01:00:00.000Z'),
      }),
    );
  });

  it('retains a mixed valid/invalid Medusa order as a failure without emitting OrderCreated', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    expect(inbox.enqueue).not.toHaveBeenCalled();
    expect(failures.recordFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'medusa_order_1',
        reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
        affectedLineIds: ['item_missing'],
      }),
    );
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledWith(
      'medusa',
      'orders',
      expect.objectContaining({
        eventCount: 0,
        watermark: new Date('2026-05-26T01:00:00.000Z'),
      }),
    );
    expect(failures.recordFailure.mock.invocationCallOrder[0]).toBeLessThan(
      syncStatus.recordSyncComplete.mock.invocationCallOrder[0],
    );
  });

  it('does not advance the polling watermark when failure quarantine storage fails', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    failures.recordFailure.mockRejectedValue(new Error('quarantine failed'));

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', {
      message: 'quarantine failed',
    });
    expect(syncStatus.lastSyncAt()).toBeNull();
  });
});

function makeOrder(sourceUpdatedAt: string, overrides: { totalAmount?: number } = {}): OrderFetchItem {
  const totalAmount = overrides.totalAmount ?? 10000;
  const item = {
    orderItemId: 'item_1',
    skuId: 'pim_variant_1',
    masterId: 'master_1',
    versionId: 'version_1',
    variantId: 'pim_variant_1',
    productName: 'Product',
    channelProductId: 'variant_1',
    quantity: 1,
    unitPrice: 10000,
    totalPrice: totalAmount,
  };
  const shippingAddress = {
    recipientName: 'Jane Kim',
    phone: '010-0000-0000',
    postalCode: '12345',
    roadAddress: 'Seoul',
    detailAddress: '101',
  };

  return {
    externalOrderId: 'medusa_order_1',
    sourceUpdatedAt,
    createPayload: {
      orderId: '11111111-1111-4111-8111-111111111111',
      externalOrderId: 'medusa_order_1',
      salesChannel: 'medusa',
      customerId: 'cus_1',
      items: [item],
      totalAmount,
      subtotalAmount: totalAmount,
      shippingAmount: 0,
      discountAmount: 0,
      currency: 'KRW',
      shippingAddress,
      status: 'confirmed',
      createdAt: '2026-05-26T00:00:00.000Z',
    },
    changes: {
      items: [item],
      shippingAddress,
      totalAmount,
    },
    modifiedAt: sourceUpdatedAt,
  };
}

function makeFailure(sourceUpdatedAt: string): OrderCollectionFailureItem {
  return {
    externalOrderId: 'medusa_order_1',
    sourceUpdatedAt,
    reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
    affectedLineIds: ['item_missing'],
    rawOrder: {
      id: 'medusa_order_1',
      items: [
        {
          id: 'item_valid',
          variant: { metadata: { pimVariantId: 'pim_variant_1' } },
        },
        {
          id: 'item_missing',
          variant: { metadata: {} },
        },
      ],
    },
  };
}

function makeSyncStatus(initialLastSyncAt: Date | null = null) {
  let lastSyncAt: Date | null = initialLastSyncAt;

  return {
    getSyncStatus: jest.fn().mockImplementation(async () => (lastSyncAt ? { lastSyncAt } : null)),
    recordSyncStart: jest.fn().mockResolvedValue('session-1'),
    recordSyncComplete: jest.fn().mockImplementation(async (_channel, _dataType, result) => {
      if (result.watermark !== null) {
        lastSyncAt = result.watermark ?? new Date();
      }
    }),
    recordSyncFailure: jest.fn().mockResolvedValue(undefined),
    lastSyncAt: () => lastSyncAt,
  };
}

function makeHashService() {
  const hashes = new Map<string, string>();
  const key = (source: string, resourceType: string, resourceId: string) => `${source}:${resourceType}:${resourceId}`;

  return {
    computeHash: jest.fn((content: unknown) => JSON.stringify(content)),
    getStoredHash: jest.fn(async (source: string, resourceType: string, resourceId: string) => {
      return hashes.get(key(source, resourceType, resourceId)) ?? null;
    }),
    upsert: jest.fn(async (source: string, resourceType: string, resourceId: string, hash: string) => {
      hashes.set(key(source, resourceType, resourceId), hash);
    }),
  };
}

function makeFailureService() {
  return {
    recordFailure: jest.fn(async (_channel: string, failure: OrderCollectionFailureItem) => ({
      id: 'failure_1',
      channel: 'medusa',
      externalOrderId: failure.externalOrderId,
      reason: failure.reason,
      affectedLineIds: failure.affectedLineIds,
      rawOrder: failure.rawOrder,
      sourceUpdatedAt: new Date(failure.sourceUpdatedAt),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findById: jest.fn(),
    list: jest.fn(),
    markReplayed: jest.fn(),
  };
}

function makeDb(options: { conflictOnInsert?: boolean } = {}) {
  const mappings = new Map<string, any>();
  const latestMapping = async () => Array.from(mappings.values()).slice(0, 1);
  const insert = () => ({
    values: (value: any) => ({
      onConflictDoNothing: () => ({
        returning: async () => {
          if (options.conflictOnInsert) {
            return [];
          }
          mappings.set(`${value.salesChannel}:${value.channelOrderId}`, value);
          return [value];
        },
      }),
    }),
  });

  return {
    mappings,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: latestMapping,
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const before = new Map(mappings);
        try {
          return await fn({ insert });
        } catch (error) {
          mappings.clear();
          for (const [key, value] of before.entries()) {
            mappings.set(key, value);
          }
          throw error;
        }
      },
    },
  };
}
