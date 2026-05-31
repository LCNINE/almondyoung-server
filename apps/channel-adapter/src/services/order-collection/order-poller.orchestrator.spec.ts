import { OrderPollerOrchestrator } from './order-poller.orchestrator';
import {
  CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
  COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
  ChannelOrderProvider,
  OrderCollectionFailureItem,
  OrderFetchItem,
  OrderLifecycleEventItem,
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
        aggregateId: '11111111-1111-4111-8111-111111111111',
      }),
      expect.anything(),
    );
    expect(db.mappings.size).toBe(1);
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledTimes(2);
  });

  it('uses one Core order aggregate for creation and lifecycle events observed in the same batch', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [makeOrder('2026-05-26T01:00:00.000Z')],
        failures: [],
        lifecycleEvents: [makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-05-26T01:00:00.000Z')],
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

    expect(inbox.enqueue).toHaveBeenCalledTimes(2);
    expect(inbox.enqueue.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        eventType: 'OrderCreated',
        aggregateId: '11111111-1111-4111-8111-111111111111',
      }),
      expect.objectContaining({
        eventType: 'OrderCancelled',
        aggregateId: '11111111-1111-4111-8111-111111111111',
        payload: expect.objectContaining({
          orderId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    ]);
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

  it('emits collected Medusa cancellation and refund lifecycle events separately from order modifications', async () => {
    const db = makeDb();
    const lifecycleEvents = [
      makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-05-26T01:10:00.000Z'),
      makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', '2026-05-26T01:10:00.000Z'),
    ];
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z')], failures: [], lifecycleEvents })
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:10:00.000Z')], failures: [], lifecycleEvents }),
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

    expect(inbox.enqueue).toHaveBeenCalledTimes(3);
    expect(inbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderCancelled',
        aggregateId: '11111111-1111-4111-8111-111111111111',
        payload: expect.objectContaining({
          orderId: '11111111-1111-4111-8111-111111111111',
          reason: 'ADMIN_CANCEL',
        }),
      }),
      expect.anything(),
    );
    expect(inbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'OrderRefundCreated',
        aggregateId: '11111111-1111-4111-8111-111111111111',
        payload: expect.objectContaining({
          orderId: '11111111-1111-4111-8111-111111111111',
          refundId: 'ref_1',
        }),
      }),
      expect.anything(),
    );
    expect(inbox.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderModified' }),
      expect.anything(),
    );
    expect(failures.recordFailure).not.toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({ reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED }),
      expect.anything(),
    );
  });

  it('still quarantines contract changes observed with refunded Medusa lifecycle snapshots', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({
          orders: [
            makeOrder('2026-05-26T01:10:00.000Z', {
              totalAmount: 12000,
              eligibleForOrderCreation: false,
            }),
          ],
          failures: [],
          lifecycleEvents: [makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', '2026-05-26T01:10:00.000Z')],
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

    expect(inbox.enqueue).toHaveBeenCalledTimes(2);
    expect(inbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderRefundCreated' }),
      expect.anything(),
    );
    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
    expect(failures.recordFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'medusa_order_1',
        reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
        rawOrder: expect.objectContaining({
          changes: expect.objectContaining({ totalAmount: 12000 }),
        }),
      }),
      expect.anything(),
    );
  });

  it('quarantines refunded Medusa snapshots even when concrete refund rows are delayed', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] })
        .mockResolvedValueOnce({
          orders: [
            makeOrder('2026-05-26T01:10:00.000Z', {
              totalAmount: 12000,
              eligibleForOrderCreation: false,
            }),
          ],
          failures: [],
          lifecycleEvents: [],
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

    expect(inbox.enqueue).toHaveBeenCalledTimes(1);
    expect(failures.recordFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({
        externalOrderId: 'medusa_order_1',
        reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
        rawOrder: expect.objectContaining({
          changes: expect.objectContaining({ totalAmount: 12000 }),
        }),
      }),
      expect.anything(),
    );
  });

  it('does not create a Core order from an uncollected lifecycle-only Medusa snapshot but advances the watermark', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [makeOrder('2026-05-26T01:10:00.000Z', { eligibleForOrderCreation: false })],
        failures: [],
        lifecycleEvents: [makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', '2026-05-26T01:10:00.000Z')],
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
    expect(db.mappings.size).toBe(0);
    expect(failures.recordFailure).not.toHaveBeenCalled();
    // The snapshot is terminal (never collectable), so the watermark advances past it instead
    // of pinning the poller to this timestamp forever.
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledWith(
      'medusa',
      'orders',
      expect.objectContaining({
        eventCount: 0,
        watermark: new Date('2026-05-26T01:10:00.000Z'),
      }),
    );
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:10:00.000Z'));
  });

  it('does not stall the incremental window on a repeating uncollected lifecycle-only snapshot', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [makeOrder('2026-05-26T01:10:00.000Z', { eligibleForOrderCreation: false })],
        failures: [],
        lifecycleEvents: [makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', '2026-05-26T01:10:00.000Z')],
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

    expect(provider.fetchOrders).toHaveBeenNthCalledWith(1, null);
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:10:00.000Z'));

    await orchestrator.poll();

    // Second poll fetches from the rewound watermark (01:10 − 2min), not from null: the
    // terminal snapshot did not freeze the watermark and the scan window keeps moving forward.
    expect(provider.fetchOrders).toHaveBeenLastCalledWith(new Date('2026-05-26T01:08:00.000Z'));
    expect(inbox.enqueue).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:10:00.000Z'));
  });

  it('processes an order before its own lifecycle events sharing a timestamp, then advances the watermark', async () => {
    const db = makeDb();
    const sourceUpdatedAt = '2026-05-26T01:10:00.000Z';
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [makeOrder(sourceUpdatedAt)],
        failures: [],
        lifecycleEvents: [makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', sourceUpdatedAt)],
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

    // The order sorts ahead of its lifecycle event, so its mapping exists by the time the
    // refund is processed: both emit in order and the watermark advances to the shared
    // timestamp. A missing mapping at lifecycle time is therefore terminal UNLESS the order is
    // quarantined (covered by the next test), in which case the watermark is held instead.
    expect(inbox.enqueue.mock.calls.map(([event]) => event.eventType)).toEqual([
      'OrderCreated',
      'OrderRefundCreated',
    ]);
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:10:00.000Z'));
  });

  it('holds the watermark on a lifecycle event observed for a still-quarantined order', async () => {
    const db = makeDb();
    const quarantinedFailure: OrderCollectionFailureItem = {
      externalOrderId: 'medusa_order_quarantined',
      sourceUpdatedAt: '2026-05-26T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['item_missing'],
      rawOrder: { id: 'medusa_order_quarantined' },
    };
    const quarantinedRefund: OrderLifecycleEventItem = {
      externalOrderId: 'medusa_order_quarantined',
      sourceUpdatedAt: '2026-05-26T01:00:00.000Z',
      eventType: 'OrderRefundCreated',
      eventKey: 'refund:ref_q',
      payload: {
        refundId: 'ref_q',
        paymentId: 'pay_q',
        amount: 5000,
        currency: 'KRW',
        reason: 'MEDUSA_REFUND',
        createdBy: 'medusa',
        createdAt: '2026-05-26T01:00:00.000Z',
      },
      rawEvent: { externalOrderId: 'medusa_order_quarantined', refundId: 'ref_q' },
    };
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        // A different, collectable order at a LATER timestamp would normally push the watermark
        // forward — the hold must keep it pinned below the unrecorded refund at 01:00.
        orders: [makeOrder('2026-05-26T01:05:00.000Z')],
        failures: [quarantinedFailure],
        lifecycleEvents: [quarantinedRefund],
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

    // The refund has no Core mapping yet (its order is quarantined), so it is not emitted and the
    // replay path would never reprocess it — the watermark must therefore stay at/below the
    // observation so the next poll re-fetches it once the quarantine is replayed. Critically, the
    // collected 01:05 order does NOT drag the watermark past the unrecorded refund at 01:00.
    expect(inbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderCreated' }),
      expect.anything(),
    );
    expect(inbox.enqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderRefundCreated' }),
      expect.anything(),
    );
    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
    expect(syncStatus.recordSyncComplete).toHaveBeenCalledWith(
      'medusa',
      'orders',
      expect.objectContaining({ watermark: new Date('2026-05-26T01:00:00.000Z') }),
    );
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:00:00.000Z'));
  });

  it('does not advance the polling watermark when lifecycle recording fails', async () => {
    const db = makeDb();
    db.mappings.set('medusa:medusa_order_1', {
      salesChannel: 'medusa',
      channelOrderId: 'medusa_order_1',
      wmsOrderId: '11111111-1111-4111-8111-111111111111',
    });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [],
        lifecycleEvents: [makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-05-26T01:10:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockRejectedValue(new Error('lifecycle enqueue failed')) };
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
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', {
      message: 'lifecycle enqueue failed',
    });
    expect(syncStatus.lastSyncAt()).toBeNull();
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

  it('closes the quarantine as terminal when a replayed snapshot is no longer eligible for collection', async () => {
    const db = makeDb();
    const provider = {
      channel: 'medusa',
      fetchOrders: jest.fn(),
      fetchOrder: jest.fn().mockResolvedValue({
        kind: 'order',
        order: makeOrder('2026-05-26T01:10:00.000Z', { eligibleForOrderCreation: false }),
      }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    failures.findById.mockResolvedValue({
      id: 'failure_1',
      channel: 'medusa',
      externalOrderId: 'medusa_order_1',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['item_missing'],
      rawOrder: {},
      sourceUpdatedAt: new Date('2026-05-26T01:00:00.000Z'),
      status: 'quarantined',
      replayedAt: null,
      replayedWmsOrderId: null,
      errorMessage: null,
      createdAt: new Date('2026-05-26T01:00:00.000Z'),
      updatedAt: new Date('2026-05-26T01:00:00.000Z'),
    });

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    const result = await orchestrator.replayFailure('failure_1');

    // The order went terminal (canceled/refunded) since it was quarantined, so it can never be
    // collected. Replaying must close the quarantine instead of leaving the operator stuck on a
    // perpetually still_quarantined record.
    expect(result).toMatchObject({
      status: 'closed_terminal',
      failureId: 'failure_1',
      externalOrderId: 'medusa_order_1',
      emitted: 0,
      dedupedUnchanged: 0,
    });
    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('failure_1', expect.any(String));
    expect(inbox.enqueue).not.toHaveBeenCalled();
    expect(failures.markReplayed).not.toHaveBeenCalled();
  });

  it('holds the watermark, then closes the orphaned quarantine once it goes terminal across polls', async () => {
    const db = makeDb();
    // Poll 1: still eligible but missing pimVariant → quarantined (failure) + a refund observation.
    // Poll 2: the same order is now canceled → no longer surfaced as a failure, just a terminal
    // OrderCancelled observation. The orphaned quarantine from poll 1 must be closed.
    const quarantinedFailure: OrderCollectionFailureItem = {
      externalOrderId: 'medusa_order_q',
      sourceUpdatedAt: '2026-05-26T01:00:00.000Z',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      affectedLineIds: ['item_missing'],
      rawOrder: { id: 'medusa_order_q' },
    };
    const refundObservation: OrderLifecycleEventItem = {
      externalOrderId: 'medusa_order_q',
      sourceUpdatedAt: '2026-05-26T01:00:00.000Z',
      eventType: 'OrderRefundCreated',
      eventKey: 'refund:ref_q',
      payload: {
        refundId: 'ref_q',
        paymentId: 'pay_q',
        amount: 5000,
        currency: 'KRW',
        reason: 'MEDUSA_REFUND',
        createdBy: 'medusa',
        createdAt: '2026-05-26T01:00:00.000Z',
      },
      rawEvent: { externalOrderId: 'medusa_order_q', refundId: 'ref_q' },
    };
    const cancelObservation: OrderLifecycleEventItem = {
      externalOrderId: 'medusa_order_q',
      sourceUpdatedAt: '2026-05-26T01:08:00.000Z',
      eventType: 'OrderCancelled',
      eventKey: 'cancelled',
      payload: {
        reason: 'ADMIN_CANCEL',
        reasonDetail: 'Medusa order lifecycle collected',
        cancelledBy: 'medusa',
        cancelledAt: '2026-05-26T01:08:00.000Z',
        refundRequired: false,
      },
      rawEvent: { externalOrderId: 'medusa_order_q', status: 'canceled' },
    };
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest
        .fn()
        // Poll 1: re-quarantined this batch → hold the refund observation.
        .mockResolvedValueOnce({ orders: [], failures: [quarantinedFailure], lifecycleEvents: [refundObservation] })
        // Poll 2: no longer a failure (canceled → ineligible), just a terminal cancel observation.
        .mockResolvedValueOnce({ orders: [], failures: [], lifecycleEvents: [cancelObservation] }),
    };
    const syncStatus = makeSyncStatus();
    const inbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    // The durable quarantine from poll 1 is still open when poll 2 observes the cancellation.
    failures.findOpenByExternalOrderId.mockResolvedValue({ id: 'failure_q', externalOrderId: 'medusa_order_q' });

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      inbox as any,
      hashes as any,
      failures as any,
      db as any,
    );

    await orchestrator.poll();

    // Poll 1: refund held (no mapping, still quarantined) → not emitted, quarantine not closed.
    expect(inbox.enqueue).not.toHaveBeenCalled();
    expect(failures.closeAsTerminalLifecycle).not.toHaveBeenCalled();

    await orchestrator.poll();

    // Poll 2: terminal cancel observation with an orphaned open quarantine → closed, watermark advances.
    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('failure_q', expect.any(String));
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:08:00.000Z'));
  });
});

