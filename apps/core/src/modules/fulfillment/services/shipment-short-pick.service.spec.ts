import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ReportShipmentShortPickDto } from '../dto/shipment-short-pick.dto';
import { ShipmentShortPickService } from './shipment-short-pick.service';

class QueryResult<T> implements PromiseLike<T> {
  constructor(private readonly value: T) {}
  from() {
    return this;
  }
  where() {
    return this;
  }
  orderBy() {
    return this;
  }
  limit() {
    return this;
  }
  for() {
    return Promise.resolve(this.value);
  }
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.value).then(onfulfilled, onrejected);
  }
}

function makeService(overrides: Record<string, unknown> = {}) {
  const commands = { execute: jest.fn() };
  const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(new Set([FULFILLMENT_SCOPE.SHIPMENT_REOPEN])) };
  const audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const invoices = { void: jest.fn() };
  const session = {
    approveShortage: jest.fn().mockResolvedValue(undefined),
    returnShortPickCustody: jest.fn().mockResolvedValue(undefined),
  };
  const reservations = {
    lockShipmentGraphForDispatch: jest.fn(),
    invalidateForShortPick: jest.fn(),
  };
  const planning = { retirePickingPlanMemberForShortPick: jest.fn() };
  const totes = { releaseEmptyAssignmentsForShipment: jest.fn() };
  const dependencies = {
    dbService: {},
    commands,
    authorization,
    audit,
    workflowGate,
    invoices,
    session,
    reservations,
    planning,
    totes,
    ...overrides,
  };
  const service = new ShipmentShortPickService(
    dependencies.dbService as never,
    dependencies.commands as never,
    dependencies.authorization as never,
    dependencies.audit as never,
    dependencies.workflowGate as never,
    dependencies.invoices as never,
    dependencies.session as never,
    dependencies.reservations as never,
    dependencies.planning as never,
    dependencies.totes as never,
  );
  return { service, ...dependencies };
}

