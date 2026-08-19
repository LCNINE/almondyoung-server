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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
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
    // 이 케이스만 mock 을 타입 지어 둔다 — 아래에서 `partitionKey` 를 실제로 읽기 때문이다.
    const outbox = {
      enqueue: jest
        .fn<Promise<void>, [{ eventType: string; aggregateId: string; partitionKey?: string }, unknown]>()
        .mockResolvedValue(undefined),
    };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(outbox.enqueue.mock.calls.map(([event]) => event)).toEqual([
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

    // 두 적재 모두 파티션 키가 **채널명**이어야 한다 (Task 6-C-3). ORDER_STREAM 에는 파생
    // 함수가 없어 생략하면 `aggregateId`(주문 UUID)로 떨어지고, 그 순간 채널 단위 순서가
    // 조용히 사라진다 — 옛 경로는 행의 `partition_key` 컬럼(= 채널명)을 Kafka 키로 썼다.
    // 이 단언이 없으면 `partitionKey` 를 지워도 스펙이 초록이다.
    expect(outbox.enqueue.mock.calls.map(([event]) => event.partitionKey)).toEqual(['medusa', 'medusa']);
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();
    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).not.toHaveBeenCalledWith(
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();
    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(3);
    expect(outbox.enqueue).toHaveBeenCalledWith(
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
    expect(outbox.enqueue).toHaveBeenCalledWith(
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
    expect(outbox.enqueue).not.toHaveBeenCalledWith(
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(outbox.enqueue).toHaveBeenCalledWith(
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(outbox.enqueue).not.toHaveBeenCalled();
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(provider.fetchOrders).toHaveBeenNthCalledWith(1, null);
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:10:00.000Z'));

    await orchestrator.poll();

    // Second poll fetches from the rewound watermark (01:10 − 2min), not from null: the
    // terminal snapshot did not freeze the watermark and the scan window keeps moving forward.
    expect(provider.fetchOrders).toHaveBeenLastCalledWith(new Date('2026-05-26T01:08:00.000Z'));
    expect(outbox.enqueue).not.toHaveBeenCalled();
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    // The order sorts ahead of its lifecycle event, so its mapping exists by the time the
    // refund is processed: both emit in order and the watermark advances to the shared
    // timestamp. A missing mapping at lifecycle time is therefore terminal UNLESS the order is
    // quarantined (covered by the next test), in which case the watermark is held instead.
    expect(outbox.enqueue.mock.calls.map(([event]) => event.eventType)).toEqual([
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    // The refund has no Core mapping yet (its order is quarantined), so it is not emitted and the
    // replay path would never reprocess it — the watermark must therefore stay at/below the
    // observation so the next poll re-fetches it once the quarantine is replayed. Critically, the
    // collected 01:05 order does NOT drag the watermark past the unrecorded refund at 01:00.
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'OrderCreated' }),
      expect.anything(),
    );
    expect(outbox.enqueue).not.toHaveBeenCalledWith(
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
    const outbox = { enqueue: jest.fn().mockRejectedValue(new Error('lifecycle enqueue failed')) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
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
    const outbox = { enqueue: jest.fn().mockRejectedValue(new Error('enqueue failed')) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(provider.fetchOrders).toHaveBeenCalledWith(new Date('2026-05-26T01:08:00.000Z'));
  });

  // #599: 이중 크론(또는 5분보다 오래 걸린 폴)이 겹치면 두 폴이 같은 옛 해시를 읽고 **둘 다**
  // 트랜잭션에 진입해 같은 사실을 두 번 발행했다. 두 이벤트는 messageId 가 달라 core 의
  // `checkAndRecordEvent` 멱등 가드가 잡지 못한다. 라이브에서 08-10 이후 8건 실측됐다.
  it('emits a lifecycle event once when two concurrent polls observe the same stale hash', async () => {
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
        lifecycleEvents: [makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await Promise.all([orchestrator.poll(), orchestrator.poll()]);

    const cancellations = outbox.enqueue.mock.calls.filter(
      ([event]: [{ eventType: string }, unknown]) => event.eventType === 'OrderCancelled',
    );
    expect(cancellations).toHaveLength(1);
  });

  // #656: `payload.orderId` 는 여기서 만든 id 라 core 의 `sales_orders.id` 가 아니다. core 가 SO 를
  // 찾을 수 있게 `OrderCreated` 와 같은 채널 키를 lifecycle 이벤트에도 실어야 한다.
  it('carries the channel key on lifecycle events so Core can resolve the sales order', async () => {
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
        lifecycleEvents: [
          makeLifecycleEvent('OrderCancelled', 'cancelled', '2026-05-26T01:00:00.000Z'),
          makeLifecycleEvent('OrderRefundCreated', 'refund:ref_1', '2026-05-26T01:05:00.000Z'),
        ],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    for (const eventType of ['OrderCancelled', 'OrderRefundCreated']) {
      expect(outbox.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType,
          payload: expect.objectContaining({
            salesChannel: 'medusa',
            externalOrderId: 'medusa_order_1',
          }),
        }),
        expect.anything(),
      );
    }
  });

  // #599: 변경 격리 경로도 해시 확인이 트랜잭션 밖이라 같은 레이스를 갖는다.
  it('quarantines a collected-order modification once when two concurrent polls observe the same stale hash', async () => {
    const db = makeDb();
    db.mappings.set('medusa:medusa_order_1', {
      salesChannel: 'medusa',
      channelOrderId: 'medusa_order_1',
      wmsOrderId: '11111111-1111-4111-8111-111111111111',
    });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [
          makeOrder('2026-05-26T01:10:00.000Z', {
            totalAmount: 12000,
            eligibleForOrderCreation: false,
          }),
        ],
        failures: [],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await Promise.all([orchestrator.poll(), orchestrator.poll()]);

    const quarantines = failures.recordFailure.mock.calls.filter(
      ([, failure]: [string, OrderCollectionFailureItem]) =>
        failure.reason === COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
    );
    expect(quarantines).toHaveLength(1);
  });

  it('uses the mapping insert as the OrderCreated idempotency gate', async () => {
    const db = makeDb({ conflictOnInsert: true });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(outbox.enqueue).not.toHaveBeenCalled();
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(outbox.enqueue).not.toHaveBeenCalled();
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    failures.recordFailure.mockRejectedValue(new Error('quarantine failed'));

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncFailure).toHaveBeenCalledWith('medusa', 'orders', {
      message: 'quarantine failed',
    });
    expect(syncStatus.lastSyncAt()).toBeNull();
  });

  // #647. 이미 Core 로 넘어간 주문이 재폴링에서 식별에 실패하는 일은 흔하다 — Medusa 는 주문
  // 라인에 상품 정보를 비정규화해 두므로, 원본 variant 가 사라지면 평면 필드만 남고 식별자는
  // 증발한다. 그 주문은 만들 것이 없으므로 격리 대상이 아니다. 격리하면 운영 큐가 조치 불가능한
  // 거짓 경보로 찬다 (실측 117건 전부가 이 경우였다).
  it('does not quarantine an identification failure for an order that is already collected', async () => {
    const db = makeDb({ collected: ['medusa_order_1'] });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(failures.recordFailure).not.toHaveBeenCalled();
    // 건너뛴 항목도 워터마크는 밀어야 한다. 안 그러면 같은 주문을 영원히 다시 집는다.
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:00:00.000Z'));
  });

  // 옛 코드가 남긴 격리는 코드 수정만으로 사라지지 않는다. 그 주문은 앞으로 계속
  // 건너뛰어지므로, 여기서 닫지 않으면 그 행을 닫아줄 경로가 영영 없다.
  it('closes a stale open quarantine when it skips an already-collected order', async () => {
    const db = makeDb({ collected: ['medusa_order_1'] });
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    failures.findOpenByExternalOrderId.mockResolvedValue({ id: 'stale_failure_1' });

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(failures.closeAsAlreadyCollected).toHaveBeenCalledWith(
      'stale_failure_1',
      expect.any(String),
      'wms_medusa_order_1',
    );
  });

  // 배치 조회가 존재하는 이유가 바로 이 경우다 — 한 폴링에 두 종류가 섞여 온다.
  it('separates already-collected failures from genuine ones within a single poll', async () => {
    const db = makeDb({ collected: ['medusa_order_1'] });
    const genuine = { ...makeFailure('2026-05-26T01:00:00.000Z'), externalOrderId: 'medusa_order_2' };
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z'), genuine],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
    expect(failures.recordFailure).toHaveBeenCalledWith(
      'medusa',
      expect.objectContaining({ externalOrderId: 'medusa_order_2' }),
    );
  });

  // 사유를 안 보면 `collected_order_modification_not_accepted` 는 정의상 항상 매핑을 갖고
  // 있으므로 그 격리 레인 전체가 조용히 죽는다.
  it('does not skip a collected-order-modification failure just because a mapping exists', async () => {
    const db = makeDb({ collected: ['medusa_order_1'] });
    const modification = {
      ...makeFailure('2026-05-26T01:00:00.000Z'),
      reason: COLLECTED_ORDER_MODIFICATION_NOT_ACCEPTED,
    };
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [modification] }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
  });

  // 매핑이 없는 진짜 미수집 주문은 그대로 격리돼야 한다 — 위 수정이 격리 자체를 죽이면 안 된다.
  it('still quarantines an identification failure for an order that was never collected', async () => {
    const db = makeDb();
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [makeFailure('2026-05-26T01:00:00.000Z')],
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(failures.recordFailure).toHaveBeenCalledTimes(1);
  });

  // #647. replay 는 같은 early-return 에 다시 걸려 `still_quarantined` 를 영원히 반환했다.
  // 운영자가 버튼을 눌러도 아무 설명 없이 같은 상태로 돌아온다. 이미 수집된 주문이면 닫아야 한다.
  it('closes the quarantine as already-collected when replaying a failure whose order is already in Core', async () => {
    const db = makeDb({ collected: ['medusa_order_1'] });
    const provider = {
      channel: 'medusa' as const,
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }),
      fetchOrder: jest.fn().mockResolvedValue({
        kind: 'failure',
        failure: makeFailure('2026-05-26T01:00:00.000Z'),
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    failures.findById.mockResolvedValue({
      id: 'failure_1',
      channel: 'medusa',
      externalOrderId: 'medusa_order_1',
      reason: CHANNEL_PRODUCT_IDENTIFICATION_FAILED,
      status: 'quarantined',
    });

    const orchestrator = new OrderPollerOrchestrator(
      [provider as any],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    const result = await orchestrator.replayFailure('failure_1');

    expect(result?.status).toBe('closed_already_collected');
    // wmsOrderId 를 함께 싣는다 — 닫은 근거다. 없으면 나중에 감사할 때 매핑 조인을 다시 돌려야 한다.
    expect(failures.closeAsAlreadyCollected).toHaveBeenCalledWith(
      'failure_1',
      expect.any(String),
      'wms_medusa_order_1',
    );
    // 다시 격리하면 status 가 quarantined 로 되돌아가 운영자가 같은 자리를 맴돈다.
    expect(failures.recordFailure).not.toHaveBeenCalled();
  });

  it('closes the quarantine as terminal when a replayed snapshot is no longer eligible for collection', async () => {
    const db = makeDb();
    const provider = {
      channel: 'medusa' as const,
      fetchOrders: jest.fn(),
      fetchOrder: jest.fn().mockResolvedValue({
        kind: 'order',
        order: makeOrder('2026-05-26T01:10:00.000Z', { eligibleForOrderCreation: false }),
      }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
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
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
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
    expect(outbox.enqueue).not.toHaveBeenCalled();
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
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const hashes = makeHashService();
    const failures = makeFailureService();
    // The durable quarantine from poll 1 is still open when poll 2 observes the cancellation.
    failures.findOpenByExternalOrderId.mockResolvedValue({ id: 'failure_q', externalOrderId: 'medusa_order_q' });

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      hashes as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    // Poll 1: refund held (no mapping, still quarantined) → not emitted, quarantine not closed.
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(failures.closeAsTerminalLifecycle).not.toHaveBeenCalled();

    await orchestrator.poll();

    // Poll 2: terminal cancel observation with an orphaned open quarantine → closed, watermark advances.
    expect(failures.closeAsTerminalLifecycle).toHaveBeenCalledWith('failure_q', expect.any(String));
    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:08:00.000Z'));
  });
});

/**
 * 채널 활성 게이트 (#654).
 *
 * ADR-0031 이 "활성화는 `sales_channels.is_active` 가 갖는다" 고 정했지만 그 자리를 물려받은
 * 코드가 없어, 채널을 비활성화해도 수집이 계속 돌았다. 여기서 막는다.
 *
 * 가장 중요한 불변식은 **건너뛴 채널의 워터마크가 전진하지 않는 것**이다. 전진해버리면 꺼둔
 * 기간의 주문을 영구히 잃는다 — 다시 켰을 때 그 구간을 되짚지 않기 때문이다.
 */
describe('OrderPollerOrchestrator — 채널 활성 게이트 (#654)', () => {
  it('비활성 채널의 주문을 가져오지 않는다', async () => {
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const syncStatus = makeSyncStatus();
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      outbox as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient([]) as any,
    );

    await orchestrator.poll();

    expect(provider.fetchOrders).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('건너뛴 채널의 워터마크를 전진시키지 않는다 — 꺼둔 기간의 주문을 잃지 않기 위한 핵심 불변식', async () => {
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }),
    };
    const before = new Date('2026-05-26T00:00:00.000Z');
    const syncStatus = makeSyncStatus(before);

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient([]) as any,
    );

    await orchestrator.poll();

    expect(syncStatus.recordSyncStart).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncComplete).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(before);
  });

  it('한 채널이 비활성이어도 활성 채널은 정상 수집한다', async () => {
    const active: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const inactive: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const orchestrator = new OrderPollerOrchestrator(
      [active, inactive],
      makeSyncStatus() as any,
      outbox as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient(['medusa']) as any,
    );

    await orchestrator.poll();

    expect(active.fetchOrders).toHaveBeenCalledTimes(1);
    expect(inactive.fetchOrders).not.toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('활성 목록 조회가 실패하면 어떤 채널도 폴링하지 않는다 (fail-closed)', async () => {
    // 건너뛰기는 무손실이다(워터마크가 안 움직인다). 반대로 열어두면 "끈 채널이 계속 도는"
    // 상태가 되는데, 그게 이 이슈가 없애려는 상태 그 자체다.
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [makeOrder('2026-05-26T01:00:00.000Z')], failures: [] }),
    };
    const before = new Date('2026-05-26T00:00:00.000Z');
    const syncStatus = makeSyncStatus(before);

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient(new Error('core unreachable')) as any,
    );

    await orchestrator.poll();

    expect(provider.fetchOrders).not.toHaveBeenCalled();
    expect(syncStatus.recordSyncStart).not.toHaveBeenCalled();
    expect(syncStatus.lastSyncAt()).toEqual(before);
  });

  it('활성 목록을 폴링당 한 번만 조회한다', async () => {
    const providers: ChannelOrderProvider[] = [
      { channel: 'medusa', fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }) },
      { channel: 'naver', fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }) },
    ];
    const client = makeSalesChannelClient(['medusa', 'naver']);

    const orchestrator = new OrderPollerOrchestrator(
      providers,
      makeSyncStatus() as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      client as any,
    );

    await orchestrator.poll();

    expect(client.getActiveSites).toHaveBeenCalledTimes(1);
  });

  // FIX D: 최초 수집 때 저장하는 해시는 `createPayload` 에서 세 값을 다시 조립해 만들었다.
  // 그것은 "createPayload.items 와 changes.items 가 항상 같다" 는 가정이었고, 취소된 라인이
  // 이미 있는 주문에서 깨진다 — 계약에는 살아있는 라인만, 해시에는 전 라인이 들어가기 때문.
  // 그러면 두 번째 폴링이 구조적으로 다른 입력을 보고 오격리한다.
  it('최초 수집 때 이미 취소된 라인이 있어도 두 번째 폴링이 오격리하지 않는다 (FIX D)', async () => {
    const db = makeDb();
    const order = makeOrderWithCancelledLine('2026-05-26T01:00:00.000Z');
    const provider: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [order], failures: [] })
        .mockResolvedValueOnce({ orders: [makeOrderWithCancelledLine('2026-05-26T01:10:00.000Z')], failures: [] }),
    };
    const failures = makeFailureService();

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      makeSyncStatus() as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      failures as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(failures.recordFailure).not.toHaveBeenCalled();
  });

  // 같은 FIX D 의 Medusa 쪽 대칭 근거: Medusa 는 취소 라인이 없어 두 입력이 같은 값이므로
  // 저장되는 해시가 바이트 단위로 바뀌지 않는다. 그 사실을 직접 못 박는다.
  it('Medusa 주문에서는 createPayload 유래 해시와 changes 유래 해시가 같은 값이다 (FIX D 무영향 근거)', async () => {
    const db = makeDb();
    const item = makeOrder('2026-05-26T01:00:00.000Z');
    const hashes = makeHashService();

    const orchestrator = new OrderPollerOrchestrator(
      [{ channel: 'medusa', fetchOrders: jest.fn().mockResolvedValue({ orders: [item], failures: [] }) }],
      makeSyncStatus() as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      hashes as any,
      makeFailureService() as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    const legacyInput = {
      items: item.createPayload.items,
      shippingAddress: item.createPayload.shippingAddress,
      totalAmount: item.createPayload.totalAmount,
    };
    expect(hashes.stored('medusa', 'order', 'medusa_order_1')).toBe(hashes.computeHash(legacyInput));
  });

  // FIX E: 관측의 정체성은 payload 가 아니라 `eventKey` 다. 네이버 부분취소는 형제 라인이 바뀔
  // 때마다 `cancelledAt` 이 따라 움직여, payload 해시로 판정하면 같은 취소가 매 주기 재발행되고
  // Core 는 `remaining = 0` 으로 BadRequestException → DLQ 를 만든다.
  it('payload 가 흔들려도 같은 eventKey 의 관측은 한 번만 발행한다 (FIX E)', async () => {
    const db = makeDb();
    db.mappings.set('naver:medusa_order_1', {
      salesChannel: 'naver',
      channelOrderId: 'medusa_order_1',
      wmsOrderId: '11111111-1111-4111-8111-111111111111',
    });
    const first = makeLifecycleEvent('OrderCancelled', 'cancelled:po-1', '2026-05-26T01:00:00.000Z');
    // 형제 라인이 바뀌어 sourceUpdatedAt(=cancelledAt) 만 움직인 같은 취소.
    const second = makeLifecycleEvent('OrderCancelled', 'cancelled:po-1', '2026-05-26T01:05:00.000Z');
    const provider: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest
        .fn()
        .mockResolvedValueOnce({ orders: [], failures: [], lifecycleEvents: [first] })
        .mockResolvedValueOnce({ orders: [], failures: [], lifecycleEvents: [second] }),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      makeSyncStatus() as any,
      outbox as any,
      makeHashService() as any,
      makeFailureService() as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    const cancellations = outbox.enqueue.mock.calls.filter(
      ([event]: [{ eventType: string }, unknown]) => event.eventType === 'OrderCancelled',
    );
    expect(cancellations).toHaveLength(1);
  });

  it('eventKey 가 다르면 별개의 관측으로 각각 발행한다 (FIX E — 라인 단위 취소가 뭉개지지 않는다)', async () => {
    const db = makeDb();
    db.mappings.set('naver:medusa_order_1', {
      salesChannel: 'naver',
      channelOrderId: 'medusa_order_1',
      wmsOrderId: '11111111-1111-4111-8111-111111111111',
    });
    const provider: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [],
        lifecycleEvents: [
          makeLifecycleEvent('OrderCancelled', 'cancelled:po-1', '2026-05-26T01:00:00.000Z'),
          makeLifecycleEvent('OrderCancelled', 'cancelled:po-2', '2026-05-26T01:00:00.000Z'),
        ],
      }),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      makeSyncStatus() as any,
      outbox as any,
      makeHashService() as any,
      makeFailureService() as any,
      db as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(
      outbox.enqueue.mock.calls.filter(([event]: [{ eventType: string }, unknown]) => event.eventType === 'OrderCancelled'),
    ).toHaveLength(2);
  });

  // FIX F: 닫힌 창(`[since, since+24h]`)에 변경이 하나도 없으면 워터마크가 `null` 로 남고
  // `recordSyncComplete` 가 `lastSyncAt` 을 건드리지 않는다 — 다음 주기가 같은 창을 다시 묻는다.
  // 조용한 24시간 하나가 수집을 영구히 정지시킨다.
  it('변경 0건이어도 완료한 닫힌 창의 끝까지 워터마크를 전진시킨다 (FIX F)', async () => {
    const windowEnd = new Date('2026-05-27T00:00:00.000Z');
    const syncStatus = makeSyncStatus(new Date('2026-05-26T00:00:00.000Z'));
    const provider: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [],
        failures: [],
        lifecycleEvents: [],
        completedWindowEnd: windowEnd,
      }),
    };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();
    await orchestrator.poll();

    expect(syncStatus.lastSyncAt()).toEqual(windowEnd);
    // 두 번째 폴은 같은 닫힌 창이 아니라 그 뒤에서 다시 시작해야 한다 (2분 되감기 포함).
    expect(provider.fetchOrders).toHaveBeenLastCalledWith(new Date('2026-05-26T23:58:00.000Z'));
  });

  it('창의 끝을 보고하지 않는 source(Medusa)는 변경 0건에서 워터마크가 그대로다 (FIX F 무영향 근거)', async () => {
    const before = new Date('2026-05-26T00:00:00.000Z');
    const syncStatus = makeSyncStatus(before);
    const provider: ChannelOrderProvider = {
      channel: 'medusa',
      fetchOrders: jest.fn().mockResolvedValue({ orders: [], failures: [] }),
    };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(syncStatus.lastSyncAt()).toEqual(before);
  });

  it('항목이 있으면 창의 끝이 아니라 항목의 시각이 워터마크다 (FIX F 가 항목 경로를 건드리지 않는다)', async () => {
    const syncStatus = makeSyncStatus(new Date('2026-05-26T00:00:00.000Z'));
    const provider: ChannelOrderProvider = {
      channel: 'naver',
      fetchOrders: jest.fn().mockResolvedValue({
        orders: [makeOrder('2026-05-26T01:00:00.000Z')],
        failures: [],
        completedWindowEnd: new Date('2026-05-27T00:00:00.000Z'),
      }),
    };

    const orchestrator = new OrderPollerOrchestrator(
      [provider],
      syncStatus as any,
      { enqueue: jest.fn().mockResolvedValue(undefined) } as any,
      makeHashService() as any,
      makeFailureService() as any,
      makeDb() as any,
      makeSalesChannelClient(['medusa', 'naver']) as any,
    );

    await orchestrator.poll();

    expect(syncStatus.lastSyncAt()).toEqual(new Date('2026-05-26T01:00:00.000Z'));
  });
});