function makeOrder(
  sourceUpdatedAt: string,
  overrides: { totalAmount?: number; eligibleForOrderCreation?: boolean } = {},
): OrderFetchItem {
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
    eligibleForOrderCreation: overrides.eligibleForOrderCreation,
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

function makeLifecycleEvent(
  eventType: 'OrderCancelled' | 'OrderRefundCreated',
  eventKey: string,
  sourceUpdatedAt: string,
): OrderLifecycleEventItem {
  if (eventType === 'OrderCancelled') {
    return {
      externalOrderId: 'medusa_order_1',
      sourceUpdatedAt,
      eventType,
      eventKey,
      payload: {
        reason: 'ADMIN_CANCEL',
        reasonDetail: 'Medusa order lifecycle collected',
        cancelledBy: 'medusa',
        cancelledAt: sourceUpdatedAt,
        refundRequired: true,
        refundAmount: 10000,
      },
      rawEvent: {
        externalOrderId: 'medusa_order_1',
        status: 'canceled',
      },
    };
  }

  return {
    externalOrderId: 'medusa_order_1',
    sourceUpdatedAt,
    eventType,
    eventKey,
    payload: {
      refundId: 'ref_1',
      paymentId: 'pay_1',
      amount: 10000,
      currency: 'KRW',
      reason: 'MEDUSA_REFUND',
      createdBy: 'medusa',
      createdAt: sourceUpdatedAt,
    },
    rawEvent: {
      externalOrderId: 'medusa_order_1',
      refundId: 'ref_1',
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
    findOpenByExternalOrderId: jest.fn().mockResolvedValue(null),
    closeAsTerminalLifecycle: jest.fn().mockResolvedValue(undefined),
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
