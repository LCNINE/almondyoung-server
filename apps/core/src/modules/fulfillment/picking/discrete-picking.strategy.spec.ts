/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { ConflictException } from '@nestjs/common';
import { DiscretePickingStrategy } from './discrete-picking.strategy';
import { PickingScanResult, ScanPickingInput } from './picking-strategy.interface';

const IDS = Object.freeze({
  actor: '11111111-1111-4111-8111-111111111111',
  otherActor: '22222222-2222-4222-8222-222222222222',
  batch: '33333333-3333-4333-8333-333333333333',
  plan: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  workItem: '66666666-6666-4666-8666-666666666666',
  shipment: '77777777-7777-4777-8777-777777777777',
  shipmentLine: '88888888-8888-4888-8888-888888888888',
  sku: '99999999-9999-4999-8999-999999999999',
  otherSku: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});

class SelectResult<T> implements PromiseLike<T[]> {
  constructor(private readonly rows: T[]) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
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

function scanInput(overrides: Partial<ScanPickingInput> = {}): ScanPickingInput {
  return {
    batchId: IDS.batch,
    planId: IDS.plan,
    sessionId: IDS.session,
    workItemId: IDS.workItem,
    shipmentId: IDS.shipment,
    shipmentLineId: IDS.shipmentLine,
    skuId: IDS.sku,
    sourceLocationId: IDS.source,
    quantity: 2,
    actor: { id: IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey: 'scan-key',
    ...overrides,
  };
}

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.workItem,
    batchId: IDS.batch,
    shipmentId: IDS.shipment,
    status: 'picking',
    pickerId: IDS.actor,
    pickerClaimedAt: new Date('2026-07-15T00:00:00.000Z'),
    pickerReleasedAt: null,
    packerId: null,
    packerClaimedAt: null,
    packerReleasedAt: null,
    handedOffAt: null,
    completedAt: null,
    leaseExpiresAt: new Date('2026-07-15T00:20:00.000Z'),
    leaseVersion: 1,
    exclusionReason: null,
    recoveryReason: null,
    waitingOperationId: null,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function activeIdentityRows(item = workItem()): unknown[][] {
  return [
    [item],
    [{ batchId: IDS.batch, strategy: 'discrete', status: 'active' }],
    [{ batchId: IDS.batch, status: 'active' }],
    [{ id: 'hand-in-event' }],
  ];
}

function makeService(selectRows: unknown[][] = []) {
  const queuedRows = [...selectRows];
  const updateBuilder = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: IDS.plan }]),
  };
  const tx = {
    select: jest.fn(() => new SelectResult(queuedRows.shift() ?? [])),
    execute: jest.fn().mockResolvedValue([{ now: new Date('2026-07-15T00:10:00.000Z') }]),
    update: jest.fn(() => updateBuilder),
  };
  const commands = {
    execute: jest.fn(async (_request, handler, suppliedTx) => {
      const envelope = await handler(suppliedTx ?? tx, 'command-request-1');
      return envelope.response;
    }),
  };
  const sessions = { moveCustody: jest.fn().mockResolvedValue({}) };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const Strategy = DiscretePickingStrategy as any;
  const service: DiscretePickingStrategy = new Strategy({}, commands, workflowGate, {}, sessions, {}, {}, {});
  return { service, commands, sessions, workflowGate, tx };
}

