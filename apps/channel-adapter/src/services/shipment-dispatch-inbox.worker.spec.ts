import type { ShipmentEventOrder, ShipmentShippedPayload } from '@packages/event-contracts/streams';
import { ShipmentDispatchInboxWorker } from './shipment-dispatch-inbox.worker';

function collectConditionValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || value === undefined) return [];
  if (value instanceof Date) return [value.toISOString()];
  if (typeof value !== 'object') return [value];
  if (seen.has(value)) return [];
  seen.add(value);
  return Object.values(value as Record<string, unknown>).flatMap((item) => collectConditionValues(item, seen));
}

const SHIPPED: ShipmentShippedPayload = {
  shipmentId: '11111111-1111-4111-8111-111111111111',
  dispatchAttemptId: '22222222-2222-4222-8222-222222222222',
  attemptNo: 1,
  warehouseId: '33333333-3333-4333-8333-333333333333',
  dispatchedAt: '2026-07-14T00:00:00.000Z',
  invoice: {
    invoiceId: '44444444-4444-4444-8444-444444444444',
    carrier: 'HANJIN',
    trackingNo: 'TRACK-1',
  },
  orders: [],
};

function makeOrder(
  salesChannel: ShipmentEventOrder['salesChannel'],
  overrides: Partial<ShipmentEventOrder> = {},
): ShipmentEventOrder {
  return {
    salesOrderId:
      salesChannel === 'coupang' ? '66666666-6666-4666-8666-666666666666' : '55555555-5555-4555-8555-555555555555',
    fulfillmentOrderId: '77777777-7777-4777-8777-777777777777',
    salesChannel,
    channelOrderId: salesChannel === 'coupang' ? '9001' : '1000000001',
    isPartial: false,
    lines: [
      {
        shipmentLineId: '88888888-8888-4888-8888-888888888888',
        fulfillmentOrderItemId: '99999999-9999-4999-8999-999999999999',
        salesOrderLineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        channelOrderItemId: salesChannel === 'coupang' ? '3001' : '100000001',
        skuId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        qty: 1,
        isPartialQuantity: false,
      },
    ],
    ...overrides,
  };
}

function makeOperation(order: ShipmentEventOrder, operation = 'dispatch') {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    dispatchAttemptId: SHIPPED.dispatchAttemptId,
    shipmentId: SHIPPED.shipmentId,
    salesOrderId: order.salesOrderId,
    operation,
    channel: order.salesChannel,
    externalOrderId: order.channelOrderId,
    providerIdempotencyKey: `shipment:${SHIPPED.dispatchAttemptId}:${order.salesOrderId}:${operation}`,
    requestSnapshot: { eventType: 'ShipmentShipped', payload: { ...SHIPPED, orders: [order] }, order },
    status: 'processing',
    attempts: 1,
  } as any;
}

function makeWorker() {
  const naverExecute = jest.fn().mockResolvedValue({ success: true, data: { provider: 'naver' } });
  const coupangExecute = jest.fn().mockResolvedValue({ success: true, data: { provider: 'coupang' } });
  const factory = {
    getAdapter: jest.fn((channel: string) => ({
      executeCommand: channel === 'naver_smartstore' ? naverExecute : coupangExecute,
    })),
  };
  const medusaClient = { updateOrderShipmentAttemptProjection: jest.fn().mockResolvedValue(undefined) };
  const advisoryExecute = jest.fn().mockResolvedValue([]);
  const transaction = jest.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
    callback({ execute: advisoryExecute }),
  );
  const worker = new ShipmentDispatchInboxWorker({ db: { transaction } } as any, factory as any, medusaClient as any);
  return { worker, factory, naverExecute, coupangExecute, medusaClient, transaction, advisoryExecute };
}

