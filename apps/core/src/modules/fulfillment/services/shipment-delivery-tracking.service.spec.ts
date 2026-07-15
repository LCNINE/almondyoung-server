/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { ShipmentDeliveryTrackingService } from './shipment-delivery-tracking.service';

const attemptId = '22222222-2222-4222-8222-222222222222';
const shipmentId = '11111111-1111-4111-8111-111111111111';
const fulfillmentOrderId = '66666666-6666-4666-8666-666666666666';
const salesOrderId = '55555555-5555-4555-8555-555555555555';
const occurredAt = '2026-07-15T04:05:06.000Z';

type UpdateCapture = { table: unknown; values?: unknown };

function makeHarness(selectResults: unknown[][], insertResults: unknown[][] = [[]]) {
  const queuedSelects = [...selectResults];
  const queuedInserts = [...insertResults];
  const updates: UpdateCapture[] = [];
  const insertedValues: Array<{ table: unknown; values: unknown }> = [];

  const query = (rows: unknown[]) => {
    const builder: any = {
      from: jest.fn(() => builder),
      innerJoin: jest.fn(() => builder),
      leftJoin: jest.fn(() => builder),
      where: jest.fn(() => builder),
      orderBy: jest.fn(() => builder),
      limit: jest.fn(() => Promise.resolve(rows)),
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  };
  const tx: any = {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn(() => query(queuedSelects.shift() ?? [])),
    selectDistinct: jest.fn(() => query(queuedSelects.shift() ?? [])),
    insert: jest.fn((table: unknown) => {
      const capture = { table, values: undefined as unknown };
      insertedValues.push(capture);
      const builder: any = {
        values: jest.fn((values: unknown) => {
          capture.values = values;
          return builder;
        }),
        onConflictDoNothing: jest.fn(() => builder),
        returning: jest.fn(() => Promise.resolve(queuedInserts.shift() ?? [])),
      };
      return builder;
    }),
    update: jest.fn((table: unknown) => {
      const capture: UpdateCapture = { table };
      updates.push(capture);
      const builder: any = {
        set: jest.fn((values: unknown) => {
          capture.values = values;
          return builder;
        }),
        where: jest.fn(() => Promise.resolve(undefined)),
      };
      return builder;
    }),
  };
  const db = { run: jest.fn((fn: (trx: unknown) => unknown) => fn(tx)) };
  const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const shipmentReservations = { lockShipmentGraphForDispatch: jest.fn().mockResolvedValue(undefined) };
  const service = new ShipmentDeliveryTrackingService(
    db as never,
    outbox as never,
    workflowGate as never,
    shipmentReservations as never,
  );
  return { service, tx, outbox, workflowGate, shipmentReservations, updates, insertedValues };
}

const attempt = {
  id: attemptId,
  shipmentId,
  attemptNo: 2,
  status: 'dispatched',
  idempotencyKey: 'dispatch-command-2',
  invoiceId: '44444444-4444-4444-8444-444444444444',
  stockJournalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reversalJournalId: null,
  dispatchedAt: new Date('2026-07-14T04:05:06.000Z'),
  carrierAcceptedAt: null,
  recalledAt: null,
  recoveryCode: null,
  createdAt: new Date('2026-07-14T04:05:06.000Z'),
  updatedAt: new Date('2026-07-14T04:05:06.000Z'),
};

describe('ShipmentDeliveryTrackingService', () => {
  it('records delivery for the referenced attempt, emits attempt event, and never mutates FO state', async () => {
    const { service, tx, outbox, workflowGate, shipmentReservations, updates, insertedValues } = makeHarness(
      [
        [],
        [{ shipmentId }],
        [attempt],
        [{ status: 'shipped' }],
        [{ id: attemptId }],
        [{ fulfillmentOrderId }],
        [{ id: 'full-shipped-outbox' }],
        [
          { id: attemptId, status: 'dispatched' },
          { id: '33333333-3333-4333-8333-333333333333', status: 'dispatched' },
        ],
        [
          { dispatchAttemptId: attemptId, timestamp: new Date(occurredAt) },
          {
            dispatchAttemptId: '33333333-3333-4333-8333-333333333333',
            timestamp: new Date('2026-07-15T05:05:06.000Z'),
          },
        ],
        [{ salesOrderId, channelOrderId: 'NAVER-ORDER-1' }],
      ],
      [[{ id: 'tracking-1' }]],
    );

    await expect(
      service.recordProviderEvent(attemptId, {
        providerEventId: 'provider-delivered-1',
        status: 'delivered',
        occurredAt,
        location: 'Seoul',
      }),
    ).resolves.toEqual({
      shipmentId,
      dispatchAttemptId: attemptId,
      providerEventId: 'provider-delivered-1',
      status: 'delivered',
      replayed: false,
    });

    expect(insertedValues).toContainEqual({
      table: wmsTables.shipmentTracking,
      values: expect.objectContaining({ dispatchAttemptId: attemptId, shipmentId, status: 'delivered' }),
    });
    expect(updates).toEqual([
      {
        table: wmsTables.dispatchAttempts,
        values: expect.objectContaining({ carrierAcceptedAt: new Date(occurredAt) }),
      },
      {
        table: wmsTables.shipments,
        values: expect.objectContaining({ status: 'delivered', deliveredAt: new Date(occurredAt) }),
      },
    ]);
    expect(updates.some((update) => update.table === wmsTables.fulfillmentOrders)).toBe(false);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ eventType: 'ShipmentDelivered', idempotencyKey: attemptId }),
      expect.anything(),
    );
    expect(tx.execute).toHaveBeenCalledTimes(2);
    expect(shipmentReservations.lockShipmentGraphForDispatch).toHaveBeenCalledWith(shipmentId, tx);
    expect(workflowGate.assertV2MutationAllowed).toHaveBeenCalledWith('shipment.tracking.record');
    expect(outbox.enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'FulfillmentDelivered',
        idempotencyKey: `${fulfillmentOrderId}:fully-delivered`,
        payload: expect.objectContaining({ deliveredAt: '2026-07-15T05:05:06.000Z' }),
      }),
      expect.anything(),
    );
  });

  it('does not emit V1 delivery until full-shipped projection and every non-recalled attempt are delivered', async () => {
    const otherAttemptId = '33333333-3333-4333-8333-333333333333';
    const { service, outbox } = makeHarness(
      [
        [],
        [{ shipmentId }],
        [attempt],
        [{ status: 'shipped' }],
        [{ id: attemptId }],
        [{ fulfillmentOrderId }],
        [{ id: 'full-shipped-outbox' }],
        [
          { id: attemptId, status: 'dispatched' },
          { id: otherAttemptId, status: 'dispatched' },
        ],
        [{ dispatchAttemptId: attemptId, timestamp: new Date(occurredAt) }],
      ],
      [[{ id: 'tracking-1' }]],
    );

    await service.recordProviderEvent(attemptId, {
      providerEventId: 'provider-delivered-partial',
      status: 'delivered',
      occurredAt,
    });

    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'ShipmentDelivered' }),
      expect.anything(),
    );
  });

  it('treats only an exact provider event replay as a no-op', async () => {
    const existing = {
      id: 'tracking-1',
      shipmentId,
      dispatchAttemptId: attemptId,
      providerEventId: 'provider-delivered-1',
      status: 'delivered',
      location: 'Seoul',
      timestamp: new Date(occurredAt),
    };
    const exact = makeHarness([[existing]]);
    await expect(
      exact.service.recordProviderEvent(attemptId, {
        providerEventId: 'provider-delivered-1',
        status: 'delivered',
        occurredAt,
        location: 'Seoul',
      }),
    ).resolves.toEqual(expect.objectContaining({ replayed: true }));
    expect(exact.outbox.enqueue).not.toHaveBeenCalled();
    expect(exact.updates).toHaveLength(0);

    const conflicting = makeHarness([[existing]]);
    await expect(
      conflicting.service.recordProviderEvent(attemptId, {
        providerEventId: 'provider-delivered-1',
        status: 'in_transit',
        occurredAt,
        location: 'Seoul',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('fails closed for recalled attempts so a late old webhook cannot complete a redispatched shipment', async () => {
    const { service, outbox, updates, insertedValues } = makeHarness([
      [],
      [{ shipmentId }],
      [{ ...attempt, status: 'recalled', recalledAt: new Date('2026-07-15T03:00:00.000Z') }],
    ]);

    await expect(
      service.recordProviderEvent(attemptId, {
        providerEventId: 'late-old-attempt',
        status: 'delivered',
        occurredAt,
      }),
    ).rejects.toThrow(ConflictException);
    expect(insertedValues).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects carrier evidence whose occurrence time predates dispatch', async () => {
    const { service, outbox, updates } = makeHarness([[], [{ shipmentId }], [attempt]]);

    await expect(
      service.recordProviderEvent(attemptId, {
        providerEventId: 'provider-before-dispatch',
        status: 'in_transit',
        occurredAt: '2026-07-13T04:05:06.000Z',
      }),
    ).rejects.toThrow(ConflictException);
    expect(updates).toHaveLength(0);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('rejects blank provider identity and invalid occurrence time before opening a transaction', async () => {
    const blank = makeHarness([]);
    await expect(
      blank.service.recordProviderEvent(attemptId, {
        providerEventId: '   ',
        status: 'in_transit',
        occurredAt,
      }),
    ).rejects.toThrow('providerEventId');
    expect(blank.tx.select).not.toHaveBeenCalled();

    const invalidTime = makeHarness([]);
    await expect(
      invalidTime.service.recordProviderEvent(attemptId, {
        providerEventId: 'provider-invalid-time',
        status: 'in_transit',
        occurredAt: 'not-a-date',
      }),
    ).rejects.toThrow('occurredAt');
    expect(invalidTime.tx.select).not.toHaveBeenCalled();
  });

  it('moves carrierAcceptedAt backward when an earlier out-of-order carrier event arrives', async () => {
    const laterAcceptance = new Date('2026-07-15T05:00:00.000Z');
    const earlierEvidence = '2026-07-15T03:00:00.000Z';
    const { service, updates } = makeHarness(
      [
        [],
        [{ shipmentId }],
        [{ ...attempt, carrierAcceptedAt: laterAcceptance }],
        [{ status: 'in_transit' }],
        [{ id: attemptId }],
      ],
      [[{ id: 'tracking-earlier' }]],
    );

    await service.recordProviderEvent(attemptId, {
      providerEventId: 'provider-earlier-evidence',
      status: 'in_transit',
      occurredAt: earlierEvidence,
    });

    expect(updates[0]).toEqual({
      table: wmsTables.dispatchAttempts,
      values: expect.objectContaining({ carrierAcceptedAt: new Date(earlierEvidence) }),
    });
  });
});
