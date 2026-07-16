/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import { PickToTotePickingStrategy } from './pick-to-tote.strategy';
import {
  PICKING_CONTRACT_IDS,
  PickingContractAllocation,
  PickingStrategyContractFixture,
  definePickingStrategyContract,
} from './picking-strategy.contract.spec';
import {
  CompletePickInput,
  HandoffPickingInput,
  ToteAssignmentInput,
  ToteHandoffInput,
  ToteRegistrationInput,
  ToteReleaseInput,
  ToteScanPickingInput,
  UnpickShipmentInput,
} from './picking-strategy.interface';

const IDS = Object.freeze({
  actor: '11111111-1111-4111-8111-111111111111',
  otherActor: '22222222-2222-4222-8222-222222222222',
  manager: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  warehouse: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  batch: '33333333-3333-4333-8333-333333333333',
  plan: '44444444-4444-4444-8444-444444444444',
  session: '55555555-5555-4555-8555-555555555555',
  workItem: '66666666-6666-4666-8666-666666666666',
  targetWorkItem: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  shipment: '77777777-7777-4777-8777-777777777777',
  targetShipment: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  shipmentLine: '88888888-8888-4888-8888-888888888888',
  sku: '99999999-9999-4999-8999-999999999999',
  source: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  toteA: '10101010-1010-4010-8010-101010101010',
  toteB: '20202020-2020-4020-8020-202020202020',
  assignmentA: '30303030-3030-4030-8030-303030303030',
  assignmentB: '40404040-4040-4040-8040-404040404040',
  barcodeA: 'TOTE-001',
  barcodeB: 'TOTE-002',
});

class QueryResult<T> implements PromiseLike<T[]> {
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

class MutationResult<T> implements PromiseLike<T[]> {
  readonly values = jest.fn().mockReturnThis();
  readonly set = jest.fn().mockReturnThis();
  readonly where = jest.fn().mockReturnThis();
  constructor(private readonly rows: T[]) {}
  returning(): this {
    return this;
  }
  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
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

function tote(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.toteA,
    warehouseId: IDS.warehouse,
    barcode: IDS.barcodeA,
    status: 'in_use',
    version: 2,
    createdAt: new Date('2026-07-15T00:00:00.000Z'),
    updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    ...overrides,
  };
}

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.assignmentA,
    shipmentId: IDS.shipment,
    toteId: IDS.toteA,
    assignedBy: IDS.actor,
    assignedAt: new Date('2026-07-15T00:00:00.000Z'),
    releasedAt: null,
    ...overrides,
  };
}

