import { OrderPollerOrchestrator } from './order-poller.orchestrator';
import type { ChannelOrderProvider, OrderFetchItem } from './channel-order-provider.interface';

describe('OrderPollerOrchestrator', () => {
  it('does not create a duplicate Core order when a Medusa order changes from authorized to captured', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], skipped: 0 })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z')], skipped: 0 }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
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

  it('does not advance the polling watermark when processing fails before completion', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], skipped: 0 }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockRejectedValue(new Error('enqueue failed')) };
    const hashes = makeHashService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      db as any,
    );

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', { message: 'enqueue failed' });
    expect(syncStatus.lastSyncAt()).toBeNull();
    expect(db.mappings.size).toBe(0);
  });

  it('uses the mapping insert as the OrderCreated idempotency gate', async () => {
    const db = makeDb({ conflictOnInsert: true });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], skipped: 0 }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
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
});

function makeOrder(sourceUpdatedAt: string): OrderFetchItem {
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
    totalPrice: 10000,
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
      totalAmount: 10000,
      subtotalAmount: 10000,
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
      totalAmount: 10000,
    },
    modifiedAt: sourceUpdatedAt,
  };
}

function makeSyncStatus() {
  let lastSyncAt: Date | null = null;

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