describe('DiscretePickingStrategy', () => {
  it('declares worker-bucket custody without inventing a physical tote', () => {
    const { service } = makeService();

    expect(service.capabilities).toEqual({
      name: 'discrete',
      requiresPhysicalTote: false,
      supportsAggregateSourcePick: false,
      inspectionReadyCustody: 'PACKING',
      custodyFlow: ['AT_SOURCE', 'WORKER', 'PACKING'],
    });
    expect(Object.isFrozen(service.capabilities)).toBe(true);
  });

  it('does not invalidate an existing draft when caller shipment membership differs', async () => {
    const { service, tx } = makeService([[{ id: IDS.plan, status: 'draft' }], [{ shipmentId: IDS.otherActor }]]);

    await expect(
      service.plan({
        batchId: IDS.batch,
        shipmentIds: [IDS.shipment],
        actorId: IDS.actor,
        idempotencyKey: 'mismatched-plan-members',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH' }),
    });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('commits a stored-member draft validation failure as an invalidated result', async () => {
    const { service, tx } = makeService([[{ id: IDS.plan, status: 'draft' }], [{ shipmentId: IDS.shipment }]]);
    jest
      .spyOn(service as unknown as { lockAggregate: (...args: unknown[]) => Promise<unknown> }, 'lockAggregate')
      .mockRejectedValue(new ConflictException({ code: 'PICKING_SOURCE_STALE', message: 'source stale' }));

    await expect(
      service.plan({
        batchId: IDS.batch,
        shipmentIds: [IDS.shipment],
        actorId: IDS.actor,
        idempotencyKey: 'invalidate-stale-plan',
      }),
    ).resolves.toEqual({
      state: 'invalidated',
      operationId: 'command-request-1',
      planId: IDS.plan,
      batchId: IDS.batch,
      reason: 'source stale',
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it('lets the command replay envelope return before claim validation or custody mutation', async () => {
    const stored: PickingScanResult = {
      operationId: 'original-operation',
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItem,
      shipmentId: IDS.shipment,
      shipmentLineId: IDS.shipmentLine,
      skuId: IDS.sku,
      sourceLocationId: IDS.source,
      quantity: 2,
      workerId: IDS.actor,
    };
    const { service, commands, sessions, tx } = makeService();
    commands.execute.mockResolvedValueOnce(stored);

    await expect(
      service.scan(scanInput({ expectedLeaseVersion: 999, idempotencyKey: 'already-committed' })),
    ).resolves.toEqual(stored);

    expect(commands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'picking.discrete.scan',
        idempotencyKey: 'already-committed',
        canonicalRequest: expect.objectContaining({
          actorId: IDS.actor,
          expectedLeaseVersion: 999,
          stage: 'AT_SOURCE_TO_WORKER',
        }),
      }),
      expect.any(Function),
      undefined,
    );
    expect(tx.select).not.toHaveBeenCalled();
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it.each([
    ['another worker owns the item', workItem({ pickerId: IDS.otherActor }), 1],
    ['the lease version has changed', workItem({ leaseVersion: 2 }), 1],
    ['the database lease has expired', workItem({ leaseExpiresAt: new Date('2026-07-15T00:09:59.000Z') }), 1],
  ])('rejects a stale claim before reading scan identity when %s', async (_label, item, expectedLeaseVersion) => {
    const { service, sessions, tx } = makeService(activeIdentityRows(item));

    await expect(service.scan(scanInput({ expectedLeaseVersion }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_STALE_CLAIM' }),
    });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('rejects the wrong SKU before reading source allocation or mutating custody', async () => {
    const rows = [...activeIdentityRows(), [{ shipmentId: IDS.shipment, skuId: IDS.otherSku }]];
    const { service, sessions, tx } = makeService(rows);

    await expect(service.scan(scanInput())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_WRONG_SKU' }),
    });
    expect(tx.select).toHaveBeenCalledTimes(5);
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('rejects a source outside the plan allocation before mutating custody', async () => {
    const rows = [...activeIdentityRows(), [{ shipmentId: IDS.shipment, skuId: IDS.sku }], []];
    const { service, sessions } = makeService(rows);

    await expect(service.scan(scanInput())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_WRONG_SOURCE' }),
    });
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('rejects over-pick using all attributed non-settled custody before mutation', async () => {
    const rows = [...activeIdentityRows(), [{ shipmentId: IDS.shipment, skuId: IDS.sku }], [{ qty: 3 }], [{ qty: 2 }]];
    const { service, sessions } = makeService(rows);

    await expect(service.scan(scanInput({ quantity: 2 }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_OVERPICK' }),
    });
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('translates a valid exact scan into AT_SOURCE to trusted-worker custody', async () => {
    const rows = [...activeIdentityRows(), [{ shipmentId: IDS.shipment, skuId: IDS.sku }], [{ qty: 3 }], [{ qty: 1 }]];
    const { service, sessions } = makeService(rows);

    await expect(service.scan(scanInput({ quantity: 2 }))).resolves.toEqual({
      operationId: 'command-request-1',
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItem,
      shipmentId: IDS.shipment,
      shipmentLineId: IDS.shipmentLine,
      skuId: IDS.sku,
      sourceLocationId: IDS.source,
      quantity: 2,
      workerId: IDS.actor,
    });
    expect(sessions.moveCustody).toHaveBeenCalledWith(
      {
        sessionId: IDS.session,
        idempotencyKey: 'discrete-scan:command-request-1',
        actorId: IDS.actor,
        quantity: 2,
        from: {
          skuId: IDS.sku,
          sourceLocationId: IDS.source,
          custodyType: 'AT_SOURCE',
        },
        to: {
          skuId: IDS.sku,
          sourceLocationId: IDS.source,
          custodyType: 'WORKER',
          custodyRef: IDS.actor,
          shipmentLineId: IDS.shipmentLine,
        },
      },
      expect.anything(),
    );
  });
});