/** 활성 사이트 목록을 주는 Core 클라이언트의 목. Error 를 주면 조회 실패를 흉내낸다. */
function makeSalesChannelClient(sitesOrError: string[] | Error) {
  return {
    getActiveSites: jest.fn().mockImplementation(async () => {
      if (sitesOrError instanceof Error) throw sitesOrError;
      return sitesOrError;
    }),
  };
}

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

/**
 * 최초 수집 시점에 **이미 취소된 라인이 있는** 주문 (네이버 부분취소). 계약(`createPayload.items`)
 * 에는 살아있는 라인만, 해시 입력(`changes.items`)에는 전 라인이 들어간다 — 두 값이 다르다는
 * 것이 요점이고, 그 차이를 무시한 채 `createPayload` 로 최초 해시를 만들면 다음 폴링이
 * 오격리한다. 총액도 마찬가지로 계약은 실판매분, 해시는 전 라인이다.
 */
function makeOrderWithCancelledLine(sourceUpdatedAt: string): OrderFetchItem {
  const shippingAddress = {
    recipientName: 'Jane Kim',
    phone: '010-0000-0000',
    postalCode: '12345',
    roadAddress: 'Seoul',
    detailAddress: '101',
  };
  const live = {
    orderItemId: 'po-1',
    skuId: 'pim_variant_1',
    masterId: 'master_1',
    versionId: 'version_1',
    variantId: 'pim_variant_1',
    productName: 'Product',
    channelProductId: 'naver_product_1',
    quantity: 1,
    unitPrice: 10000,
    totalPrice: 10000,
  };
  const cancelled = { ...live, orderItemId: 'po-2', quantity: 1, unitPrice: 3000, totalPrice: 3000 };

  return {
    externalOrderId: 'medusa_order_1',
    sourceUpdatedAt,
    eligibleForOrderCreation: true,
    createPayload: {
      orderId: '11111111-1111-4111-8111-111111111111',
      externalOrderId: 'medusa_order_1',
      salesChannel: 'naver',
      customerId: null,
      items: [live],
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
      items: [live, cancelled],
      shippingAddress,
      totalAmount: 13000,
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
    // 조건부 갱신(CAS) 의 목. **검사와 기록 사이에 await 가 없다** — 그것이 요점이다.
    // JS 는 단일 스레드라 await 없는 구간은 원자적이고, 이것이 Postgres 의
    // `INSERT … ON CONFLICT DO UPDATE … WHERE hash <> excluded.hash RETURNING` 과 같은 성질이다.
    claimChanged: jest.fn(async (source: string, resourceType: string, resourceId: string, hash: string) => {
      const k = key(source, resourceType, resourceId);
      if (hashes.get(k) === hash) return false;
      hashes.set(k, hash);
      return true;
    }),
    // 처음 본 자원일 때만 선점하는 목 (`INSERT … ON CONFLICT DO NOTHING RETURNING`).
    // 위와 마찬가지로 **검사와 기록 사이에 await 가 없다** — 그것이 원자성의 근거다.
    claimFirstSeen: jest.fn(async (source: string, resourceType: string, resourceId: string, hash: string) => {
      const k = key(source, resourceType, resourceId);
      if (hashes.has(k)) return false;
      hashes.set(k, hash);
      return true;
    }),
    stored: (source: string, resourceType: string, resourceId: string) =>
      hashes.get(key(source, resourceType, resourceId)) ?? null,
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
    closeAsAlreadyCollected: jest.fn().mockResolvedValue(undefined),
  };
}

function makeDb(options: { conflictOnInsert?: boolean; collected?: string[] } = {}) {
  const mappings = new Map<string, any>();
  // 이 폴링 이전에 이미 존재하던 매핑. **배치 조회에만** 보인다.
  //
  // 왜 분리하는가: 이 목은 drizzle SQL 객체를 들여다볼 수 없어 술어를 흉내낼 수 없고,
  // 단건 조회(`.limit(1)`)는 어떤 id 를 물었든 첫 행을 돌려준다. 시드 행을 같은 통에 넣으면
  // `collected: ['A']` 를 심은 테스트가 주문 B 를 처리할 때 B 가 A 의 매핑을 얻어, 틀린
  // 동작이 초록으로 통과한다. 배치 조회 결과는 호출부가 id 로 다시 거르므로 안전하다.
  const preexisting = (options.collected ?? []).map((channelOrderId) => ({
    salesChannel: 'medusa',
    channelOrderId,
    wmsOrderId: `wms_${channelOrderId}`,
  }));
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
          // `.limit()` = 단건 매핑 조회(이 폴링에서 만들어진 것만),
          // `await where()` = 배치 매핑 조회(시드 포함).
          where: () =>
            Object.assign(Promise.resolve([...preexisting, ...Array.from(mappings.values())]), {
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
