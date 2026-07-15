/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import { AggregateThenSortPickingStrategy } from './aggregate-then-sort.strategy';
import {
  PICKING_CONTRACT_IDS,
  PickingContractAllocation,
  PickingStrategyContractFixture,
  definePickingStrategyContract,
} from './picking-strategy.contract.spec';
import {
  AggregateCartHandoffInput,
  AggregateSortScanInput,
  AggregateSourceScanInput,
  CompletePickInput,
  HandoffPickingInput,
  UnpickShipmentInput,
} from './picking-strategy.interface';

const IDS = Object.freeze({
  ...PICKING_CONTRACT_IDS,
  otherActor: 'worker-2',
  manager: 'manager-1',
  cart: 'CART-001',
  otherCart: 'CART-002',
});

type CustodyType = 'AT_SOURCE' | 'BULK_CART' | 'SORTING' | 'PACKING';

interface CustodyBalance {
  id: string;
  skuId: string;
  shipmentLineId: string | null;
  sourceLocationId: string;
  custodyType: CustodyType;
  custodyRef: string | null;
  qty: number;
}

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

class InsertResult implements PromiseLike<unknown[]> {
  private rows: unknown[] = [];

  constructor(private readonly state: AggregateHarnessState) {}

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

class UpdateResult implements PromiseLike<unknown[]> {
  constructor(private readonly state: AggregateHarnessState) {}

  set(values: Record<string, unknown>): this {
    this.state.applyUpdate(values);
    return this;
  }

  where(): this {
    return this;
  }

  returning(): QueryResult<{ id: string }> {
    return new QueryResult([{ id: IDS.workItemA }]);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled, onrejected);
  }
}

function bulkInput(overrides: Partial<AggregateSourceScanInput> = {}): AggregateSourceScanInput {
  return {
    strategy: 'aggregate_then_sort',
    stage: 'bulk_collect',
    batchId: IDS.batch,
    planId: IDS.plan,
    sessionId: IDS.session,
    skuId: IDS.sku,
    sourceLocationId: IDS.source,
    quantity: 5,
    cartId: IDS.cart,
    actor: { id: IDS.actor, roles: ['logistics_worker'] },
    idempotencyKey: 'bulk-collect',
    ...overrides,
  };
}