function assignmentInput(overrides: Partial<ToteAssignmentInput> = {}): ToteAssignmentInput {
  return {
    batchId: IDS.batch,
    planId: IDS.plan,
    sessionId: IDS.session,
    workItemId: IDS.workItem,
    shipmentId: IDS.shipment,
    toteBarcode: IDS.barcodeA,
    actor: { id: IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey: 'assign-tote',
    ...overrides,
  };
}

function scanInput(overrides: Partial<ToteScanPickingInput> = {}): ToteScanPickingInput {
  return {
    ...assignmentInput(),
    strategy: 'pick_to_tote',
    stage: 'source',
    shipmentLineId: IDS.shipmentLine,
    skuId: IDS.sku,
    sourceLocationId: IDS.source,
    quantity: 2,
    idempotencyKey: 'scan-tote',
    ...overrides,
  };
}

function makeService(options: { selects?: unknown[][]; inserts?: unknown[][]; updates?: unknown[][] } = {}) {
  const selects = [...(options.selects ?? [])];
  const inserts = [...(options.inserts ?? [])];
  const updates = [...(options.updates ?? [])];
  const insertBuilders: MutationResult<unknown>[] = [];
  const updateBuilders: MutationResult<unknown>[] = [];
  const tx = {
    select: jest.fn(() => new QueryResult(selects.shift() ?? [])),
    insert: jest.fn(() => {
      const builder = new MutationResult(inserts.shift() ?? []);
      insertBuilders.push(builder);
      return builder;
    }),
    update: jest.fn(() => {
      const builder = new MutationResult(updates.shift() ?? []);
      updateBuilders.push(builder);
      return builder;
    }),
    execute: jest.fn().mockResolvedValue([{ now: new Date('2026-07-15T00:10:00.000Z') }]),
  };
  const commands = {
    execute: jest.fn(async (_request, handler, suppliedTx) => {
      const envelope = await handler(suppliedTx ?? tx, 'command-request-1');
      return envelope.response;
    }),
  };
  const sessions = { startSession: jest.fn(), moveCustody: jest.fn().mockResolvedValue({}) };
  const batches = { handoff: jest.fn() };
  const audit = { logUserActionRequired: jest.fn().mockResolvedValue(undefined) };
  const Strategy = PickToTotePickingStrategy as any;
  const service: PickToTotePickingStrategy = new Strategy(
    {},
    commands,
    { assertV2MutationAllowed: jest.fn() },
    {},
    sessions,
    {},
    {},
    batches,
    audit,
  );
  jest.spyOn(service as any, 'assertPlanMembers').mockResolvedValue(undefined);
  return { service, commands, sessions, batches, audit, tx, insertBuilders, updateBuilders };
}

function spy<T>(service: PickToTotePickingStrategy, name: string, value: T) {
  return jest.spyOn(service as any, name).mockResolvedValue(value);
}

describe('PickToTotePickingStrategy', () => {
  it('declares physical tote custody and common packing output', () => {
    const { service } = makeService();
    expect(service.capabilities).toEqual({
      name: 'pick_to_tote',
      requiresPhysicalTote: true,
      supportsAggregateSourcePick: false,
      inspectionReadyCustody: 'PACKING',
      custodyFlow: ['AT_SOURCE', 'TOTE', 'PACKING'],
    });
  });

  it('registers a warehouse-scoped physical barcode without auto-assigning it', async () => {
    const registered = tote({ status: 'available', version: 1 });
    const { service, tx, insertBuilders } = makeService({
      selects: [[], [{ id: IDS.warehouse }]],
      inserts: [[registered]],
    });
    const input: ToteRegistrationInput = {
      warehouseId: IDS.warehouse,
      toteBarcode: IDS.barcodeA,
      actor: { id: IDS.actor, roles: ['logistics_worker'] },
      idempotencyKey: 'register-tote',
    };

    await expect(service.registerTote(input)).resolves.toMatchObject({
      toteId: IDS.toteA,
      toteBarcode: IDS.barcodeA,
      status: 'available',
    });
    expect(tx.execute).toHaveBeenCalledWith(expect.anything());
    expect(insertBuilders[0].values).toHaveBeenCalledWith(
      expect.objectContaining({ barcode: IDS.barcodeA, warehouseId: IDS.warehouse, status: 'available' }),
    );
  });

  it('prevents one active tote assignment from crossing shipments before insert', async () => {
    const { service, tx } = makeService();
    spy(service, 'lockAndAssertPickerClaim', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'loadActiveToteAssignments', [assignment({ shipmentId: IDS.targetShipment })]);

    await expect(service.assignTote(assignmentInput())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TOTE_ALREADY_ASSIGNED' }),
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('serializes concurrent reuse of one barcode into one assignment and one deterministic conflict', async () => {
    const { service, commands } = makeService();
    spy(service, 'lockAndAssertPickerClaim', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    let activeAssignment: ReturnType<typeof assignment> | undefined;
    let lockTail: Promise<void> = Promise.resolve();
    jest.spyOn(service as any, 'acquireToteLock').mockImplementation(async (_barcode: string, localTx: any) => {
      const previous = lockTail;
      lockTail = new Promise<void>((resolve) => {
        localTx.releaseToteLock = resolve;
      });
      await previous;
    });
    jest
      .spyOn(service as any, 'loadToteForBatch')
      .mockImplementation(async () =>
        tote({ status: activeAssignment ? 'in_use' : 'available', version: activeAssignment ? 2 : 1 }),
      );
    jest
      .spyOn(service as any, 'loadActiveToteAssignments')
      .mockImplementation(async () => (activeAssignment ? [activeAssignment] : []));
    commands.execute.mockImplementation(async (request, handler) => {
      const localTx: any = {
        releaseToteLock: undefined,
        insert: jest.fn(() => {
          activeAssignment = assignment({
            id: `assignment-${request.canonicalRequest.shipmentId}`,
            shipmentId: request.canonicalRequest.shipmentId,
          });
          return new MutationResult([activeAssignment]);
        }),
        update: jest.fn(() => new MutationResult([{ id: IDS.toteA }])),
      };
      try {
        const envelope = await handler(localTx, `operation:${request.idempotencyKey}`);
        return envelope.response;
      } finally {
        localTx.releaseToteLock?.();
      }
    });
    const first = assignmentInput({ idempotencyKey: 'race-a' });
    const second = assignmentInput({
      workItemId: IDS.targetWorkItem,
      shipmentId: IDS.targetShipment,
      actor: { id: IDS.otherActor, roles: ['logistics_worker'] },
      idempotencyKey: 'race-b',
    });

    const results = await Promise.allSettled([service.assignTote(first), service.assignTote(second)]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({
      response: expect.objectContaining({ code: 'TOTE_ALREADY_ASSIGNED' }),
    });
    expect(activeAssignment?.shipmentId).toBe(IDS.shipment);
    expect((service as any).acquireToteLock).toHaveBeenCalledTimes(2);
  });

  it('moves exact source custody into the active shipment tote with stable ID-derived ref', async () => {
    const { service, sessions } = makeService({
      selects: [[{ shipmentId: IDS.shipment, skuId: IDS.sku }], [{ qty: 3 }], [{ qty: 1 }]],
    });
    spy(service, 'lockAndAssertPickerClaim', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'requireActiveToteAssignment', assignment());

    await expect(service.scan(scanInput())).resolves.toMatchObject({
      shipmentLineId: IDS.shipmentLine,
      toteId: IDS.toteA,
      toteBarcode: IDS.barcodeA,
      toteRef: `tote:${IDS.toteA}`,
    });
    expect(sessions.moveCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 2,
        from: { skuId: IDS.sku, sourceLocationId: IDS.source, custodyType: 'AT_SOURCE' },
        to: {
          skuId: IDS.sku,
          sourceLocationId: IDS.source,
          custodyType: 'TOTE',
          custodyRef: `tote:${IDS.toteA}`,
          shipmentLineId: IDS.shipmentLine,
        },
      }),
      expect.anything(),
    );
  });

  it('rejects a cross-shipment tote scan before source mutation', async () => {
    const { service, sessions, tx } = makeService();
    spy(service, 'lockAndAssertPickerClaim', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    jest
      .spyOn(service as any, 'requireActiveToteAssignment')
      .mockRejectedValue(new ConflictException({ code: 'TOTE_WRONG_SHIPMENT', message: 'wrong shipment' }));

    await expect(service.toteScan(scanInput())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TOTE_WRONG_SHIPMENT' }),
    });
    expect(tx.select).not.toHaveBeenCalled();
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('accepts multiple totes for one allocation and converges every row to PACKING', async () => {
    const { service, sessions } = makeService({
      selects: [
        [
          { id: 'balance-a', custodyType: 'TOTE', custodyRef: `tote:${IDS.toteA}`, qty: 1 },
          { id: 'balance-b', custodyType: 'TOTE', custodyRef: `tote:${IDS.toteB}`, qty: 2 },
        ],
      ],
      updates: [[{ id: IDS.workItem }]],
    });
    spy(service, 'lockAndAssertPickerClaim', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'loadShipmentAllocations', [
      { shipmentLineId: IDS.shipmentLine, skuId: IDS.sku, sourceLocationId: IDS.source, qty: 3 },
    ]);
    spy(service, 'loadActiveShipmentToteRefs', new Set([`tote:${IDS.toteA}`, `tote:${IDS.toteB}`]));
    spy(service, 'databaseNow', new Date('2026-07-15T00:10:00.000Z'));
    const input: CompletePickInput = {
      batchId: IDS.batch,
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItem,
      shipmentId: IDS.shipment,
      actor: { id: IDS.actor, roles: ['logistics_worker'] },
      expectedLeaseVersion: 1,
      idempotencyKey: 'complete',
    };

    await expect(service.completePick(input)).resolves.toMatchObject({
      custodyType: 'PACKING',
      custodyRef: `work-item:${IDS.workItem}`,
      totalQty: 3,
    });
    expect(sessions.moveCustody).toHaveBeenCalledTimes(2);
    expect(sessions.moveCustody).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        quantity: 2,
        from: expect.objectContaining({ custodyType: 'TOTE', custodyRef: `tote:${IDS.toteB}` }),
        to: expect.objectContaining({ custodyType: 'PACKING', custodyRef: `work-item:${IDS.workItem}` }),
      }),
      expect.anything(),
    );
  });

  it('releases an empty tote after ready-to-pack and writes required operator audit', async () => {
    const { service, audit } = makeService({ updates: [[{ id: IDS.assignmentA }], [{ id: IDS.toteA }]] });
    spy(service, 'assertToteMutationAuthority', undefined);
    spy(service, 'assertReleasePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'requireActiveToteAssignment', assignment());
    spy(service, 'assertToteEmpty', undefined);
    const input: ToteReleaseInput = { ...assignmentInput({ expectedLeaseVersion: 2 }), reason: 'packing handoff' };

    await expect(service.releaseTote(input)).resolves.toMatchObject({ status: 'released' });
    expect(audit.logUserActionRequired).toHaveBeenCalledWith(
      'picking.tote.release',
      'fulfillment',
      expect.any(String),
      { userId: IDS.actor },
      expect.objectContaining({
        toteId: IDS.toteA,
        sourceAssignmentId: IDS.assignmentA,
        reason: 'packing handoff',
        before: { status: 'in_use', version: 2 },
        after: { status: 'available', version: 3 },
      }),
      expect.anything(),
    );
  });

  it('refuses release while any positive tote balance remains', async () => {
    const { service, tx, audit } = makeService();
    spy(service, 'assertToteMutationAuthority', undefined);
    spy(service, 'assertReleasePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'requireActiveToteAssignment', assignment());
    jest
      .spyOn(service as any, 'assertToteEmpty')
      .mockRejectedValue(new ConflictException({ code: 'TOTE_NOT_EMPTY', message: 'not empty' }));

    await expect(service.releaseTote({ ...assignmentInput(), reason: 'premature release' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'TOTE_NOT_EMPTY' }),
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(audit.logUserActionRequired).not.toHaveBeenCalled();
  });

  it('keeps HAND_IN lineage while allowing completed-plan and settled-session tote release', async () => {
    const { service, tx } = makeService({
      selects: [
        [{ batchId: IDS.batch, strategy: 'pick_to_tote', status: 'completed' }],
        [{ batchId: IDS.batch, status: 'settled' }],
        [{ id: 'hand-in-event' }],
      ],
    });

    await expect(
      (service as any).assertReleasePlanSession(IDS.plan, IDS.session, IDS.batch, tx),
    ).resolves.toBeUndefined();
  });

  it('allows an active packer or manager to release at packing and requires manager after completion', async () => {
    const packingInput = assignmentInput({
      actor: { id: IDS.otherActor, roles: ['logistics_worker'] },
      expectedLeaseVersion: 3,
    });
    const packing = workItem({
      status: 'packing',
      packerId: IDS.otherActor,
      packerClaimedAt: new Date('2026-07-15T00:05:00.000Z'),
      packerReleasedAt: null,
      leaseVersion: 3,
    });
    const packingHarness = makeService();
    spy(packingHarness.service, 'loadWorkItem', packing);
    spy(packingHarness.service, 'databaseNow', new Date('2026-07-15T00:10:00.000Z'));
    await expect(
      (packingHarness.service as any).assertToteMutationAuthority(packingInput, {}),
    ).resolves.toBeUndefined();

    const completed = workItem({ status: 'completed', leaseExpiresAt: null, leaseVersion: 4 });
    const completedHarness = makeService();
    spy(completedHarness.service, 'loadWorkItem', completed);
    spy(completedHarness.service, 'databaseNow', new Date('2026-07-15T00:10:00.000Z'));
    await expect(
      (completedHarness.service as any).assertToteMutationAuthority(assignmentInput({ expectedLeaseVersion: 4 }), {}),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'TOTE_RELEASE_FORBIDDEN' }) });
    await expect(
      (completedHarness.service as any).assertToteMutationAuthority(
        assignmentInput({
          actor: { id: IDS.manager, roles: ['logistics_manager'] },
          expectedLeaseVersion: 4,
        }),
        {},
      ),
    ).resolves.toBeUndefined();
  });

  it('hands an empty tote across shipments while preserving old assignment and required audit', async () => {
    const target = assignment({ id: IDS.assignmentB, shipmentId: IDS.targetShipment });
    const { service, audit, updateBuilders } = makeService({
      inserts: [[target]],
      updates: [[{ id: IDS.assignmentA }], [{ id: IDS.toteA }]],
    });
    spy(
      service,
      'loadWorkItemsForUpdate',
      new Map([
        [IDS.workItem, workItem()],
        [
          IDS.targetWorkItem,
          workItem({ id: IDS.targetWorkItem, shipmentId: IDS.targetShipment, pickerId: IDS.otherActor }),
        ],
      ]),
    );
    spy(service, 'assertActiveWorkItemLease', undefined);
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'requireActiveToteAssignment', assignment());
    spy(service, 'assertToteEmpty', undefined);
    const input: ToteHandoffInput = {
      ...assignmentInput({ actor: { id: IDS.manager, roles: ['logistics_manager'] } }),
      targetWorkItemId: IDS.targetWorkItem,
      targetShipmentId: IDS.targetShipment,
      targetExpectedLeaseVersion: 1,
      reason: 'rebalance empty totes',
    };

    await expect(service.toteHandoff(input)).resolves.toMatchObject({
      sourceAssignmentId: IDS.assignmentA,
      targetAssignmentId: IDS.assignmentB,
      targetShipmentId: IDS.targetShipment,
    });
    expect(updateBuilders[0].set).toHaveBeenCalledWith({ releasedAt: expect.anything() });
    expect(audit.logUserActionRequired).toHaveBeenCalledWith(
      'picking.tote.handoff',
      'fulfillment',
      expect.any(String),
      { userId: IDS.manager },
      expect.objectContaining({ reason: 'rebalance empty totes', targetAssignmentId: IDS.assignmentB }),
      expect.anything(),
    );
  });

  it('rejects a tote handoff when either shipment is outside the active plan', async () => {
    const { service, tx, audit } = makeService();
    spy(
      service,
      'loadWorkItemsForUpdate',
      new Map([
        [IDS.workItem, workItem()],
        [IDS.targetWorkItem, workItem({ id: IDS.targetWorkItem, shipmentId: IDS.targetShipment })],
      ]),
    );
    spy(service, 'assertActiveWorkItemLease', undefined);
    spy(service, 'assertActivePlanSession', undefined);
    jest
      .spyOn(service as any, 'assertPlanMembers')
      .mockRejectedValue(new ConflictException({ code: 'PICKING_SHIPMENT_NOT_IN_PLAN', message: 'outside plan' }));

    await expect(
      service.toteHandoff({
        ...assignmentInput({ actor: { id: IDS.manager, roles: ['master'] } }),
        targetWorkItemId: IDS.targetWorkItem,
        targetShipmentId: IDS.targetShipment,
        targetExpectedLeaseVersion: 1,
        reason: 'invalid reassignment',
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PICKING_SHIPMENT_NOT_IN_PLAN' }) });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(audit.logUserActionRequired).not.toHaveBeenCalled();
  });

  it('propagates required audit failure so assignment changes roll back with the transaction', async () => {
    const target = assignment({ id: IDS.assignmentB, shipmentId: IDS.targetShipment });
    const { service, audit } = makeService({
      inserts: [[target]],
      updates: [[{ id: IDS.assignmentA }], [{ id: IDS.toteA }]],
    });
    spy(
      service,
      'loadWorkItemsForUpdate',
      new Map([
        [IDS.workItem, workItem()],
        [
          IDS.targetWorkItem,
          workItem({ id: IDS.targetWorkItem, shipmentId: IDS.targetShipment, pickerId: IDS.otherActor }),
        ],
      ]),
    );
    spy(service, 'assertActiveWorkItemLease', undefined);
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'acquireToteLock', undefined);
    spy(service, 'loadToteForBatch', tote());
    spy(service, 'requireActiveToteAssignment', assignment());
    spy(service, 'assertToteEmpty', undefined);
    audit.logUserActionRequired.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      service.toteHandoff({
        ...assignmentInput({ actor: { id: IDS.manager, roles: ['master'] } }),
        targetWorkItemId: IDS.targetWorkItem,
        targetShipmentId: IDS.targetShipment,
        targetExpectedLeaseVersion: 1,
        reason: 'required audit',
      }),
    ).rejects.toThrow('audit unavailable');
  });

  it('hands the picker claim off without moving physical tote custody', async () => {
    const { service, batches, sessions } = makeService();
    jest.spyOn(service as any, 'loadWorkItem').mockResolvedValue(workItem());
    jest.spyOn(service as any, 'loadPositiveShipmentCustody').mockResolvedValue([]);
    spy(service, 'assertExclusiveToteCustody', undefined);
    spy(service, 'assertActivePlanSession', undefined);
    batches.handoff.mockResolvedValue({
      workItem: workItem({ pickerId: IDS.otherActor, leaseVersion: 2 }),
    });
    const input: HandoffPickingInput = {
      batchId: IDS.batch,
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItem,
      shipmentId: IDS.shipment,
      targetWorkerId: IDS.otherActor,
      expectedLeaseVersion: 1,
      reason: 'shift change',
      actor: { id: IDS.manager, roles: ['logistics_manager'] },
      idempotencyKey: 'worker-handoff',
    };

    await expect(service.handoff(input)).resolves.toMatchObject({ workerId: IDS.otherActor, movedQty: 0 });
    expect(sessions.moveCustody).not.toHaveBeenCalled();
  });

  it('returns only this shipment tote custody to source and releases emptied tote history', async () => {
    const { service, sessions } = makeService({
      selects: [
        [
          {
            id: 'balance-a',
            skuId: IDS.sku,
            sourceLocationId: IDS.source,
            custodyType: 'TOTE',
            custodyRef: `tote:${IDS.toteA}`,
            shipmentLineId: IDS.shipmentLine,
            qty: 2,
          },
        ],
      ],
      updates: [[{ id: IDS.workItem }]],
    });
    spy(service, 'loadWorkItem', workItem());
    spy(service, 'assertActivePlanSession', undefined);
    spy(service, 'loadShipmentAllocations', [
      { shipmentLineId: IDS.shipmentLine, skuId: IDS.sku, sourceLocationId: IDS.source, qty: 2 },
    ]);
    spy(service, 'loadActiveShipmentToteRefs', new Set([`tote:${IDS.toteA}`]));
    spy(service, 'releaseEmptyShipmentTotes', undefined);
    spy(service, 'databaseNow', new Date('2026-07-15T00:10:00.000Z'));
    const input: UnpickShipmentInput = {
      batchId: IDS.batch,
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItem,
      shipmentId: IDS.shipment,
      actor: { id: IDS.actor, roles: ['logistics_worker'] },
      expectedLeaseVersion: 1,
      idempotencyKey: 'unpick',
    };

    await expect(service.unpickShipment(input)).resolves.toMatchObject({ returnedToSourceQty: 2, status: 'queued' });
    expect(sessions.moveCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.objectContaining({ custodyType: 'TOTE', custodyRef: `tote:${IDS.toteA}` }),
        to: { skuId: IDS.sku, sourceLocationId: IDS.source, custodyType: 'AT_SOURCE' },
      }),
      expect.anything(),
    );
    expect((service as any).releaseEmptyShipmentTotes).toHaveBeenCalledWith(IDS.shipment, expect.anything());
  });
});

type ContractCustodyType = 'AT_SOURCE' | 'WORKER' | 'BULK_CART' | 'TOTE' | 'SORTING' | 'PACKING';

interface ContractBalance {
  id: string;
  skuId: string;
  shipmentLineId: string | null;
  sourceLocationId: string;
  custodyType: ContractCustodyType;
  custodyRef: string | null;
  qty: number;
}

class ContractInsertResult implements PromiseLike<unknown[]> {
  private rows: unknown[] = [];
  constructor(private readonly state: PickToToteContractState) {}
  values(values: unknown): this {
    this.rows = this.state.applyInsert(values);
    return this;
  }
  returning(): this {
    return this;
  }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

class ContractUpdateResult implements PromiseLike<unknown[]> {
  constructor(private readonly state: PickToToteContractState) {}
  set(values: Record<string, unknown>): this {
    this.state.applyUpdate(values);
    return this;
  }
  where(): this {
    return this;
  }
  returning(): QueryResult<{ id: string }> {
    return new QueryResult([{ id: this.state.updateResourceId() }]);
  }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled, onrejected);
  }
}