describe('ShipmentDispatchInboxWorker routing', () => {
  it('accepts an internal shipment fact without creating a channel operation', async () => {
    const { worker, factory } = makeWorker();
    const internal = worker as unknown as {
      ensureOperations(
        inboxEventId: string,
        eventType: 'ShipmentShipped',
        payload: ShipmentShippedPayload,
      ): Promise<void>;
    };

    await expect(internal.ensureOperations('inbox-internal', 'ShipmentShipped', SHIPPED)).resolves.toBeUndefined();

    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('routes each mixed-channel order to exactly its own adapter with external IDs', async () => {
    const { worker, factory, naverExecute, coupangExecute } = makeWorker();
    const naverOrder = makeOrder('naver');
    const coupangOrder = makeOrder('coupang');

    await (worker as any).executeOperation(makeOperation(naverOrder));
    await (worker as any).executeOperation(makeOperation(coupangOrder));

    expect(factory.getAdapter.mock.calls).toEqual([['naver_smartstore'], ['coupang']]);
    expect(naverExecute).toHaveBeenCalledTimes(1);
    expect(naverExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `shipment:${SHIPPED.dispatchAttemptId}:${naverOrder.salesOrderId}:dispatch`,
        orderId: naverOrder.channelOrderId,
        items: [{ orderItemId: naverOrder.lines[0].channelOrderItemId, quantity: 1 }],
      }),
    );
    expect(coupangExecute).toHaveBeenCalledTimes(1);
    expect(coupangExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `shipment:${SHIPPED.dispatchAttemptId}:${coupangOrder.salesOrderId}:dispatch`,
        orderId: coupangOrder.channelOrderId,
        items: [{ orderItemId: coupangOrder.lines[0].channelOrderItemId, quantity: 1 }],
      }),
    );
  });

  it('marks unsupported Naver partial-line quantity dispatch for manual adjustment', async () => {
    const { worker, factory } = makeWorker();
    const base = makeOrder('naver', { isPartial: true });
    const order = { ...base, lines: [{ ...base.lines[0], isPartialQuantity: true }] };

    const result = await (worker as any).executeOperation(makeOperation(order));

    expect(result).toEqual(
      expect.objectContaining({ manual: true, reason: expect.stringContaining('partial-quantity') }),
    );
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('allows a partial order made of whole-line quantities for a multi-tracking provider', async () => {
    const { worker, naverExecute } = makeWorker();
    const order = makeOrder('naver', { isPartial: true });

    const result = await (worker as any).executeOperation(makeOperation(order));

    expect(result).toEqual(expect.objectContaining({ manual: false }));
    expect(naverExecute).toHaveBeenCalledTimes(1);
  });

  it('never reports unsupported provider recall as success', async () => {
    const { worker, factory } = makeWorker();
    const order = makeOrder('coupang');
    const operation = makeOperation(order, 'recall');
    operation.requestSnapshot = {
      eventType: 'ShipmentDispatchRecalled',
      payload: {
        shipmentId: SHIPPED.shipmentId,
        dispatchAttemptId: SHIPPED.dispatchAttemptId,
        attemptNo: 1,
        recallOperationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        recalledAt: '2026-07-14T01:00:00.000Z',
      },
    };

    const result = await (worker as any).executeOperation(operation);

    expect(result).toEqual(expect.objectContaining({ manual: true, reason: expect.stringContaining('recall') }));
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('projects Medusa shipment attempts without calling a legacy adapter', async () => {
    const { worker, factory, medusaClient } = makeWorker();
    const order = makeOrder('medusa', { channelOrderId: 'order_medusa_1', isPartial: true });

    const result = await (worker as any).executeOperation(makeOperation(order));

    expect(result).toEqual({ manual: false, result: { projected: true } });
    expect(factory.getAdapter).not.toHaveBeenCalled();
    expect(medusaClient.updateOrderShipmentAttemptProjection).toHaveBeenCalledWith(
      'order_medusa_1',
      expect.objectContaining({ operation: 'dispatch', order }),
    );
  });

  it('quarantines unsupported 3PL routing as an operator-visible manual operation', async () => {
    const { worker, factory } = makeWorker();
    const order = makeOrder('3pl', { channelOrderId: '3pl-order-1' });

    const result = await (worker as any).executeOperation(makeOperation(order));

    expect(result).toEqual(expect.objectContaining({ manual: true, reason: expect.stringContaining('3PL') }));
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('classifies malformed provider identities as manual before any provider call', async () => {
    const { worker, factory } = makeWorker();
    const order = makeOrder('coupang', { channelOrderId: 'not-a-number' });

    const result = await (worker as any).executeOperation(makeOperation(order));

    expect(result).toEqual(expect.objectContaining({ manual: true, reason: expect.stringContaining('invalid') }));
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('fails a provider result instead of recording a false success', async () => {
    const { worker, naverExecute } = makeWorker();
    const order = makeOrder('naver');
    naverExecute.mockResolvedValueOnce({ success: false, errors: [{ message: 'provider rejected' }] });

    await expect((worker as any).executeOperation(makeOperation(order))).rejects.toThrow('provider rejected');
  });

  it('skips an already-succeeded per-order operation after a worker restart', async () => {
    const { worker, factory } = makeWorker();
    const operation = makeOperation(makeOrder('naver'));
    operation.status = 'succeeded';

    await (worker as any).processOperation(operation);

    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('serializes Medusa projection with a database advisory transaction lock', async () => {
    const { worker, transaction, advisoryExecute, medusaClient } = makeWorker();
    const order = makeOrder('medusa', { channelOrderId: 'order_medusa_1' });

    await (worker as any).executeOperation(makeOperation(order));

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(advisoryExecute).toHaveBeenCalledTimes(1);
    expect(medusaClient.updateOrderShipmentAttemptProjection).toHaveBeenCalledTimes(1);
  });
});

function makeDurableOperationWorker(
  operation: any,
  options: { failProviderAckOnce?: boolean; reconciliationApplied?: boolean } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const conditions: unknown[] = [];
  let providerAckFailed = false;
  const update = jest.fn(() => ({
    set: jest.fn((values: Record<string, unknown>) => ({
      where: jest.fn((condition: unknown) => {
        updates.push(values);
        conditions.push(condition);
        const shouldFail =
          options.failProviderAckOnce && values.status === 'provider_acknowledged' && !providerAckFailed;
        if (shouldFail) providerAckFailed = true;
        const completed = (shouldFail ? Promise.reject(new Error('provider ack write failed')) : Promise.resolve()) as
          | (Promise<void> & { returning: () => Promise<any[]> })
          | any;
        completed.returning = async () => [
          {
            ...operation,
            ...values,
            attempts: values.attempts ? Number(operation.attempts ?? 0) + 1 : operation.attempts,
          },
        ];
        return completed;
      }),
    })),
  }));
  const adapterExecute = jest.fn().mockResolvedValue({ success: true, data: {} });
  const reconcileCommand = jest.fn().mockResolvedValue({
    applied: options.reconciliationApplied ?? false,
    evidence: { trackingMatched: options.reconciliationApplied ?? false },
  });
  const factory = { getAdapter: jest.fn(() => ({ executeCommand: adapterExecute, reconcileCommand })) };
  const worker = new ShipmentDispatchInboxWorker(
    { db: { update } } as any,
    factory as any,
    { updateOrderShipmentAttemptProjection: jest.fn() } as any,
  );
  return { worker, updates, conditions, factory, adapterExecute, reconcileCommand };
}

describe('ShipmentDispatchInboxWorker durable operation recovery', () => {
  it('reclaims an expired processing operation with a fresh bounded lease', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T01:00:00.000Z'));
    try {
      const order = makeOrder('naver');
      const operation = {
        ...makeOperation(order),
        status: 'processing',
        leaseExpiresAt: new Date('2026-07-14T00:59:00.000Z'),
      };
      const { worker, updates, conditions } = makeDurableOperationWorker(operation);

      await (worker as any).processOperation(operation);

      expect(updates[0]).toEqual(
        expect.objectContaining({
          status: 'processing',
          processingStartedAt: new Date('2026-07-14T01:00:00.000Z'),
          leaseExpiresAt: new Date('2026-07-14T01:05:00.000Z'),
        }),
      );
      expect(updates).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'provider_acknowledged' })]));
      expect(collectConditionValues(conditions[0])).toEqual(
        expect.arrayContaining(['processing', '2026-07-14T01:00:00.000Z']),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('resumes after a crash following durable provider acknowledgement without a second provider call', async () => {
    const order = makeOrder('naver');
    const operation = makeOperation(order);
    operation.status = 'pending';
    operation.attempts = 0;
    const { worker, updates, adapterExecute } = makeDurableOperationWorker(operation);
    const finalize = jest
      .spyOn(worker as any, 'finalizeProviderAcknowledgement')
      .mockRejectedValueOnce(new Error('simulated crash'))
      .mockResolvedValueOnce(undefined);

    await expect((worker as any).processOperation(operation)).rejects.toThrow('simulated crash');
    expect(updates).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'provider_acknowledged' })]));

    await (worker as any).processOperation({ ...operation, status: 'provider_acknowledged' });

    expect(adapterExecute).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(2);
  });

  it('reconciles provider state after provider success but before the DB acknowledgement write', async () => {
    const order = makeOrder('naver');
    const operation = { ...makeOperation(order), status: 'pending', attempts: 0 };
    const { worker, adapterExecute, reconcileCommand } = makeDurableOperationWorker(operation, {
      failProviderAckOnce: true,
      reconciliationApplied: true,
    });

    await expect((worker as any).processOperation(operation)).rejects.toThrow('provider ack write failed');
    expect(adapterExecute).toHaveBeenCalledTimes(1);

    operation.status = 'processing';
    operation.attempts = 1;
    operation.leaseExpiresAt = new Date(0);
    await (worker as any).processOperation(operation);

    expect(reconcileCommand).toHaveBeenCalledTimes(1);
    expect(adapterExecute).toHaveBeenCalledTimes(1);
  });

  it.each(['FulfillmentProgressed', 'FulfillmentReopened'] as const)(
    'terminally acknowledges %s so the inbox cannot accumulate an unowned backlog',
    async (eventType) => {
      const { worker, updates, factory } = makeDurableOperationWorker({});
      await worker.processClaimedEvent({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        eventType,
        payload: {} as any,
      });

      expect(updates).toEqual([expect.objectContaining({ status: 'published', errorMessage: null })]);
      expect(factory.getAdapter).not.toHaveBeenCalled();
    },
  );
});