function sortInput(
  shipment: 'A' | 'B',
  quantity: number,
  overrides: Partial<AggregateSortScanInput> = {},
): AggregateSortScanInput {
  const suffix = shipment === 'A' ? 'A' : 'B';
  return {
    strategy: 'aggregate_then_sort',
    stage: 'sort',
    batchId: IDS.batch,
    planId: IDS.plan,
    sessionId: IDS.session,
    workItemId: IDS[`workItem${suffix}`],
    shipmentId: IDS[`shipment${suffix}`],
    shipmentLineId: IDS[`line${suffix}`],
    skuId: IDS.sku,
    quantity,
    cartId: IDS.cart,
    destinationCustody: 'SORTING',
    actor: { id: IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey: `sort-${shipment.toLowerCase()}`,
    ...overrides,
  };
}

function completeInput(shipment: 'A' | 'B', overrides: Partial<CompletePickInput> = {}): CompletePickInput {
  const suffix = shipment === 'A' ? 'A' : 'B';
  return {
    batchId: IDS.batch,
    planId: IDS.plan,
    sessionId: IDS.session,
    workItemId: IDS[`workItem${suffix}`],
    shipmentId: IDS[`shipment${suffix}`],
    actor: { id: IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey: `complete-${shipment.toLowerCase()}`,
    ...overrides,
  };
}

class AggregateHarnessState {
  readonly allocations: PickingContractAllocation[] = [];
  readonly balances: CustodyBalance[] = [];
  readonly replay = new Map<string, unknown>();
  readonly moves: Array<Record<string, any>> = [];
  readonly workItems: Record<string, Record<string, any>> = {
    [IDS.workItemA]: this.workItem(IDS.workItemA, IDS.shipmentA),
    [IDS.workItemB]: this.workItem(IDS.workItemB, IDS.shipmentB),
  };
  handedIn = 0;
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
    if (this.operation === 'picking.aggregate_then_sort.plan') {
      if (index === 0) return [];
      if (index === 1) return [];
      if (index === 2) return [{ version: 0 }];
    }
    if (this.operation === 'picking.aggregate_then_sort.start') {
      if (index === 0) return [{ status: 'draft', strategy: 'aggregate_then_sort' }];
      if (index === 1) return [{ shipmentId: IDS.shipmentA }, { shipmentId: IDS.shipmentB }];
    }
    if (this.operation === 'picking.aggregate_then_sort.bulk_collect') {
      if (index === 0) return [{ qty: 5 }];
    }
    if (this.operation === 'picking.aggregate_then_sort.sort') {
      if (index === 0) {
        if (this.request.shipmentLineId !== IDS.lineA && this.request.shipmentLineId !== IDS.lineB) return [];
        return [{ shipmentId: this.request.shipmentId, skuId: this.lineSku(this.request.shipmentLineId) }];
      }
      const bulk = this.balance({
        skuId: this.request.skuId,
        sourceLocationId: IDS.source,
        custodyType: 'BULK_CART',
        custodyRef: this.cartRef(this.request.actorId),
        shipmentLineId: null,
      });
      return bulk ? [{ id: bulk.id, qty: bulk.qty }] : [];
    }
    throw new Error(`Unexpected select ${index} during ${this.operation}`);
  }

  applyInsert(values: unknown): unknown[] {
    const index = this.insertIndex++;
    if (this.operation !== 'picking.aggregate_then_sort.plan') {
      throw new Error(`Unexpected insert during ${this.operation}`);
    }
    if (index === 0) return [{ id: IDS.plan, version: 1, status: 'draft' }];
    if (index === 1) return [];
    if (index === 2) {
      const shipmentByLine: Record<string, string> = { [IDS.lineA]: IDS.shipmentA, [IDS.lineB]: IDS.shipmentB };
      for (const value of values as Array<Record<string, unknown>>) {
        this.allocations.push({
          shipmentId: shipmentByLine[value.shipmentLineId as string],
          shipmentLineId: value.shipmentLineId as string,
          skuId: IDS.sku,
          sourceLocationId: value.sourceLocationId as string,
          quantity: value.qty as number,
          sourceStockVersion: value.sourceStockVersion as number,
        });
      }
      return [];
    }
    throw new Error(`Unexpected plan insert ${index}`);
  }

  applyUpdate(values: Record<string, unknown>): void {
    const workItemId = this.request.workItemId as string | undefined;
    if (!workItemId || !this.workItems[workItemId]) {
      throw new Error(`Unexpected update during ${this.operation}`);
    }
    Object.assign(this.workItems[workItemId], values);
  }

  startSession(actorId: string): void {
    this.handedIn = this.allocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
    this.balances.splice(0, this.balances.length, {
      id: 'balance-source',
      skuId: IDS.sku,
      shipmentLineId: null,
      sourceLocationId: IDS.source,
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
      custodyType: from.custodyType as CustodyType,
      custodyRef: (from.custodyRef as string | undefined) ?? null,
      shipmentLineId: (from.shipmentLineId as string | undefined) ?? null,
    });
    if (!source || source.qty < input.quantity) throw new Error('aggregate fixture custody underflow');
    source.qty -= input.quantity;
    const grain = {
      skuId: to.skuId as string,
      sourceLocationId: to.sourceLocationId as string,
      custodyType: to.custodyType as CustodyType,
      custodyRef: (to.custodyRef as string | undefined) ?? null,
      shipmentLineId: (to.shipmentLineId as string | undefined) ?? null,
    };
    const target = this.balance(grain);
    if (target) target.qty += input.quantity;
    else this.balances.push({ id: `balance-${this.balances.length + 1}`, ...grain, qty: input.quantity });
    this.moves.push({ ...input, from: { ...input.from }, to: { ...input.to } });
    for (let index = this.balances.length - 1; index >= 0; index -= 1) {
      if (this.balances[index].qty === 0) this.balances.splice(index, 1);
    }
  }

  allocationsForLine(lineId: string) {
    return this.allocations
      .filter((allocation) => allocation.shipmentLineId === lineId)
      .map((allocation, index) => ({
        id: `allocation-${lineId}-${index + 1}`,
        shipmentLineId: allocation.shipmentLineId,
        skuId: allocation.skuId,
        sourceLocationId: allocation.sourceLocationId,
        qty: allocation.quantity,
      }));
  }

  assignedBalances(lineId: string): CustodyBalance[] {
    return this.balances.filter((balance) => balance.shipmentLineId === lineId && balance.qty > 0);
  }

  cartBalances(cartId = IDS.cart): CustodyBalance[] {
    const prefix = `bulk-cart:${IDS.batch}:${cartId}:`;
    return this.balances.filter(
      (balance) => balance.custodyType === 'BULK_CART' && balance.custodyRef?.startsWith(prefix) && balance.qty > 0,
    );
  }

  cartRef(ownerId: string, cartId = IDS.cart): string {
    return `bulk-cart:${IDS.batch}:${cartId}:${ownerId}`;
  }

  sortingRef(workItemId: string, workerId: string): string {
    return `sorting:${workItemId}:${workerId}`;
  }

  packingRef(workItemId: string): string {
    return `work-item:${workItemId}`;
  }

  private balance(grain: Omit<CustodyBalance, 'id' | 'qty'>): CustodyBalance | undefined {
    return this.balances.find(
      (balance) =>
        balance.skuId === grain.skuId &&
        balance.sourceLocationId === grain.sourceLocationId &&
        balance.custodyType === grain.custodyType &&
        balance.custodyRef === grain.custodyRef &&
        balance.shipmentLineId === grain.shipmentLineId,
    );
  }

  private lineSku(lineId: string): string {
    return lineId === IDS.lineA || lineId === IDS.lineB ? IDS.sku : 'wrong-sku';
  }

  private workItem(id: string, shipmentId: string): Record<string, any> {
    return {
      id,
      batchId: IDS.batch,
      shipmentId,
      status: 'queued',
      pickerId: null,
      pickerReleasedAt: null,
      leaseVersion: 0,
      leaseExpiresAt: null,
    };
  }
}

interface AggregateHarness {
  strategy: AggregateThenSortPickingStrategy;
  state: AggregateHarnessState;
  sessions: { startSession: jest.Mock; moveCustody: jest.Mock };
  controlledStock: { getAvailability: jest.Mock; writeStockLedger: jest.Mock };
  invoices: { assertDispatchableInvoice: jest.Mock; issue: jest.Mock; void: jest.Mock };
  batches: { handoff: jest.Mock };
}

function createHarness(): AggregateHarness {
  const state = new AggregateHarnessState();
  const tx = {
    select: jest.fn(() => new QueryResult(state.selectRows())),
    insert: jest.fn(() => new InsertResult(state)),
    update: jest.fn(() => new UpdateResult(state)),
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
      return { id: IDS.session, status: 'active' };
    }),
    moveCustody: jest.fn(async (input) => state.moveCustody(input)),
  };
  const controlledStock = { getAvailability: jest.fn(), writeStockLedger: jest.fn() };
  const invoices = { assertDispatchableInvoice: jest.fn(), issue: jest.fn(), void: jest.fn() };
  const batches = {
    handoff: jest.fn(async (workItemId: string, request: { targetWorkerId: string }) => {
      const item = state.workItems[workItemId];
      Object.assign(item, { pickerId: request.targetWorkerId, leaseVersion: item.leaseVersion + 1 });
      return { workItem: { ...item } };
    }),
  };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const Strategy = AggregateThenSortPickingStrategy as any;
  const strategy: AggregateThenSortPickingStrategy = new Strategy(
    {},
    commands,
    workflowGate,
    {},
    sessions,
    controlledStock,
    invoices,
    batches,
  );
  const aggregate = {
    batch: { id: IDS.batch, warehouseId: 'warehouse-1' },
    shipments: [
      { id: IDS.shipmentA, manifestVersion: 1, reservationVersion: 1 },
      { id: IDS.shipmentB, manifestVersion: 1, reservationVersion: 1 },
    ],
    lines: [
      { id: IDS.lineA, shipmentId: IDS.shipmentA, skuId: IDS.sku, qty: 2 },
      { id: IDS.lineB, shipmentId: IDS.shipmentB, skuId: IDS.sku, qty: 3 },
    ],
    workItems: Object.values(state.workItems),
  };
  jest.spyOn(strategy as any, 'lockAggregate').mockResolvedValue(aggregate);
  jest.spyOn(strategy as any, 'assertWarehouseConfiguration').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'assertPlanningEligibility').mockResolvedValue(undefined);
  jest
    .spyOn(strategy as any, 'lockSourceCapacities')
    .mockResolvedValue([{ skuId: IDS.sku, sourceLocationId: IDS.source, stockVersion: 7, remainingQty: 5 }]);
  jest.spyOn(strategy as any, 'planStalenessReason').mockResolvedValue(null);
  jest.spyOn(strategy as any, 'assertActivePlanSession').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'assertPlanMembers').mockResolvedValue(undefined);
  jest.spyOn(strategy as any, 'acquireCartLock').mockResolvedValue(undefined);
  jest
    .spyOn(strategy as any, 'assertCartOwnedBy')
    .mockImplementation(async (_sessionId: string, _batchId: string, cartId: string, ownerId: string) => {
      const balances = state.cartBalances(cartId);
      if (!balances.length && state.operation === 'picking.aggregate_then_sort.bulk_collect') return;
      if (!balances.length || balances.some((balance) => balance.custodyRef !== state.cartRef(ownerId, cartId))) {
        throw new ConflictException({
          code: 'AGGREGATE_CART_OWNER_MISMATCH',
          message: `Cart ${cartId} is not owned by ${ownerId}`,
        });
      }
    });
  jest
    .spyOn(strategy as any, 'lockAndAssertPickerClaim')
    .mockImplementation(
      async (workItemId: string, _batchId: string, shipmentId: string, actorId: string, version: number) => {
        const item = state.workItems[workItemId];
        if (
          !item ||
          item.shipmentId !== shipmentId ||
          item.status !== 'picking' ||
          item.pickerId !== actorId ||
          item.leaseVersion !== version
        ) {
          throw new ConflictException({ code: 'PICKING_STALE_CLAIM', message: 'stale picker claim' });
        }
        return item;
      },
    );
  jest
    .spyOn(strategy as any, 'loadLineAllocations')
    .mockImplementation(async (_planId: string, lineId: string) => state.allocationsForLine(lineId));
  jest
    .spyOn(strategy as any, 'loadShipmentAllocations')
    .mockImplementation(async (_planId: string, shipmentId: string) =>
      state.allocations
        .filter((allocation) => allocation.shipmentId === shipmentId)
        .flatMap((allocation) => state.allocationsForLine(allocation.shipmentLineId)),
    );
  jest
    .spyOn(strategy as any, 'loadPositiveAllocationCustody')
    .mockImplementation(async (_sessionId: string, allocation: { shipmentLineId: string; sourceLocationId: string }) =>
      state
        .assignedBalances(allocation.shipmentLineId)
        .filter((balance) => balance.sourceLocationId === allocation.sourceLocationId)
        .map((balance) => ({ ...balance })),
    );
  jest
    .spyOn(strategy as any, 'loadCartBalances')
    .mockImplementation(async (_sessionId: string, _batchId: string, cartId: string) =>
      state.cartBalances(cartId).map((balance) => ({ ...balance })),
    );
  jest
    .spyOn(strategy as any, 'loadGlobalCartBalances')
    .mockImplementation(async (cartId: string) =>
      state.cartBalances(cartId).map((balance) => ({ ...balance, sessionId: IDS.session, batchId: IDS.batch })),
    );
  jest
    .spyOn(strategy as any, 'loadPositiveShipmentCustody')
    .mockImplementation(async (_sessionId: string, shipmentId: string) => {
      const lineId = shipmentId === IDS.shipmentA ? IDS.lineA : IDS.lineB;
      return state.assignedBalances(lineId).map((balance) => ({ ...balance }));
    });
  jest
    .spyOn(strategy as any, 'loadWorkItem')
    .mockImplementation(async (workItemId: string) => ({ ...state.workItems[workItemId] }));
  jest
    .spyOn(strategy as any, 'assertAggregateAssignedCustody')
    .mockImplementation(async (_sessionId: string, shipmentId: string, workItemId: string, ownerId: string) => {
      const lineId = shipmentId === IDS.shipmentA ? IDS.lineA : IDS.lineB;
      const balances = state.assignedBalances(lineId).map((balance) => ({ ...balance }));
      if (
        balances.some(
          (balance) =>
            (balance.custodyType !== 'SORTING' || balance.custodyRef !== state.sortingRef(workItemId, ownerId)) &&
            (balance.custodyType !== 'PACKING' || balance.custodyRef !== state.packingRef(workItemId)),
        )
      ) {
        throw new ConflictException({ code: 'PICKING_CUSTODY_OWNER_MISMATCH', message: 'wrong assigned owner' });
      }
      return balances;
    });
  jest.spyOn(strategy as any, 'databaseNow').mockResolvedValue(new Date('2026-07-15T00:10:00.000Z'));

  return { strategy, state, sessions, controlledStock, invoices, batches };
}