class PickToToteContractState {
  readonly allocations: PickingContractAllocation[] = [];
  readonly balances: ContractBalance[] = [];
  readonly replay = new Map<string, unknown>();
  readonly workItems: Record<string, Record<string, any>> = {
    [PICKING_CONTRACT_IDS.workItemA]: this.workItem(PICKING_CONTRACT_IDS.workItemA, PICKING_CONTRACT_IDS.shipmentA),
    [PICKING_CONTRACT_IDS.workItemB]: this.workItem(PICKING_CONTRACT_IDS.workItemB, PICKING_CONTRACT_IDS.shipmentB),
  };
  handedIn = 0;
  registered = false;
  assigned = false;
  toteVersion = 1;
  operation = '';
  request: Record<string, any> = {};
  selectIndex = 0;
  insertIndex = 0;

  begin(operation: string, request: Record<string, any>): void {
    this.operation = operation;
    this.request = request;
    this.selectIndex = 0;
    this.insertIndex = 0;
  }

  selectRows(): unknown[] {
    const index = this.selectIndex++;
    if (this.operation === 'picking.pick_to_tote.plan') {
      if (index === 0 || index === 1) return [];
      if (index === 2) return [{ version: 0 }];
    }
    if (this.operation === 'picking.pick_to_tote.start') {
      if (index === 0) return [{ status: 'draft', strategy: 'pick_to_tote' }];
      if (index === 1) {
        return [{ shipmentId: PICKING_CONTRACT_IDS.shipmentA }, { shipmentId: PICKING_CONTRACT_IDS.shipmentB }];
      }
    }
    if (this.operation === 'picking.pick_to_tote.register_tote') {
      if (index === 0) return [{ id: 'warehouse-1' }];
    }
    if (this.operation === 'picking.pick_to_tote.scan') {
      if (index === 0) return [{ shipmentId: PICKING_CONTRACT_IDS.shipmentA, skuId: PICKING_CONTRACT_IDS.sku }];
      if (index === 1) return [{ qty: 2 }];
      if (index === 2) {
        return [
          {
            qty: this.balances
              .filter((balance) => balance.shipmentLineId === PICKING_CONTRACT_IDS.lineA)
              .reduce((sum, balance) => sum + balance.qty, 0),
          },
        ];
      }
    }
    if (this.operation === 'picking.pick_to_tote.complete') {
      return this.assignedBalances(PICKING_CONTRACT_IDS.lineA).map((balance) => ({
        id: balance.id,
        custodyType: balance.custodyType,
        custodyRef: balance.custodyRef,
        qty: balance.qty,
      }));
    }
    if (this.operation === 'picking.pick_to_tote.unpick') {
      return this.assignedBalances(PICKING_CONTRACT_IDS.lineA).map((balance) => ({ ...balance }));
    }
    throw new Error(`Unexpected select ${index} during ${this.operation}`);
  }

