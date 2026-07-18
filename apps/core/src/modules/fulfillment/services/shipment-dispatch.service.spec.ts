/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-misused-promises */
import { ForbiddenException } from '@nestjs/common';
import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ShipmentDispatchService } from './shipment-dispatch.service';

const FORCE_AUTHORIZATION = Object.freeze({
  scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
  granted: true as const,
  [SCOPE_AUTHORIZATION_DECISION_BRAND]: true as const,
});

const IDS = {
  shipment: '00000000-0000-4000-8000-000000000001',
  line: '00000000-0000-4000-8000-000000000002',
  foi: '00000000-0000-4000-8000-000000000003',
  fo: '00000000-0000-4000-8000-000000000004',
  so: '00000000-0000-4000-8000-000000000005',
  sol: '00000000-0000-4000-8000-000000000006',
  sku: '00000000-0000-4000-8000-000000000007',
  warehouse: '00000000-0000-4000-8000-000000000008',
  source: '00000000-0000-4000-8000-000000000009',
  extraSource: '00000000-0000-4000-8000-000000000011',
  waybill: '00000000-0000-4000-8000-00000000000a',
  session: '00000000-0000-4000-8000-00000000000b',
  workItem: '00000000-0000-4000-8000-00000000000c',
  batch: '00000000-0000-4000-8000-00000000000d',
  plan: '00000000-0000-4000-8000-00000000000e',
  actor: '00000000-0000-4000-8000-00000000000f',
  balance: '00000000-0000-4000-8000-000000000010',
};