async function planAndStart(harness: AggregateHarness): Promise<void> {
  await harness.strategy.plan({
    batchId: IDS.batch,
    shipmentIds: [IDS.shipmentB, IDS.shipmentA],
    actorId: IDS.actor,
    idempotencyKey: 'plan',
  });
  await harness.strategy.start({
    batchId: IDS.batch,
    planId: IDS.plan,
    actorId: IDS.actor,
    idempotencyKey: 'start',
  });
}

async function collectSharedSku(harness: AggregateHarness, input = bulkInput()): Promise<void> {
  await harness.strategy.scan(input);
}

describe('AggregateThenSortPickingStrategy focused custody behavior', () => {
  it('declares pooled-cart collection followed by sorting and packing custody', () => {
    const { strategy } = createHarness();

    expect(strategy.capabilities).toEqual({
      name: 'aggregate_then_sort',
      requiresPhysicalTote: false,
      supportsAggregateSourcePick: true,
      inspectionReadyCustody: 'PACKING',
      custodyFlow: ['AT_SOURCE', 'BULK_CART', 'SORTING', 'PACKING'],
    });
    expect(Object.isFrozen(strategy.capabilities)).toBe(true);
  });

  it('allows a worker to establish initially empty physical-cart ownership on the first bulk scan', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    (harness.strategy as any).assertCartOwnedBy.mockRestore();

    await expect(harness.strategy.scan(bulkInput())).resolves.toMatchObject({
      cartRef: harness.state.cartRef(IDS.actor),
      quantity: 5,
    });

    expect(harness.state.cartBalances()).toEqual([
      expect.objectContaining({ custodyRef: harness.state.cartRef(IDS.actor), qty: 5 }),
    ]);
  });

  it('rejects a physical cart that has positive custody in another session before collecting', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    (harness.strategy as any).assertCartOwnedBy.mockRestore();
    (harness.strategy as any).loadGlobalCartBalances.mockResolvedValue([
      {
        id: 'foreign-cart-balance',
        sessionId: 'session-other',
        batchId: 'batch-other',
        skuId: IDS.sku,
        sourceLocationId: IDS.source,
        custodyType: 'BULK_CART',
        custodyRef: `bulk-cart:batch-other:${IDS.cart}:worker-other`,
        shipmentLineId: null,
        qty: 1,
      },
    ]);

    await expect(harness.strategy.scan(bulkInput({ idempotencyKey: 'cross-session-cart' }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AGGREGATE_CART_IN_USE' }),
    });

    expect(harness.sessions.moveCustody).not.toHaveBeenCalled();
    expect(harness.state.balances).toEqual([expect.objectContaining({ custodyType: 'AT_SOURCE', qty: 5 })]);
  });

  it('routes the real scan union through idempotent bulk-collect and sort stages', async () => {
    const harness = createHarness();
    await planAndStart(harness);

    const bulkFirst = await harness.strategy.scan(bulkInput());
    const bulkReplay = await harness.strategy.scan(bulkInput());
    const sortFirst = await harness.strategy.scan(sortInput('A', 1));
    const sortReplay = await harness.strategy.scan(sortInput('A', 1));

    expect(bulkReplay).toEqual(bulkFirst);
    expect(sortReplay).toEqual(sortFirst);
    expect(harness.sessions.moveCustody).toHaveBeenCalledTimes(2);
    expect(harness.state.cartBalances()).toEqual([
      expect.objectContaining({ custodyRef: harness.state.cartRef(IDS.actor), qty: 4 }),
    ]);
    expect(harness.state.assignedBalances(IDS.lineA)).toEqual([
      expect.objectContaining({
        custodyType: 'SORTING',
        custodyRef: harness.state.sortingRef(IDS.workItemA, IDS.actor),
        qty: 1,
      }),
    ]);
  });

  it.each([
    ['wrong line', () => sortInput('A', 1, { shipmentLineId: 'line-outside-plan' })],
    ['wrong SKU', () => sortInput('A', 1, { skuId: 'sku-outside-line' })],
    ['wrong cart', () => sortInput('A', 1, { cartId: IDS.otherCart })],
    [
      'wrong cart owner',
      (harness: AggregateHarness) => {
        harness.state.workItems[IDS.workItemA].pickerId = IDS.otherActor;
        return sortInput('A', 1, { actor: { id: IDS.otherActor, roles: ['logistics_worker'] } });
      },
    ],
    [
      'wrong destination',
      () => sortInput('A', 1, { destinationCustody: 'WORKER' as AggregateSortScanInput['destinationCustody'] }),
    ],
    ['stale lease', () => sortInput('A', 1, { expectedLeaseVersion: 2 })],
  ])('rejects %s before moving any sorted custody', async (_label, makeInput) => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    const callsBefore = harness.sessions.moveCustody.mock.calls.length;

    await expect(harness.strategy.scan(makeInput(harness))).rejects.toBeDefined();

    expect(harness.sessions.moveCustody).toHaveBeenCalledTimes(callsBefore);
    expect(harness.state.assignedBalances(IDS.lineA)).toEqual([]);
    expect(harness.state.cartBalances()).toEqual([expect.objectContaining({ qty: 5 })]);
  });

  it('rejects a sort quantity larger than the exact line allocation atomically', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    const callsBefore = harness.sessions.moveCustody.mock.calls.length;

    await expect(harness.strategy.scan(sortInput('B', 4))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_SORT_SHORT' }),
    });

    expect(harness.sessions.moveCustody).toHaveBeenCalledTimes(callsBefore);
    expect(harness.state.cartBalances()).toEqual([expect.objectContaining({ qty: 5 })]);
    expect(harness.state.assignedBalances(IDS.lineB)).toEqual([]);
  });

  it('keeps source custody unchanged when the pooled collection is short', async () => {
    const harness = createHarness();
    await planAndStart(harness);

    await expect(harness.strategy.scan(bulkInput({ quantity: 6, idempotencyKey: 'bulk-short' }))).rejects.toThrow(
      'aggregate fixture custody underflow',
    );

    expect(harness.state.balances).toEqual([expect.objectContaining({ custodyType: 'AT_SOURCE', qty: 5 })]);
    expect(harness.state.moves).toEqual([]);
  });

  it('hands a physical pooled cart to another worker through session MOVE events', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    const input: AggregateCartHandoffInput = {
      batchId: IDS.batch,
      planId: IDS.plan,
      sessionId: IDS.session,
      cartId: IDS.cart,
      expectedOwnerId: IDS.actor,
      targetWorkerId: IDS.otherActor,
      reason: 'shift change',
      actor: { id: IDS.manager, roles: ['logistics_manager'] },
      idempotencyKey: 'cart-handoff',
    };

    const first = await harness.strategy.cartHandoff(input);
    const replay = await harness.strategy.cartHandoff(input);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      sourceCartRef: harness.state.cartRef(IDS.actor),
      targetCartRef: harness.state.cartRef(IDS.otherActor),
      movedQty: 5,
    });
    expect(harness.state.cartBalances()).toEqual([
      expect.objectContaining({ custodyRef: harness.state.cartRef(IDS.otherActor), qty: 5 }),
    ]);
    expect(harness.state.moves.at(-1)).toMatchObject({
      from: { custodyType: 'BULK_CART', custodyRef: harness.state.cartRef(IDS.actor) },
      to: { custodyType: 'BULK_CART', custodyRef: harness.state.cartRef(IDS.otherActor) },
      context: {
        kind: 'aggregate_cart_handoff',
        cartId: IDS.cart,
        fromWorkerId: IDS.actor,
        targetWorkerId: IDS.otherActor,
        reason: 'shift change',
      },
    });
  });

  it('lets shipment B finish while a partially sorted shipment A remains blocked', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    await harness.strategy.scan(sortInput('A', 1, { idempotencyKey: 'sort-a-partial' }));
    await harness.strategy.scan(sortInput('B', 3, { idempotencyKey: 'sort-b-full' }));
    const callsBeforeBlockedComplete = harness.sessions.moveCustody.mock.calls.length;

    await expect(harness.strategy.completePick(completeInput('A'))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_UNSORTED_REMAINDER' }),
    });
    expect(harness.sessions.moveCustody).toHaveBeenCalledTimes(callsBeforeBlockedComplete);

    const completedB = await harness.strategy.completePick(completeInput('B'));

    expect(completedB).toMatchObject({ shipmentId: IDS.shipmentB, totalQty: 3, custodyType: 'PACKING' });
    expect(harness.state.workItems[IDS.workItemA].status).toBe('picking');
    expect(harness.state.workItems[IDS.workItemB].status).toBe('ready_to_pack');
    expect(harness.state.assignedBalances(IDS.lineA)).toEqual([
      expect.objectContaining({ custodyType: 'SORTING', qty: 1 }),
    ]);
    expect(harness.state.assignedBalances(IDS.lineB)).toEqual([
      expect.objectContaining({ custodyType: 'PACKING', qty: 3 }),
    ]);
    expect(harness.state.cartBalances()).toEqual([expect.objectContaining({ qty: 1 })]);
  });

  it('unpick isolates one shipment and leaves the shared pooled-cart remainder untouched', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    await harness.strategy.scan(sortInput('A', 2));
    await harness.strategy.completePick(completeInput('A'));
    const input: UnpickShipmentInput = {
      ...completeInput('A'),
      expectedLeaseVersion: 2,
      idempotencyKey: 'unpick-a',
    };

    const result = await harness.strategy.unpickShipment(input);

    expect(result).toMatchObject({ shipmentId: IDS.shipmentA, returnedToSourceQty: 2, status: 'queued' });
    expect(harness.state.cartBalances()).toEqual([
      expect.objectContaining({ custodyRef: harness.state.cartRef(IDS.actor), qty: 3 }),
    ]);
    expect(harness.state.balances).toContainEqual(expect.objectContaining({ custodyType: 'AT_SOURCE', qty: 2 }));
    expect(harness.state.assignedBalances(IDS.lineA)).toEqual([]);
    expect(harness.state.workItems[IDS.workItemB].status).toBe('picking');
  });

  it('hands sorting custody and its picker claim to another worker through session MOVE events', async () => {
    const harness = createHarness();
    await planAndStart(harness);
    await collectSharedSku(harness);
    await harness.strategy.scan(sortInput('A', 2));
    const input: HandoffPickingInput = {
      batchId: IDS.batch,
      planId: IDS.plan,
      sessionId: IDS.session,
      workItemId: IDS.workItemA,
      shipmentId: IDS.shipmentA,
      targetWorkerId: IDS.otherActor,
      expectedLeaseVersion: 1,
      reason: 'shift change',
      actor: { id: IDS.manager, roles: ['logistics_manager'] },
      idempotencyKey: 'sorting-handoff',
    };

    const first = await harness.strategy.handoff(input);
    const replay = await harness.strategy.handoff(input);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({ workerId: IDS.otherActor, leaseVersion: 2, movedQty: 2 });
    expect(harness.batches.handoff).toHaveBeenCalledTimes(1);
    expect(harness.state.assignedBalances(IDS.lineA)).toEqual([
      expect.objectContaining({
        custodyType: 'SORTING',
        custodyRef: harness.state.sortingRef(IDS.workItemA, IDS.otherActor),
        qty: 2,
      }),
    ]);
    expect(harness.state.moves.at(-1)).toMatchObject({
      from: { custodyType: 'SORTING', custodyRef: harness.state.sortingRef(IDS.workItemA, IDS.actor) },
      to: { custodyType: 'SORTING', custodyRef: harness.state.sortingRef(IDS.workItemA, IDS.otherActor) },
    });
  });
});