  applyInsert(values: unknown): unknown[] {
    const index = this.insertIndex++;
    if (this.operation === 'picking.pick_to_tote.plan') {
      if (index === 0) return [{ id: PICKING_CONTRACT_IDS.plan, version: 1, status: 'draft' }];
      if (index === 1) return [];
      if (index === 2) {
        const shipmentByLine: Record<string, string> = {
          [PICKING_CONTRACT_IDS.lineA]: PICKING_CONTRACT_IDS.shipmentA,
          [PICKING_CONTRACT_IDS.lineB]: PICKING_CONTRACT_IDS.shipmentB,
        };
        for (const value of values as Array<Record<string, unknown>>) {
          this.allocations.push({
            shipmentId: shipmentByLine[value.shipmentLineId as string],
            shipmentLineId: value.shipmentLineId as string,
            skuId: PICKING_CONTRACT_IDS.sku,
            sourceLocationId: value.sourceLocationId as string,
            quantity: value.qty as number,
            sourceStockVersion: value.sourceStockVersion as number,
          });
        }
        return [];
      }
    }
    if (this.operation === 'picking.pick_to_tote.register_tote') {
      this.registered = true;
      return [this.toteRow('available')];
    }
    if (this.operation === 'picking.pick_to_tote.assign_tote') {
      this.assigned = true;
      return [this.assignmentRow()];
    }
    throw new Error(`Unexpected insert ${index} during ${this.operation}`);
  }

