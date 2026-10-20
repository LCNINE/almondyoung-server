import { PgDialect } from 'drizzle-orm/pg-core';
import { cartLockKey } from './aggregate-then-sort.strategy';
import {
  completeWorkItemPick,
  CustodyCommandDeps,
  ForwardWorkItemCommand,
  handoffWorkItemPicker,
  PickingCustodyPolicy,
  runForwardWorkItemCommand,
  unpickWorkItemShipment,
  WorkItemCommandDeps,
} from './work-item-command';
import {
  assertActiveBatchSession,
  databaseNow,
  loadPositiveShipmentCustody,
  loadWorkItem,
  loadWorkItemAllocations,
  lockAndAssertPickerClaim,
} from './allocation/allocation.queries';
import { spotsOf } from './work-item-custody-judgement';

jest.mock('./allocation/allocation.queries', () => ({
  lockAndAssertPickerClaim: jest.fn(),
  assertActiveBatchSession: jest.fn(),
  assertWorkItemIdentity: jest.fn(),
  loadWorkItem: jest.fn(),
  loadWorkItemAllocations: jest.fn(),
  loadPositiveShipmentCustody: jest.fn(),
  databaseNow: jest.fn(),
}));

describe('runForwardWorkItemCommand', () => {
  const calls: string[] = [];
  const fakeTrx = { execute: jest.fn() };
  const execute = jest.fn();
  const assertV2MutationAllowed = jest.fn();
  const assertCurrent = jest.fn();

  const deps = {
    commands: { execute },
    workflowGate: { assertV2MutationAllowed },
    labels: { assertCurrent },
  } as unknown as WorkItemCommandDeps;

  const command: ForwardWorkItemCommand = {
    strategy: 'discrete',
    commandType: 'picking.x.y',
    canonicalRequest: { a: 1 },
    target: {
      batchId: 'b1',
      sessionId: 's1',
      workItemId: 'w1',
      shipmentId: 'sh1',
      actor: { id: 'u1' } as ForwardWorkItemCommand['target']['actor'],
      expectedLeaseVersion: 3,
      idempotencyKey: ' k1 ',
    },
  };

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    assertV2MutationAllowed.mockImplementation((name: string) => calls.push(`workflowGate:${name}`));
    execute.mockImplementation(async (_input, handler) => {
      calls.push('execute');
      return (await handler(fakeTrx, 'cmd-1', 'hash')).response;
    });
    fakeTrx.execute.mockImplementation(async () => calls.push('lock'));
    (lockAndAssertPickerClaim as jest.Mock).mockImplementation(async () => calls.push('claim'));
    assertCurrent.mockImplementation(async () => calls.push('label'));
    (assertActiveBatchSession as jest.Mock).mockImplementation(async () => calls.push('session'));
  });

  const body = async () => {
    calls.push('body');
    return { response: 'ok', resourceType: 'r', resourceId: 'i' };
  };

  it('runs gate → execute → locksBefore → claim → label gate → session → body in that order', async () => {
    const result = await runForwardWorkItemCommand(deps, { ...command, locksBefore: ['k'] }, body);
    expect(result).toBe('ok');
    expect(calls).toEqual(['workflowGate:picking.x.y', 'execute', 'lock', 'claim', 'label', 'session', 'body']);
  });

  it('passes commandType, trimmed-as-given idempotencyKey and canonicalRequest to commands.execute unchanged', async () => {
    await runForwardWorkItemCommand(deps, command, body);
    expect(execute.mock.calls[0][0]).toEqual({
      commandType: 'picking.x.y',
      idempotencyKey: ' k1 ',
      canonicalRequest: { a: 1 },
    });
  });

  it('calls claim, session and label guards with the target fields', async () => {
    const tx = {} as never;
    await runForwardWorkItemCommand(deps, command, body, tx);
    expect(execute.mock.calls[0][2]).toBe(tx);
    expect(lockAndAssertPickerClaim).toHaveBeenCalledWith(fakeTrx, 'w1', 'b1', 'sh1', 'u1', 3);
    expect(assertActiveBatchSession).toHaveBeenCalledWith(fakeTrx, 's1', 'b1', 'discrete');
    expect(assertCurrent).toHaveBeenCalledWith('w1', fakeTrx);
  });

  it('takes no advisory lock when locksBefore is omitted', async () => {
    await runForwardWorkItemCommand(deps, command, body);
    expect(fakeTrx.execute).not.toHaveBeenCalled();
  });

  it('takes one advisory lock per key, in order, with the one lock SQL', async () => {
    await runForwardWorkItemCommand(deps, { ...command, locksBefore: ['a', cartLockKey('c1')] }, body);
    const dialect = new PgDialect();
    const queries = fakeTrx.execute.mock.calls.map(([query]) => {
      const { sql, params } = dialect.sqlToQuery(query);
      return { sql, params };
    });
    expect(queries).toEqual([
      { sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', params: ['a'] },
      { sql: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', params: ['aggregate-cart:c1'] },
    ]);
  });
});