class Query<T = any> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}
  from(): this {
    return this;
  }
  innerJoin(): this {
    return this;
  }
  leftJoin(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  for(): this {
    return this;
  }
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class Mutation implements PromiseLike<any[]> {
  values: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  setValue: Record<string, unknown> | null = null;
  constructor(private readonly returningRows: any[] = []) {}
  set(value: Record<string, unknown>): this {
    this.setValue = value;
    return this;
  }
  where(): this {
    return this;
  }
  returning(): this {
    return this;
  }
  onConflictDoNothing(): this {
    return this;
  }
  then<TResult1 = any[], TResult2 = never>(
    onfulfilled?: ((value: any[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.returningRows).then(onfulfilled, onrejected);
  }
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.line,
    shipmentId: IDS.shipment,
    fulfillmentOrderItemId: IDS.foi,
    skuId: IDS.sku,
    qty: 2,
    reservedQty: 2,
    inspectedQty: 1,
    lineVersion: 1,
    createdFromLineId: null,
    forced: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function aggregate(overrides: Record<string, unknown> = {}) {
  return {
    shipment: {
      id: IDS.shipment,
      warehouseId: IDS.warehouse,
      status: 'planned',
      manifestVersion: 1,
      reservationVersion: 1,
      recipientSnapshot: { recipientName: 'Test' },
    },
    lines: [line()],
    waybill: {
      id: IDS.waybill,
      shipmentId: IDS.shipment,
      source: 'manual',
      status: 'registered',
      carrier: 'HANJIN',
      trackingNo: 'TRACK-1',
      manifestVersion: 1,
      recipientHash: 'a'.repeat(64),
    },
    session: { id: IDS.session, batchId: IDS.batch, status: 'active' },
    workItem: {
      id: IDS.workItem,
      batchId: IDS.batch,
      shipmentId: IDS.shipment,
      status: 'packing',
      packerId: IDS.actor,
      packerClaimedAt: new Date(),
      packerReleasedAt: null,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
    planId: IDS.plan,
    ...overrides,
  } as any;
}

function makeService() {
  const tx = {
    update: jest.fn(() => new Mutation()),
    insert: jest.fn(() => {
      const mutation = new Mutation();
      return {
        ...mutation,
        values: (value: any) => {
          mutation.values = value;
          return mutation;
        },
      };
    }),
  } as any;
  const commands = {
    execute: jest.fn(async (_input: unknown, handler: any) => {
      const result = await handler(tx, 'command-1', 'hash');
      return result.response;
    }),
  };
  const inventory = { ship: jest.fn().mockResolvedValue({ eventId: 'stock-event-1' }) };
  const sessions = { moveCustody: jest.fn().mockResolvedValue({}), settleForDispatch: jest.fn().mockResolvedValue({}) };
  const shipmentReservations = {
    lockShipmentGraphForDispatch: jest.fn(),
    consumeForDispatch: jest.fn().mockResolvedValue({ affectedSkuIds: [IDS.sku] }),
    finalizeDispatchConsumption: jest.fn().mockResolvedValue(undefined),
  };
  const waybills = {
    assertDispatchable: jest.fn().mockResolvedValue(undefined),
    markUsed: jest.fn().mockResolvedValue(undefined),
  };
  const barcode = { parseBarcode: jest.fn() };
  const outbox = { enqueue: jest.fn().mockResolvedValue({}) };
  const audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const service = new ShipmentDispatchService(
    {} as any,
    commands as any,
    inventory as any,
    sessions as any,
    shipmentReservations as any,
    waybills as any,
    barcode as any,
    outbox as any,
    audit as any,
    workflowGate as any,
  );
  return { service, tx, commands, inventory, sessions, shipmentReservations, waybills, outbox, audit };
}

describe('ShipmentDispatchService', () => {
  it('dispatches on the last valid inspection scan in the same command transaction', async () => {
    const { service, tx, sessions } = makeService();
    const locked = aggregate();
    jest.spyOn(service as any, 'lockAggregate').mockResolvedValue(locked);
    jest.spyOn(service as any, 'resolveInspectionLine').mockResolvedValue(locked.lines[0]);
    jest.spyOn(service as any, 'moveInspectionCustody').mockResolvedValue(undefined);
    const dispatch = jest.spyOn(service as any, 'dispatchLocked').mockResolvedValue({
      shipmentId: IDS.shipment,
      status: 'shipped',
      dispatchAttemptId: 'attempt-1',
      attemptNo: 1,
    });

    const result = await service.inspectionScan(IDS.shipment, {
      barcode: `SKU-${IDS.sku}`,
      quantity: 1,
      actor: { id: IDS.actor, roles: ['logistics_worker'] },
      idempotencyKey: 'scan-last',
    });

    expect(result).toMatchObject({ status: 'shipped', inspectedQty: 2, dispatchAttemptId: 'attempt-1' });
    expect(dispatch).toHaveBeenCalledWith(locked, expect.objectContaining({ id: IDS.actor }), tx);
    expect(sessions.settleForDispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch a partial inspection scan', async () => {
    const { service } = makeService();
    const locked = aggregate({ lines: [line({ qty: 3, inspectedQty: 0 })] });
    jest.spyOn(service as any, 'lockAggregate').mockResolvedValue(locked);
    jest.spyOn(service as any, 'resolveInspectionLine').mockResolvedValue(locked.lines[0]);
    jest.spyOn(service as any, 'moveInspectionCustody').mockResolvedValue(undefined);
    const dispatch = jest.spyOn(service as any, 'dispatchLocked');

    await expect(
      service.inspectionScan(IDS.shipment, {
        barcode: `SKU-${IDS.sku}`,
        quantity: 1,
        actor: { id: IDS.actor, roles: ['logistics_worker'] },
        idempotencyKey: 'scan-partial',
      }),
    ).resolves.toMatchObject({ status: 'inspecting', inspectedQty: 1, dispatchAttemptId: null });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('fills and durably flags forced inspection quantities before using the common dispatch path', async () => {
    const { service, tx } = makeService();
    const locked = aggregate({ lines: [line({ qty: 4, inspectedQty: 1 })] });
    jest.spyOn(service as any, 'lockAggregate').mockResolvedValue(locked);
    const moved = jest.spyOn(service as any, 'moveInspectionCustody').mockResolvedValue(undefined);
    const dispatch = jest.spyOn(service as any, 'dispatchLocked').mockResolvedValue({
      shipmentId: IDS.shipment,
      status: 'shipped',
      dispatchAttemptId: 'attempt-1',
      attemptNo: 1,
      forcedQuantities: [{ shipmentLineId: IDS.line, quantity: 3 }],
    });

    await service.forceDispatch(IDS.shipment, {
      reason: 'damaged scanner',
      csCaseId: 'case-1',
      note: 'approved by shift lead',
      actor: { id: IDS.actor, roles: ['logistics_manager'] },
      idempotencyKey: 'force-1',
      authorization: FORCE_AUTHORIZATION,
    });

    expect(moved).toHaveBeenCalledWith(IDS.session, locked.lines[0], 3, IDS.actor, 'force:force-1', tx);
    expect(locked.lines[0]).toMatchObject({ inspectedQty: 4, forced: true, lineVersion: 2 });
    expect(dispatch).toHaveBeenCalledWith(
      locked,
      expect.objectContaining({ id: IDS.actor }),
      tx,
      expect.objectContaining({ forcedQuantities: [{ shipmentLineId: IDS.line, quantity: 3 }] }),
    );
  });

  it('rejects a direct force call without the ScopeGuard decision even for a familiar raw role', async () => {
    const { service, commands } = makeService();
    await expect(
      service.forceDispatch(IDS.shipment, {
        reason: 'try bypass',
        actor: { id: IDS.actor, roles: ['logistics_manager'] },
        idempotencyKey: 'force-denied',
        authorization: undefined,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('emits internal shipment progress without fabricating an external order or v1 completion', async () => {
    const { service, outbox } = makeService();
    const locked = aggregate();

    await (service as any).emitDispatchEvents(
      locked,
      IDS.extraSource,
      1,
      new Date('2026-07-15T00:00:00.000Z'),
      [],
      [
        {
          fulfillmentOrderId: IDS.fo,
          salesOrderId: null,
          shippedQty: 2,
          canceledQty: 0,
          outstandingQty: 0,
          fullyShipped: true,
          items: [{ id: IDS.foi, skuId: IDS.sku, shippedQty: 2 }],
        },
      ],
      {} as any,
    );

    expect(outbox.enqueue.mock.calls.map(([event]: any[]) => [event.topic, event.payload.orders])).toEqual([
      ['shipments.events.v1', []],
      ['fulfillments.events.v2', undefined],
    ]);
    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
  });

  it('redispatches a recalled shipment with attempt 2, a new waybill, exact stock sources and typed outbox', async () => {
    const { service, inventory, sessions, shipmentReservations, waybills, outbox, audit } = makeService();
    const locked = aggregate({ lines: [line({ qty: 2, inspectedQty: 2, forced: true, lineVersion: 2 })] });
    const recipientHash = locked.waybill.recipientHash;

    const queryRows = [
      [{ shipmentLineId: IDS.line, sourceLocationId: IDS.source, qty: 2 }],
      [
        {
          id: IDS.balance,
          sessionId: IDS.session,
          skuId: IDS.sku,
          sourceLocationId: IDS.source,
          custodyType: 'PACKED',
          custodyRef: `work-item:${IDS.workItem}`,
          shipmentLineId: IDS.line,
          qty: 2,
        },
      ],
      [{ attemptNo: 1 }],
      [{ ...line({ qty: 2, inspectedQty: 2 }), shippedQty: 0, canceledQty: 0 }],
      [{ fulfillmentOrderId: IDS.fo }],
      [{ id: IDS.fo, salesOrderId: IDS.so }],
      [{ id: IDS.foi, fulfillmentOrderId: IDS.fo, skuId: IDS.sku, qty: 2, shippedQty: 2, canceledQty: 0 }],
      [
        {
          shipmentLineId: IDS.line,
          fulfillmentOrderItemId: IDS.foi,
          fulfillmentOrderId: IDS.fo,
          salesOrderId: IDS.so,
          salesOrderLineId: IDS.sol,
          salesChannel: 'medusa',
          channelOrderId: 'channel-order-1',
          channelOrderItemId: 'channel-item-1',
          channelProductId: 'channel-product-1',
          skuId: IDS.sku,
          qty: 2,
          fulfillmentOrderItemQty: 2,
          fulfillmentOrderItemShippedQty: 2,
          fulfillmentOrderItemCanceledQty: 0,
        },
      ],
    ];
    const tx = {
      select: jest.fn(() => new Query(queryRows.shift() ?? [])),
      execute: jest.fn().mockResolvedValue([]),
      insert: jest.fn(() => {
        const mutation = new Mutation();
        return {
          values: (value: any) => {
            mutation.values = value;
            return mutation;
          },
        };
      }),
      update: jest.fn(() => new Mutation()),
    } as any;

    const result = await (service as any).dispatchLocked(locked, { id: IDS.actor, roles: ['logistics_worker'] }, tx, {
      forcedQuantities: [{ shipmentLineId: IDS.line, quantity: 1 }],
      reason: 'physical exception approved',
      csCaseId: 'CASE-1',
      note: 'shift lead present',
      commandRequestId: 'command-1',
      authorizationScope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
      beforeLineManifest: [
        {
          shipmentLineId: IDS.line,
          fulfillmentOrderItemId: IDS.foi,
          skuId: IDS.sku,
          qty: 2,
          inspectedQty: 1,
          forced: false,
          lineVersion: 1,
        },
      ],
    });

    expect(result).toMatchObject({ status: 'shipped', attemptNo: 2 });
    expect(inventory.ship).toHaveBeenCalledWith(
      expect.objectContaining({
        skuId: IDS.sku,
        locationId: IDS.source,
        quantity: 2,
        deferSellableProjection: true,
        batchSessionDispatch: { sessionId: IDS.session, dispatchAttemptSourceId: expect.any(String) },
      }),
      tx,
    );
    expect(sessions.settleForDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: IDS.session, quantity: 2, dispatchAttemptSourceId: expect.any(String) }),
      tx,
    );
    expect(shipmentReservations.consumeForDispatch).toHaveBeenCalledWith(
      IDS.shipment,
      expect.any(String),
      [{ shipmentLineId: IDS.line, quantity: 2 }],
      tx,
    );
    expect(shipmentReservations.finalizeDispatchConsumption).toHaveBeenCalledWith(IDS.shipment, [IDS.sku], tx);
    expect(outbox.enqueue.mock.calls.map(([event]: any[]) => [event.topic, event.idempotencyKey])).toEqual([
      ['shipments.events.v1', result.dispatchAttemptId],
      ['fulfillments.events.v2', `${result.dispatchAttemptId}:${IDS.fo}`],
      ['fulfillments.events.v1', `${IDS.fo}:fully-shipped`],
    ]);
    expect(audit.logUserActionRequired).toHaveBeenCalledWith(
      'shipment.dispatch.force',
      'fulfillment',
      `Force-dispatched shipment ${IDS.shipment}`,
      { userId: IDS.actor },
      expect.objectContaining({
        commandRequestId: 'command-1',
        authorization: {
          scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
          granted: true,
          source: 'scope_guard',
        },
        shipmentId: IDS.shipment,
        fulfillmentOrderIds: [IDS.fo],
        waybill: expect.objectContaining({
          waybillId: IDS.waybill,
          manifestVersion: 1,
          recipientHash,
        }),
        beforeLineManifest: [expect.objectContaining({ shipmentLineId: IDS.line, inspectedQty: 1, forced: false })],
        afterLineManifest: [expect.objectContaining({ shipmentLineId: IDS.line, inspectedQty: 2, forced: true })],
        lineage: expect.objectContaining({
          planId: IDS.plan,
          sessionId: IDS.session,
          workItemId: IDS.workItem,
          dispatchAttemptId: result.dispatchAttemptId,
          stockJournalId: expect.any(String),
          dispatchAttemptSourceIds: [expect.any(String)],
          stockEventIds: ['stock-event-1'],
          sources: [
            expect.objectContaining({
              dispatchAttemptSourceId: expect.any(String),
              shipmentLineId: IDS.line,
              sourceLocationId: IDS.source,
              stockEventId: 'stock-event-1',
            }),
          ],
        }),
        stateTransitions: expect.arrayContaining([
          { resource: 'shipment', id: IDS.shipment, from: 'planned', to: 'shipped' },
          { resource: 'waybill', id: IDS.waybill, from: 'registered', to: 'used' },
          { resource: 'work_item', id: IDS.workItem, from: 'packing', to: 'completed' },
          expect.objectContaining({ resource: 'dispatch_attempt', id: result.dispatchAttemptId, to: 'dispatched' }),
        ]),
      }),
      tx,
    );
    // seam 순서: assertDispatchable 가 markUsed 보다 먼저 호출된다(둘 다 같은 tx).
    expect(waybills.assertDispatchable).toHaveBeenCalledWith(IDS.shipment, tx);
    expect(waybills.markUsed).toHaveBeenCalledWith(IDS.shipment, tx);
    expect(waybills.assertDispatchable.mock.invocationCallOrder[0]).toBeLessThan(
      waybills.markUsed.mock.invocationCallOrder[0],
    );
  });

  it.each([
    {
      caseName: 'an extra location',
      extraBalance: {
        id: '00000000-0000-4000-8000-000000000012',
        sessionId: IDS.session,
        skuId: IDS.sku,
        sourceLocationId: IDS.extraSource,
        custodyType: 'PACKED',
        custodyRef: `work-item:${IDS.workItem}`,
        shipmentLineId: IDS.line,
        qty: 1,
      },
    },
    {
      caseName: 'a non-PACKED custody type',
      extraBalance: {
        id: '00000000-0000-4000-8000-000000000013',
        sessionId: IDS.session,
        skuId: IDS.sku,
        sourceLocationId: IDS.source,
        custodyType: 'TOTE',
        custodyRef: 'tote:unexpected',
        shipmentLineId: IDS.line,
        qty: 1,
      },
    },
  ])('rejects target-line custody with $caseName before creating a dispatch attempt', async ({ extraBalance }) => {
    const { service, inventory } = makeService();
    const locked = aggregate({ lines: [line({ qty: 2, inspectedQty: 2 })] });
    const queryRows = [
      [{ shipmentLineId: IDS.line, sourceLocationId: IDS.source, qty: 2 }],
      [
        {
          id: IDS.balance,
          sessionId: IDS.session,
          skuId: IDS.sku,
          sourceLocationId: IDS.source,
          custodyType: 'PACKED',
          custodyRef: `work-item:${IDS.workItem}`,
          shipmentLineId: IDS.line,
          qty: 2,
        },
        extraBalance,
      ],
    ];
    const tx = {
      select: jest.fn(() => new Query(queryRows.shift() ?? [])),
      execute: jest.fn().mockResolvedValue([]),
      insert: jest.fn(() => new Mutation()),
      update: jest.fn(() => new Mutation()),
    } as any;

    await expect(
      (service as any).dispatchLocked(locked, { id: IDS.actor, roles: ['logistics_worker'] }, tx),
    ).rejects.toMatchObject({ response: { code: 'SHIPMENT_DISPATCH_CUSTODY_MISMATCH' } });
    expect(inventory.ship).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('fails on a stale waybill before any economic effect', async () => {
    const { service, inventory, shipmentReservations, waybills } = makeService();
    waybills.assertDispatchable.mockRejectedValue(new Error('WAYBILL_STALE: waybill does not match shipment'));
    await expect(
      (service as any).dispatchLocked(
        aggregate({ lines: [line({ qty: 2, inspectedQty: 2 })] }),
        { id: IDS.actor, roles: ['logistics_worker'] },
        {},
      ),
    ).rejects.toThrow(/WAYBILL_STALE/);
    expect(inventory.ship).not.toHaveBeenCalled();
    expect(shipmentReservations.consumeForDispatch).not.toHaveBeenCalled();
  });
});