  applyUpdate(values: Record<string, unknown>): void {
    if (this.operation === 'picking.pick_to_tote.assign_tote') {
      this.toteVersion = values.version as number;
      return;
    }
    const workItemId = this.request.workItemId as string | undefined;
    if (
      (this.operation === 'picking.pick_to_tote.complete' || this.operation === 'picking.pick_to_tote.unpick') &&
      workItemId
    ) {
      Object.assign(this.workItems[workItemId], values);
      return;
    }
    throw new Error(`Unexpected update during ${this.operation}`);
  }

  updateResourceId(): string {
    return this.operation === 'picking.pick_to_tote.assign_tote' ? 'tote-contract' : PICKING_CONTRACT_IDS.workItemA;
  }

  startSession(actorId: string): void {
    this.handedIn = this.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    this.balances.splice(0, this.balances.length, {
      id: 'balance-source',
      skuId: PICKING_CONTRACT_IDS.sku,
      shipmentLineId: null,
      sourceLocationId: PICKING_CONTRACT_IDS.source,
      custodyType: 'AT_SOURCE',
      custodyRef: null,
      qty: this.handedIn,
    });
    for (const item of Object.values(this.workItems)) {
      Object.assign(item, {
        status: 'picking',
        pickerId: actorId,
        pickerReleasedAt: null,
        leaseVersion: 1,
        leaseExpiresAt: new Date('2026-07-15T00:20:00.000Z'),
      });
    }
  }