describe('custody command bodies (policy call positions)', () => {
  const calls: string[] = [];
  const now = new Date('2026-10-19T00:00:00Z');
  const execute = jest.fn();
  const assertV2MutationAllowed = jest.fn();
  const assertCurrent = jest.fn();
  const moveCustody = jest.fn();
  const batchHandoff = jest.fn();
  const loadHeldSpots = jest.fn();
  const afterUnpick = jest.fn();
  let selectRows: unknown[] = [];

  const query = {
    from: () => query,
    where: () => query,
    orderBy: async () => {
      calls.push('balances');
      return selectRows;
    },
  };
  const update = {
    set: () => update,
    where: () => update,
    returning: async () => {
      calls.push('update');
      return [{ id: 'w1' }];
    },
  };
  const fakeTrx = { execute: jest.fn(), select: jest.fn(() => query), update: jest.fn(() => update) };

  const deps = {
    commands: { execute },
    workflowGate: { assertV2MutationAllowed },
    labels: { assertCurrent },
    sessions: { moveCustody },
    batches: { handoff: batchHandoff },
  } as unknown as CustodyCommandDeps;

  const policy = (over: Partial<PickingCustodyPolicy> = {}): PickingCustodyPolicy => ({
    strategy: 'discrete',
    keys: { complete: 'k-complete', unpick: 'k-unpick', handoffClaim: 'k-handoff-claim' },
    supervises: () => false,
    loadHeldSpots,
    completeMovesFrom: 'WORKER',
    handoffCustody: {
      custodyType: 'WORKER',
      refFor: (_workItemId, workerId) => workerId,
      key: 'k-handoff',
      corruptMessage: (id) => `corrupt ${id}`,
    },
    afterUnpick,
    messages: {
      completeIncomplete: () => ({ code: 'PICKING_INCOMPLETE', message: 'incomplete' }),
      ownerMismatchWhilePicking: () => 'owner mismatch',
      handoffOwnerMismatch: () => 'handoff owner mismatch',
    },
    ...over,
  });

  const target = {
    batchId: 'b1',
    sessionId: 's1',
    workItemId: 'w1',
    shipmentId: 'sh1',
    actor: { id: 'u1', roles: [] },
    expectedLeaseVersion: 3,
    idempotencyKey: 'idem-1',
  };
  const handoffInput = { ...target, targetWorkerId: 'u2', reason: ' r ' };
  const allocation = (line: string, qty = 1) => ({
    id: `a-${line}`,
    shipmentLineId: line,
    skuId: 'sku-1',
    sourceLocationId: 'loc-1',
    qty,
  });
  const balance = (id: string, custodyType: string, custodyRef: string, line = 'line-1') => ({
    id,
    skuId: 'sku-1',
    sourceLocationId: 'loc-1',
    custodyType,
    custodyRef,
    shipmentLineId: line,
    qty: 1,
  });
  const workItem = (status: string, pickerId = 'u1') => ({
    id: 'w1',
    batchId: 'b1',
    shipmentId: 'sh1',
    status,
    pickerId,
    leaseVersion: 3,
    pickerReleasedAt: status === 'picking' ? null : now,
    leaseExpiresAt: status === 'picking' ? new Date(now.getTime() + 60_000) : null,
  });
  const mockAllocations = (rows: ReturnType<typeof allocation>[]) =>
    (loadWorkItemAllocations as jest.Mock).mockImplementation(async () => {
      calls.push('allocations');
      return rows;
    });
  const mockShipmentCustody = (rows: ReturnType<typeof balance>[]) =>
    (loadPositiveShipmentCustody as jest.Mock).mockImplementation(async () => {
      calls.push('shipmentCustody');
      return rows;
    });

  beforeEach(() => {
    calls.length = 0;
    selectRows = [];
    jest.clearAllMocks();
    execute.mockImplementation(async (_input, handler) => (await handler(fakeTrx, 'cmd-1', 'hash')).response);
    (databaseNow as jest.Mock).mockResolvedValue(now);
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking'));
    mockAllocations([allocation('line-1'), allocation('line-2')]);
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u1', 'line-1'), balance('bal-2', 'WORKER', 'u1', 'line-2')]);
    (assertActiveBatchSession as jest.Mock).mockImplementation(async () => calls.push('session'));
    loadHeldSpots.mockImplementation(async (_trx, ctx: { pickerId: string }) => {
      calls.push(`held:${ctx.pickerId}`);
      return spotsOf([{ custodyType: 'WORKER', refs: new Set([ctx.pickerId]) }]);
    });
    moveCustody.mockImplementation(async (move: { idempotencyKey: string }) =>
      calls.push(`move:${move.idempotencyKey}`),
    );
    afterUnpick.mockImplementation(async () => calls.push('afterUnpick'));
    batchHandoff.mockImplementation(async () => {
      calls.push('batches.handoff');
      return { workItem: { batchId: 'b1', shipmentId: 'sh1', pickerId: 'u2', leaseVersion: 4 } };
    });
  });

  it('completePick calls loadHeldSpots once, after allocations load and before the first moveCustody', async () => {
    mockAllocations([allocation('line-1')]);
    selectRows = [balance('bal-1', 'WORKER', 'u1')];
    await completeWorkItemPick(deps, policy(), target);
    expect(loadHeldSpots).toHaveBeenCalledTimes(1);
    expect(loadHeldSpots.mock.calls[0][1]).toEqual({ workItemId: 'w1', shipmentId: 'sh1', pickerId: 'u1' });
    expect(calls).toEqual(['session', 'allocations', 'held:u1', 'balances', 'move:k-complete:cmd-1:bal-1', 'update']);
  });

  it('completePick throws emptyHeldOnComplete before any balance query when held is empty', async () => {
    loadHeldSpots.mockResolvedValue(spotsOf([{ custodyType: 'TOTE', refs: new Set<string>() }]));
    const tote = policy({ emptyHeldOnComplete: { code: 'TOTE_ASSIGNMENT_REQUIRED', message: 'none' } });
    await expect(completeWorkItemPick(deps, tote, target)).rejects.toMatchObject({
      response: { code: 'TOTE_ASSIGNMENT_REQUIRED', message: 'none' },
    });
    expect(calls).not.toContain('balances');
  });

  it('completePick moves only completeMovesFrom rows to the work item PACKING ref', async () => {
    mockAllocations([allocation('line-1', 2)]);
    loadHeldSpots.mockResolvedValue(
      spotsOf([
        { custodyType: 'SORTING', refs: new Set(['sorting:w1:u1']) },
        { custodyType: 'PACKING', refs: new Set(['work-item:w1']) },
      ]),
    );
    selectRows = [balance('bal-1', 'PACKING', 'work-item:w1'), balance('bal-2', 'SORTING', 'sorting:w1:u1')];
    await completeWorkItemPick(deps, policy({ completeMovesFrom: 'SORTING' }), target);
    expect(moveCustody).toHaveBeenCalledTimes(1);
    expect(moveCustody.mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'k-complete:cmd-1:bal-2',
      from: { custodyType: 'SORTING', custodyRef: 'sorting:w1:u1', shipmentLineId: 'line-1' },
      to: { custodyType: 'PACKING', custodyRef: 'work-item:w1', shipmentLineId: 'line-1' },
    });
  });

  it('unpick calls loadHeldSpots only when the work item is picking', async () => {
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('ready_to_pack'));
    mockShipmentCustody([
      balance('bal-1', 'PACKING', 'work-item:w1', 'line-1'),
      balance('bal-2', 'PACKING', 'work-item:w1', 'line-2'),
    ]);
    await unpickWorkItemShipment(deps, policy(), target);
    expect(loadHeldSpots).not.toHaveBeenCalled();

    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking'));
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u1', 'line-1')]);
    await unpickWorkItemShipment(deps, policy(), target);
    expect(loadHeldSpots).toHaveBeenCalledTimes(1);
    expect(loadHeldSpots.mock.calls[0][1]).toEqual({ workItemId: 'w1', shipmentId: 'sh1', pickerId: 'u1' });
  });

  it('unpick reports a grain violation before calling loadHeldSpots', async () => {
    mockShipmentCustody([balance('bal-9', 'WORKER', 'u1', 'line-9')]);
    await expect(unpickWorkItemShipment(deps, policy(), target)).rejects.toMatchObject({
      response: { code: 'PICKING_CUSTODY_GRAIN_MISMATCH', message: 'Balance bal-9 is not a work item allocation' },
    });
    expect(loadHeldSpots).not.toHaveBeenCalled();
  });

  it('unpick picking owner mismatch uses the policy message with the offending balance', async () => {
    const ownerMismatchWhilePicking = jest.fn(() => 'owner mismatch');
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u1', 'line-1'), balance('bal-2', 'WORKER', 'u9', 'line-2')]);
    const base = policy();
    await expect(
      unpickWorkItemShipment(deps, { ...base, messages: { ...base.messages, ownerMismatchWhilePicking } }, target),
    ).rejects.toMatchObject({ response: { code: 'PICKING_CUSTODY_OWNER_MISMATCH', message: 'owner mismatch' } });
    expect(ownerMismatchWhilePicking).toHaveBeenCalledWith({ balanceId: 'bal-2', pickerId: 'u1', shipmentId: 'sh1' });
    expect(moveCustody).not.toHaveBeenCalled();
  });

  it('unpick calls afterUnpick after every moveCustody and before the requeue update', async () => {
    await unpickWorkItemShipment(deps, policy(), target);
    expect(calls.slice(-4)).toEqual([
      'move:k-unpick:cmd-1:bal-1',
      'move:k-unpick:cmd-1:bal-2',
      'afterUnpick',
      'update',
    ]);
    expect(afterUnpick).toHaveBeenCalledWith(fakeTrx, 'sh1');
  });

  it('handoff calls loadHeldSpots before and after batches.handoff with the old owner', async () => {
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking', 'u-old'));
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u-old')]);
    await handoffWorkItemPicker(deps, policy(), handoffInput);
    expect(calls).toEqual([
      'shipmentCustody',
      'held:u-old',
      'batches.handoff',
      'session',
      'shipmentCustody',
      'held:u-old',
      'move:k-handoff:cmd-1:bal-1',
    ]);
    expect(moveCustody.mock.calls[0][0]).toMatchObject({
      from: { custodyType: 'WORKER', custodyRef: 'u-old' },
      to: { custodyType: 'WORKER', custodyRef: 'u2' },
    });
  });

  it('handoff owner mismatch uses the policy message and stops before batches.handoff', async () => {
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking', 'u-old'));
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u9')]);
    await expect(handoffWorkItemPicker(deps, policy(), handoffInput)).rejects.toMatchObject({
      response: { code: 'PICKING_CUSTODY_OWNER_MISMATCH', message: 'handoff owner mismatch' },
    });
    expect(batchHandoff).not.toHaveBeenCalled();
  });

  it('handoff to the same worker moves nothing even when handoffCustody is set', async () => {
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking', 'u2'));
    mockShipmentCustody([balance('bal-1', 'WORKER', 'u2')]);
    const result = await handoffWorkItemPicker(deps, policy(), handoffInput);
    expect(moveCustody).not.toHaveBeenCalled();
    expect(result).toMatchObject({ movedQty: 0, workerId: 'u2', leaseVersion: 4 });
  });

  it('handoff without handoffCustody moves nothing', async () => {
    const result = await handoffWorkItemPicker(deps, policy({ handoffCustody: undefined }), handoffInput);
    expect(moveCustody).not.toHaveBeenCalled();
    expect(result).toMatchObject({ movedQty: 0 });
  });

  it('rollback bodies never call labels.assertCurrent', async () => {
    await unpickWorkItemShipment(deps, policy(), target);
    await handoffWorkItemPicker(deps, policy(), handoffInput);
    expect(assertCurrent).not.toHaveBeenCalled();
  });

  it('completePick refuses a held row that is neither completeMovesFrom nor this work item PACKING (policy mismatch)', async () => {
    mockAllocations([allocation('line-1')]);
    loadHeldSpots.mockResolvedValue(spotsOf([{ custodyType: 'TOTE', refs: new Set(['tote:t1']) }]));
    selectRows = [balance('bal-1', 'TOTE', 'tote:t1')];
    await expect(completeWorkItemPick(deps, policy({ completeMovesFrom: 'WORKER' }), target)).rejects.toThrow(
      "completePick: held balance bal-1 is TOTE, not WORKER or this work item's PACKING",
    );
    expect(moveCustody).not.toHaveBeenCalled();
  });

  it('handoff skips only this work item PACKING row and refuses any other non-moving held row', async () => {
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking', 'u-old'));
    loadHeldSpots.mockResolvedValue(
      spotsOf([
        { custodyType: 'WORKER', refs: new Set(['u-old']) },
        { custodyType: 'PACKING', refs: new Set(['work-item:w1']) },
      ]),
    );
    mockShipmentCustody([balance('bal-1', 'PACKING', 'work-item:w1'), balance('bal-2', 'WORKER', 'u-old', 'line-2')]);
    await handoffWorkItemPicker(deps, policy(), handoffInput);
    expect(moveCustody.mock.calls.map(([move]) => move.idempotencyKey)).toEqual(['k-handoff:cmd-1:bal-2']);

    moveCustody.mockClear();
    loadHeldSpots.mockResolvedValue(spotsOf([{ custodyType: 'TOTE', refs: new Set(['tote:t1']) }]));
    mockShipmentCustody([balance('bal-3', 'TOTE', 'tote:t1')]);
    await expect(handoffWorkItemPicker(deps, policy(), handoffInput)).rejects.toThrow(
      "handoff: held balance bal-3 is TOTE, not WORKER or this work item's PACKING",
    );
    expect(moveCustody).not.toHaveBeenCalled();
  });

  it('tote: commandType and moveCustody keys come from policy.strategy and policy.keys; handoff moves nothing', async () => {
    const tote = policy({
      strategy: 'pick_to_tote',
      keys: {
        complete: 'pick-to-tote-complete',
        unpick: 'pick_to_tote-unpick',
        handoffClaim: 'pick_to_tote-handoff-claim',
      },
      completeMovesFrom: 'TOTE',
      handoffCustody: undefined,
    });
    loadHeldSpots.mockImplementation(async () => spotsOf([{ custodyType: 'TOTE', refs: new Set(['tote:t1']) }]));
    mockShipmentCustody([balance('bal-1', 'TOTE', 'tote:t1', 'line-1'), balance('bal-2', 'TOTE', 'tote:t1', 'line-2')]);
    await unpickWorkItemShipment(deps, tote, target);
    expect(assertV2MutationAllowed).toHaveBeenLastCalledWith('picking.pick_to_tote.unpick');
    expect(execute.mock.calls[0][0]).toEqual({
      commandType: 'picking.pick_to_tote.unpick',
      idempotencyKey: 'idem-1',
      canonicalRequest: {
        strategy: 'pick_to_tote',
        batchId: 'b1',
        sessionId: 's1',
        workItemId: 'w1',
        shipmentId: 'sh1',
        actorId: 'u1',
        actorRoles: [],
        expectedLeaseVersion: 3,
      },
    });
    expect(moveCustody.mock.calls[0][0].idempotencyKey).toBe('pick_to_tote-unpick:cmd-1:bal-1');

    moveCustody.mockClear();
    const handedOff = await handoffWorkItemPicker(deps, tote, handoffInput);
    expect(assertV2MutationAllowed).toHaveBeenLastCalledWith('picking.pick_to_tote.handoff');
    expect(execute.mock.calls[1][0].commandType).toBe('picking.pick_to_tote.handoff');
    expect(execute.mock.calls[1][0].canonicalRequest).toMatchObject({ strategy: 'pick_to_tote', reason: 'r' });
    expect(batchHandoff.mock.calls[0][2]).toBe('pick_to_tote-handoff-claim:cmd-1');
    expect(batchHandoff.mock.calls[0][1]).toMatchObject({ reason: ' r ' });
    expect(moveCustody).not.toHaveBeenCalled();
    expect(handedOff).toMatchObject({ movedQty: 0 });

    mockAllocations([allocation('line-1')]);
    selectRows = [balance('bal-1', 'TOTE', 'tote:t1')];
    await completeWorkItemPick(deps, tote, target);
    expect(assertV2MutationAllowed).toHaveBeenLastCalledWith('picking.pick_to_tote.complete');
    expect(execute.mock.calls[2][0].commandType).toBe('picking.pick_to_tote.complete');
    expect(moveCustody.mock.calls[0][0].idempotencyKey).toBe('pick-to-tote-complete:cmd-1:bal-1');
  });

  it('aggregate: handoff moveCustody key and refs come from handoffCustody', async () => {
    const aggregate = policy({
      strategy: 'aggregate_then_sort',
      keys: { complete: 'aggregate-complete', unpick: 'aggregate-unpick', handoffClaim: 'aggregate-handoff-claim' },
      completeMovesFrom: 'SORTING',
      handoffCustody: {
        custodyType: 'SORTING',
        refFor: (workItemId, workerId) => `sorting:${workItemId}:${workerId}`,
        key: 'aggregate-handoff',
        corruptMessage: (id) => `Sorting balance ${id} is incomplete`,
      },
    });
    (loadWorkItem as jest.Mock).mockResolvedValue(workItem('picking', 'u-old'));
    loadHeldSpots.mockImplementation(async (_trx, ctx: { workItemId: string; pickerId: string }) =>
      spotsOf([{ custodyType: 'SORTING', refs: new Set([`sorting:${ctx.workItemId}:${ctx.pickerId}`]) }]),
    );
    mockShipmentCustody([balance('bal-1', 'SORTING', 'sorting:w1:u-old')]);
    await handoffWorkItemPicker(deps, aggregate, handoffInput);
    expect(execute.mock.calls[0][0].commandType).toBe('picking.aggregate_then_sort.handoff');
    expect(batchHandoff.mock.calls[0][2]).toBe('aggregate-handoff-claim:cmd-1');
    expect(moveCustody.mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'aggregate-handoff:cmd-1:bal-1',
      from: { custodyType: 'SORTING', custodyRef: 'sorting:w1:u-old' },
      to: { custodyType: 'SORTING', custodyRef: 'sorting:w1:u2' },
    });
  });
});