describe('ShipmentShortPickService', () => {
  const dto: ReportShipmentShortPickDto = {
    workItemId: '22222222-2222-4222-8222-222222222222',
    expectedWorkItemLeaseVersion: 1,
    planId: '33333333-3333-4333-8333-333333333333',
    expectedPlanVersion: 1,
    sessionId: '44444444-4444-4444-8444-444444444444',
    expectedSessionVersion: 1,
    expectedManifestVersion: 1,
    lines: [
      {
        shipmentLineId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: '66666666-6666-4666-8666-666666666666',
        expectedLineVersion: 1,
        shortQty: 1,
      },
    ],
    reason: 'inventory_shortage',
  };

  it('requires the shipment reopen scope before claiming a command', async () => {
    const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(new Set()) };
    const { service, commands } = makeService({ authorization });

    await expect(
      service.report('11111111-1111-4111-8111-111111111111', dto, 'short-key', {
        id: '77777777-7777-4777-8777-777777777777',
        roles: ['logistics_worker'],
      }),
    ).rejects.toThrow(FULFILLMENT_SCOPE.SHIPMENT_REOPEN);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('terminalizes only the exact pooled allocation: shortage first and found quantity returned', async () => {
    const { service, session } = makeService();
    const rows = [
      [{ skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      [],
      [
        {
          id: 'balance-pooled',
          sessionId: dto.sessionId,
          skuId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sourceLocationId: dto.lines[0].sourceLocationId,
          custodyType: 'BULK_CART',
          custodyRef: 'cart:shared',
          shipmentLineId: null,
          qty: 10,
          version: 1,
        },
      ],
    ];
    const tx = { select: jest.fn(() => new QueryResult(rows.shift() ?? [])) } as unknown as DbTx;
    const reconcile = service as unknown as {
      reconcileAffectedCustody(intent: Record<string, unknown>, transaction: DbTx): Promise<void>;
    };

    await reconcile.reconcileAffectedCustody(
      {
        kind: 'short_pick',
        operationId: '88888888-8888-4888-8888-888888888888',
        shipmentId: '11111111-1111-4111-8111-111111111111',
        workItemId: dto.workItemId,
        planId: dto.planId,
        sessionId: dto.sessionId,
        reason: 'inventory_shortage',
        actorId: '77777777-7777-4777-8777-777777777777',
        lines: [{ ...dto.lines[0], allocationQty: 5 }],
      },
      tx,
    );

    const approveShortage = session.approveShortage as unknown as jest.MockedFunction<
      (input: unknown, transaction: DbTx) => Promise<unknown>
    >;
    const approved = approveShortage.mock.calls[0][0] as {
      shortPickOperationId: string;
      shipmentLineId: string;
      quantity: number;
      from: { custodyType: string; shipmentLineId: string | null };
    };
    expect(approved).toMatchObject({
      shortPickOperationId: '88888888-8888-4888-8888-888888888888',
      shipmentLineId: dto.lines[0].shipmentLineId,
      quantity: 1,
      from: { custodyType: 'BULK_CART', shipmentLineId: null },
    });
    expect(approveShortage.mock.calls[0][1]).toBe(tx);
    expect(session.returnShortPickCustody).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 4, shortPickOperationId: '88888888-8888-4888-8888-888888888888' }),
      tx,
    );
  });

  it('invalidates reservations only for lines with a positive reported shortage', () => {
    const { service } = makeService();
    const quantities = (
      service as unknown as {
        shortQtyByLine(lines: Array<{ shipmentLineId: string; shortQty: number }>): Map<string, number>;
      }
    ).shortQtyByLine([
      { shipmentLineId: 'line-short', shortQty: 1 },
      { shipmentLineId: 'line-short', shortQty: 2 },
      { shipmentLineId: 'line-return-only', shortQty: 0 },
    ]);

    expect([...quantities.entries()]).toEqual([['line-short', 3]]);
  });

  it('rejects a session whose immutable HAND_IN plan differs from the reported plan', async () => {
    const { service } = makeService();
    const batchId = '99999999-9999-4999-8999-999999999999';
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    const rows = [
      [{ id: dto.workItemId, shipmentId, batchId, status: 'picking', leaseVersion: 1 }],
      [{ id: dto.planId, batchId, status: 'active', version: 1 }],
      [{ shipmentId }],
      [{ id: dto.sessionId, batchId, status: 'active', version: 1 }],
      [{ payload: { planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }],
    ];
    const tx = { select: jest.fn(() => new QueryResult(rows.shift() ?? [])) } as unknown as DbTx;
    const validate = service as unknown as {
      lockAndValidatePhysical(id: string, input: ReportShipmentShortPickDto, transaction: DbTx): Promise<unknown>;
    };

    let rejected: unknown;
    try {
      await validate.lockAndValidatePhysical(shipmentId, dto, tx);
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toMatchObject({ response: { code: 'SHORT_PICK_SESSION_PLAN_MISMATCH' } });
  });

  it('does not overwrite a concurrently completed operation with recovery_required', async () => {
    const { service, audit } = makeService();
    const update = jest.fn();
    const tx = {
      select: jest.fn(
        () => new QueryResult([{ operatorId: '77777777-7777-4777-8777-777777777777', status: 'completed' }]),
      ),
      update,
    } as unknown as DbTx;

    await service.markInvoiceRecoveryRequired(
      '88888888-8888-4888-8888-888888888888',
      new Error('late invoice callback'),
      tx,
    );

    expect(update).not.toHaveBeenCalled();
    expect(audit.logUserActionRequired).not.toHaveBeenCalled();
  });

  it('locks the short-pick operation before entering the shipment reservation graph on resume', async () => {
    const order: string[] = [];
    const operationId = '88888888-8888-4888-8888-888888888888';
    const shipmentId = '11111111-1111-4111-8111-111111111111';
    const reservations = {
      lockShipmentGraphForDispatch: jest.fn(() => {
        order.push('graph:locked');
        return Promise.reject(new Error('stop after lock-order proof'));
      }),
      invalidateForShortPick: jest.fn(),
    };
    const { service } = makeService({ reservations });
    const operation = {
      type: 'short_pick',
      status: 'pending',
      snapshot: {
        intent: {
          kind: 'short_pick',
          operationId,
          shipmentId,
          workItemId: dto.workItemId,
          planId: dto.planId,
          sessionId: dto.sessionId,
          reason: dto.reason,
          actorId: '77777777-7777-4777-8777-777777777777',
          lines: [{ ...dto.lines[0], allocationQty: 1 }],
        },
      },
    };
    const lockedRows = [
      { label: 'operation:locked', rows: [operation] },
      { label: 'member:locked', rows: [{ shipmentId }] },
    ];
    const tx = {
      select: jest.fn(() => {
        const current = lockedRows.shift()!;
        const query = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          for: jest.fn(() => {
            order.push(current.label);
            return Promise.resolve(current.rows);
          }),
        };
        return query;
      }),
    };

    await expect(service.resumePending(operationId, tx as unknown as DbTx)).rejects.toThrow(
      'stop after lock-order proof',
    );
    expect(order).toEqual(['operation:locked', 'member:locked', 'graph:locked']);
  });

  it('owns the canonical shipment graph before inserting the member whose shipment FK takes KEY SHARE', async () => {
    const { service, commands, reservations } = makeService();
    const order: string[] = [];
    const stopAfterMemberInsert = new Error('stop after lock-order proof');
    reservations.lockShipmentGraphForDispatch.mockImplementation(() => {
      order.push('canonical-graph');
      return Promise.resolve();
    });
    const tx = {
      insert: jest.fn((table: unknown) => {
        if (table === wmsTables.shipmentOperationMembers) {
          order.push('member-insert');
          throw stopAfterMemberInsert;
        }
        return { values: () => Promise.resolve() };
      }),
    };
    commands.execute.mockImplementation(
      (_input: unknown, execute: (tx: unknown, commandRequestId: string, requestHash: string) => Promise<unknown>) =>
        execute(tx, 'command-id', 'a'.repeat(64)),
    );

    await expect(
      service.report('11111111-1111-4111-8111-111111111111', dto, 'short-pick-lock-order', {
        id: '77777777-7777-4777-8777-777777777777',
        roles: ['logistics_manager'],
      }),
    ).rejects.toBe(stopAfterMemberInsert);
    expect(order).toEqual(['canonical-graph', 'member-insert']);
  });
});