  moveCustody(input: Record<string, any>): void {
    const from = input.from as Record<string, unknown>;
    const to = input.to as Record<string, unknown>;
    const source = this.balance({
      skuId: from.skuId as string,
      sourceLocationId: from.sourceLocationId as string,
      custodyType: from.custodyType as ContractCustodyType,
      custodyRef: (from.custodyRef as string | undefined) ?? null,
      shipmentLineId: (from.shipmentLineId as string | undefined) ?? null,
    });
    if (!source || source.qty < input.quantity) throw new Error('pick-to-tote contract custody underflow');
    source.qty -= input.quantity;
    const grain = {
      skuId: to.skuId as string,
      sourceLocationId: to.sourceLocationId as string,
      custodyType: to.custodyType as ContractCustodyType,
      custodyRef: (to.custodyRef as string | undefined) ?? null,
      shipmentLineId: (to.shipmentLineId as string | undefined) ?? null,
    };
    const target = this.balance(grain);
    if (target) target.qty += input.quantity;
    else this.balances.push({ id: `balance-${this.balances.length + 1}`, ...grain, qty: input.quantity });
    for (let index = this.balances.length - 1; index >= 0; index -= 1) {
      if (this.balances[index].qty === 0) this.balances.splice(index, 1);
    }
  }

  allocationsForShipment(shipmentId: string) {
    return this.allocations
      .filter((allocation) => allocation.shipmentId === shipmentId)
      .map((allocation) => ({
        shipmentLineId: allocation.shipmentLineId,
        skuId: allocation.skuId,
        sourceLocationId: allocation.sourceLocationId,
        qty: allocation.quantity,
      }));
  }