function createProductionAggregateFixture(): PickingStrategyContractFixture {
  const harness = createHarness();
  let shipmentARetired = false;
  (harness.strategy as any).assertPlanMembers.mockImplementation(async (_planId: string, shipmentIds: string[]) => {
    if (shipmentARetired && shipmentIds.includes(IDS.shipmentA)) {
      throw new ConflictException({
        code: 'PICKING_SHIPMENT_NOT_IN_PLAN',
        message: 'Retired shipment is not an active plan member',
      });
    }
  });
  return {
    strategy: harness.strategy,
    pickShipmentA: async () => {
      const collect = bulkInput({ idempotencyKey: 'contract-bulk' });
      await harness.strategy.scan(collect);
      await harness.strategy.scan(collect);
      const sort = sortInput('A', 2, { idempotencyKey: 'scan-a' });
      const first = await harness.strategy.scan(sort);
      const replay = await harness.strategy.scan(sort);
      return { first, replay };
    },
    retireShipmentA: () => {
      shipmentARetired = true;
      Object.assign(harness.state.workItems[IDS.workItemA], {
        status: 'short_pick_recovery',
        recoveryReason: 'one unit missing',
      });
    },
    attemptRetiredShipmentA: () => harness.strategy.scan(sortInput('A', 1, { idempotencyKey: 'retired-sort-a' })),
    snapshot: () => {
      const custodyTotal = (type: CustodyType) =>
        harness.state.balances
          .filter((balance) => balance.custodyType === type)
          .reduce((sum, balance) => sum + balance.qty, 0);
      const atSource = custodyTotal('AT_SOURCE');
      const bulkCart = custodyTotal('BULK_CART');
      const sorting = custodyTotal('SORTING');
      const packing = custodyTotal('PACKING');
      return {
        allocations: harness.state.allocations.map((allocation) => ({ ...allocation })),
        custody: {
          atSource,
          worker: 0,
          bulkCart,
          tote: 0,
          sorting,
          packing,
          total: atSource + bulkCart + sorting + packing,
          handedIn: harness.state.handedIn,
        },
        workItemStatuses: Object.fromEntries(
          Object.entries(harness.state.workItems).map(([id, item]) => [id, item.status as string]),
        ),
        physicalToteCount: 0,
        forbiddenEffects: {
          stockLedgerWrites: harness.controlledStock.writeStockLedger.mock.calls.length,
          reservationConsumptions: 0,
          invoiceMutations: harness.invoices.issue.mock.calls.length + harness.invoices.void.mock.calls.length,
          fulfillmentProgressWrites: 0,
          shipmentEventsPublished: 0,
        },
      };
    },
  };
}

definePickingStrategyContract('production aggregate-then-sort', createProductionAggregateFixture);