  assignedBalances(lineId: string): ContractBalance[] {
    return this.balances.filter((balance) => balance.shipmentLineId === lineId && balance.qty > 0);
  }

  toteRow(status: 'available' | 'in_use') {
    return {
      id: 'tote-contract',
      warehouseId: 'warehouse-1',
      barcode: 'TOTE-CONTRACT',
      status,
      version: this.toteVersion,
      createdAt: new Date('2026-07-15T00:00:00.000Z'),
      updatedAt: new Date('2026-07-15T00:00:00.000Z'),
    };
  }

  assignmentRow() {
    return {
      id: 'assignment-contract',
      shipmentId: PICKING_CONTRACT_IDS.shipmentA,
      toteId: 'tote-contract',
      assignedBy: PICKING_CONTRACT_IDS.actor,
      assignedAt: new Date('2026-07-15T00:00:00.000Z'),
      releasedAt: null,
    };
  }

  private balance(grain: Omit<ContractBalance, 'id' | 'qty'>): ContractBalance | undefined {
    return this.balances.find(
      (balance) =>
        balance.skuId === grain.skuId &&
        balance.sourceLocationId === grain.sourceLocationId &&
        balance.custodyType === grain.custodyType &&
        balance.custodyRef === grain.custodyRef &&
        balance.shipmentLineId === grain.shipmentLineId,
    );
  }

  private workItem(id: string, shipmentId: string): Record<string, any> {
    return {
      id,
      batchId: PICKING_CONTRACT_IDS.batch,
      shipmentId,
      status: 'queued',
      pickerId: null,
      pickerReleasedAt: null,
      leaseVersion: 0,
      leaseExpiresAt: null,
    };
  }
}

function createPickToToteContractFixture(): PickingStrategyContractFixture {
  const state = new PickToToteContractState();
  let shipmentARetired = false;
  const tx = {
    select: jest.fn(() => new QueryResult(state.selectRows())),
    insert: jest.fn(() => new ContractInsertResult(state)),
    update: jest.fn(() => new ContractUpdateResult(state)),
  };
  const commands = {
    execute: jest.fn(async (request, handler) => {
      const replayKey = `${request.commandType}:${request.idempotencyKey}`;
      if (state.replay.has(replayKey)) return state.replay.get(replayKey);
      state.begin(request.commandType, request.canonicalRequest);
      const envelope = await handler(tx, `operation:${request.idempotencyKey}`);
      state.replay.set(replayKey, envelope.response);
      return envelope.response;
    }),
  };
  const sessions = {
    startSession: jest.fn(async (_batchId, _planId, _tx, actorId) => {
      state.startSession(actorId);
      return { id: PICKING_CONTRACT_IDS.session, status: 'active' };
    }),
    moveCustody: jest.fn(async (input) => state.moveCustody(input)),
  };
  const controlledStock = { getAvailability: jest.fn(), writeStockLedger: jest.fn() };
  const invoices = { assertDispatchableInvoice: jest.fn(), issue: jest.fn(), void: jest.fn() };
  const Strategy = PickToTotePickingStrategy as any;
  const strategy: PickToTotePickingStrategy = new Strategy(
    {},
    commands,
    { assertV2MutationAllowed: jest.fn() },
    {},
    sessions,
    controlledStock,
    invoices,
    { handoff: jest.fn() },
    { logUserActionRequired: jest.fn() },
  );
  const aggregate = {
    batch: { id: PICKING_CONTRACT_IDS.batch, warehouseId: 'warehouse-1' },
    shipments: [
      { id: PICKING_CONTRACT_IDS.shipmentA, manifestVersion: 1, reservationVersion: 1 },
      { id: PICKING_CONTRACT_IDS.shipmentB, manifestVersion: 1, reservationVersion: 1 },
    ],
    lines: [
      {
        id: PICKING_CONTRACT_IDS.lineA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        skuId: PICKING_CONTRACT_IDS.sku,
        qty: 2,
      },
      {
        id: PICKING_CONTRACT_IDS.lineB,
        shipmentId: PICKING_CONTRACT_IDS.shipmentB,
        skuId: PICKING_CONTRACT_IDS.sku,
        qty: 3,
      },
    ],
    workItems: Object.values(state.workItems),
  };
  jest.spyOn(strategy as any, 'lockAggregate').mockResolvedValue(aggregate);
  jest.spyOn(strategy as any, 'assertWarehouseConfiguration').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'assertPlanningEligibility').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'lockSourceCapacities').mockResolvedValue([
    {
      skuId: PICKING_CONTRACT_IDS.sku,
      sourceLocationId: PICKING_CONTRACT_IDS.source,
      stockVersion: 7,
      remainingQty: 5,
    },
  ]);
  jest.spyOn(strategy as any, 'planStalenessReason').mockResolvedValue(null);
  jest.spyOn(strategy as any, 'assertActivePlanSession').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'assertPlanMembers').mockImplementation(async (_planId, shipmentIds: string[]) => {
    if (shipmentARetired && shipmentIds.includes(PICKING_CONTRACT_IDS.shipmentA)) {
      throw new ConflictException({
        code: 'PICKING_SHIPMENT_NOT_IN_PLAN',
        message: 'Retired shipment is not an active plan member',
      });
    }
  });
  jest.spyOn(strategy as any, 'acquireToteLock').mockResolvedValue(undefined);
  jest
    .spyOn(strategy as any, 'lockAndAssertPickerClaim')
    .mockImplementation(async (workItemId) => state.workItems[workItemId]);
  jest.spyOn(strategy as any, 'loadWorkItem').mockImplementation(async (workItemId) => state.workItems[workItemId]);
  jest
    .spyOn(strategy as any, 'loadShipmentAllocations')
    .mockImplementation(async (_planId, shipmentId) => state.allocationsForShipment(shipmentId));
  jest
    .spyOn(strategy as any, 'loadToteByBarcode')
    .mockImplementation(async () =>
      state.registered ? state.toteRow(state.assigned ? 'in_use' : 'available') : undefined,
    );
  jest
    .spyOn(strategy as any, 'loadToteForBatch')
    .mockImplementation(async () => state.toteRow(state.assigned ? 'in_use' : 'available'));
  jest
    .spyOn(strategy as any, 'loadActiveToteAssignments')
    .mockImplementation(async () => (state.assigned ? [state.assignmentRow()] : []));
  jest.spyOn(strategy as any, 'requireActiveToteAssignment').mockImplementation(async () => {
    if (!state.assigned) throw new ConflictException({ code: 'TOTE_NOT_ASSIGNED', message: 'not assigned' });
    return state.assignmentRow();
  });
  jest
    .spyOn(strategy as any, 'loadActiveShipmentToteRefs')
    .mockImplementation(async () => new Set(state.assigned ? ['tote:tote-contract'] : []));
  jest.spyOn(strategy as any, 'releaseEmptyShipmentTotes').mockImplementation(async () => {
    state.assigned = false;
  });
  jest.spyOn(strategy as any, 'databaseNow').mockResolvedValue(new Date('2026-07-15T00:10:00.000Z'));

  return {
    strategy,
    pickShipmentA: async () => {
      await strategy.registerTote({
        warehouseId: 'warehouse-1',
        toteBarcode: 'TOTE-CONTRACT',
        actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
        idempotencyKey: 'register-contract-tote',
      });
      await strategy.assignTote({
        batchId: PICKING_CONTRACT_IDS.batch,
        planId: PICKING_CONTRACT_IDS.plan,
        sessionId: PICKING_CONTRACT_IDS.session,
        workItemId: PICKING_CONTRACT_IDS.workItemA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        toteBarcode: 'TOTE-CONTRACT',
        actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
        expectedLeaseVersion: 1,
        idempotencyKey: 'assign-contract-tote',
      });
      const input: ToteScanPickingInput = {
        strategy: 'pick_to_tote',
        stage: 'source',
        batchId: PICKING_CONTRACT_IDS.batch,
        planId: PICKING_CONTRACT_IDS.plan,
        sessionId: PICKING_CONTRACT_IDS.session,
        workItemId: PICKING_CONTRACT_IDS.workItemA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        shipmentLineId: PICKING_CONTRACT_IDS.lineA,
        skuId: PICKING_CONTRACT_IDS.sku,
        sourceLocationId: PICKING_CONTRACT_IDS.source,
        toteBarcode: 'TOTE-CONTRACT',
        quantity: 2,
        actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
        expectedLeaseVersion: 1,
        idempotencyKey: 'scan-a',
      };
      const first = await strategy.scan(input);
      const replay = await strategy.scan(input);
      return { first, replay };
    },
    retireShipmentA: () => {
      shipmentARetired = true;
      Object.assign(state.workItems[PICKING_CONTRACT_IDS.workItemA], {
        status: 'short_pick_recovery',
        recoveryReason: 'one unit missing',
      });
    },
    attemptRetiredShipmentA: () =>
      strategy.assignTote({
        batchId: PICKING_CONTRACT_IDS.batch,
        planId: PICKING_CONTRACT_IDS.plan,
        sessionId: PICKING_CONTRACT_IDS.session,
        workItemId: PICKING_CONTRACT_IDS.workItemA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        toteBarcode: 'TOTE-CONTRACT',
        actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
        expectedLeaseVersion: 1,
        idempotencyKey: 'retired-assign-tote-a',
      }),
    snapshot: () => {
      const custodyTotal = (type: ContractCustodyType) =>
        state.balances.filter((balance) => balance.custodyType === type).reduce((sum, balance) => sum + balance.qty, 0);
      const atSource = custodyTotal('AT_SOURCE');
      const worker = custodyTotal('WORKER');
      const bulkCart = custodyTotal('BULK_CART');
      const tote = custodyTotal('TOTE');
      const sorting = custodyTotal('SORTING');
      const packing = custodyTotal('PACKING');
      return {
        allocations: state.allocations.map((allocation) => ({ ...allocation })),
        custody: {
          atSource,
          worker,
          bulkCart,
          tote,
          sorting,
          packing,
          total: atSource + worker + bulkCart + tote + sorting + packing,
          handedIn: state.handedIn,
        },
        workItemStatuses: Object.fromEntries(
          Object.entries(state.workItems).map(([id, item]) => [id, item.status as string]),
        ),
        physicalToteCount: state.registered ? 1 : 0,
        forbiddenEffects: {
          stockLedgerWrites: controlledStock.writeStockLedger.mock.calls.length,
          reservationConsumptions: 0,
          invoiceMutations: invoices.issue.mock.calls.length + invoices.void.mock.calls.length,
          fulfillmentProgressWrites: 0,
          shipmentEventsPublished: 0,
        },
      };
    },
  };
}

definePickingStrategyContract('production pick-to-tote', createPickToToteContractFixture);
