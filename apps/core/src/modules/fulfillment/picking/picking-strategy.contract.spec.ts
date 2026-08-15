/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ConflictException } from '@nestjs/common';
import {
  CompletePickInput,
  PickingStrategy,
  PlanPickingInput,
  ScanPickingInput,
  StartPickingInput,
  UnpickShipmentInput,
} from './picking-strategy.interface';
import { DiscretePickingStrategy } from './discrete-picking.strategy';
import { planPicking, startPicking } from './plan/picking-plan';
import {
  assertPlanningEligibility,
  assertWarehouseConfiguration,
  lockAggregate,
  lockSourceCapacities,
  planStalenessReason,
} from './plan/picking-plan.locks';
import {
  assertActivePlanSession,
  assertPlanMembers,
  databaseNow,
  loadShipmentAllocations,
  loadWorkItem,
  lockAndAssertPickerClaim,
} from './plan/picking-plan.queries';
import { PickingPlanDeps } from './plan/picking-plan.types';

// The plan layer is a shared implementation with its own spec. Here it is stubbed so the custody
// contract runs against a deterministic model instead of a database.
jest.mock('./plan/picking-plan.locks');
jest.mock('./plan/picking-plan.queries', () => ({
  ...jest.requireActual('./plan/picking-plan.queries'),
  assertActivePlanSession: jest.fn(),
  assertPlanMembers: jest.fn(),
  databaseNow: jest.fn(),
  loadShipmentAllocations: jest.fn(),
  loadWorkItem: jest.fn(),
  lockAndAssertPickerClaim: jest.fn(),
}));

const PLAN_LAYER_MOCKS = [
  assertPlanningEligibility,
  assertWarehouseConfiguration,
  lockAggregate,
  lockSourceCapacities,
  planStalenessReason,
  assertActivePlanSession,
  assertPlanMembers,
  databaseNow,
  loadShipmentAllocations,
  loadWorkItem,
  lockAndAssertPickerClaim,
];

// 모듈 mock 은 파일 전역이라 develop 의 `jest.spyOn(new Strategy(), …)` 과 달리 테스트 간에
// 살아남는다. 각 테스트가 필요한 것만 명시적으로 stub 하도록 매번 초기화한다 — 안 하면
// 다음 테스트가 앞 테스트의 값을 조용히 물려받아 통과해버린다.
beforeEach(() => {
  for (const fn of PLAN_LAYER_MOCKS) jest.mocked(fn).mockReset();
});

export const PICKING_CONTRACT_IDS = Object.freeze({
  actor: 'worker-1',
  batch: 'batch-1',
  plan: 'plan-1',
  session: 'session-1',
  shipmentA: 'shipment-a',
  shipmentB: 'shipment-b',
  lineA: 'line-a',
  lineB: 'line-b',
  workItemA: 'work-item-a',
  workItemB: 'work-item-b',
  sku: 'sku-1',
  source: 'source-1',
});

export interface PickingContractAllocation {
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  sourceStockVersion: number;
}

export interface PickingContractSnapshot {
  allocations: PickingContractAllocation[];
  custody: {
    atSource: number;
    worker: number;
    bulkCart: number;
    tote: number;
    sorting: number;
    packing: number;
    total: number;
    handedIn: number;
  };
  workItemStatuses: Record<string, string>;
  physicalToteCount: number;
  forbiddenEffects: {
    stockLedgerWrites: number;
    reservationConsumptions: number;
    invoiceMutations: number;
    fulfillmentProgressWrites: number;
    shipmentEventsPublished: number;
  };
}

export interface PickingStrategyContractFixture {
  strategy: PickingStrategy;
  /**
   * Planning is no longer part of the strategy contract — it is one shared implementation with its
   * own spec (`plan/picking-plan.spec.ts`). These two remain only as custody-test setup.
   */
  plan(): Promise<unknown>;
  start(): Promise<unknown>;
  pickShipmentA(): Promise<{ first: unknown; replay: unknown }>;
  retireShipmentA(): void;
  attemptRetiredShipmentA(): Promise<unknown>;
  snapshot(): PickingContractSnapshot;
}

export type PickingStrategyContractFactory = () => PickingStrategyContractFixture;

function planInput(idempotencyKey = 'plan-key'): PlanPickingInput {
  return {
    batchId: PICKING_CONTRACT_IDS.batch,
    shipmentIds: [PICKING_CONTRACT_IDS.shipmentB, PICKING_CONTRACT_IDS.shipmentA],
    actorId: PICKING_CONTRACT_IDS.actor,
    idempotencyKey,
  };
}

function startInput(idempotencyKey = 'start-key'): StartPickingInput {
  return {
    batchId: PICKING_CONTRACT_IDS.batch,
    planId: PICKING_CONTRACT_IDS.plan,
    actorId: PICKING_CONTRACT_IDS.actor,
    idempotencyKey,
  };
}

function scanInput(shipment: 'A' | 'B', quantity: number, idempotencyKey: string): ScanPickingInput {
  const suffix = shipment === 'A' ? 'A' : 'B';
  return {
    batchId: PICKING_CONTRACT_IDS.batch,
    planId: PICKING_CONTRACT_IDS.plan,
    sessionId: PICKING_CONTRACT_IDS.session,
    workItemId: PICKING_CONTRACT_IDS[`workItem${suffix}`],
    shipmentId: PICKING_CONTRACT_IDS[`shipment${suffix}`],
    shipmentLineId: PICKING_CONTRACT_IDS[`line${suffix}`],
    skuId: PICKING_CONTRACT_IDS.sku,
    sourceLocationId: PICKING_CONTRACT_IDS.source,
    quantity,
    actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey,
  };
}

function completeInput(idempotencyKey = 'complete-key'): CompletePickInput {
  return {
    batchId: PICKING_CONTRACT_IDS.batch,
    planId: PICKING_CONTRACT_IDS.plan,
    sessionId: PICKING_CONTRACT_IDS.session,
    workItemId: PICKING_CONTRACT_IDS.workItemA,
    shipmentId: PICKING_CONTRACT_IDS.shipmentA,
    actor: { id: PICKING_CONTRACT_IDS.actor, roles: ['logistics_worker'] },
    expectedLeaseVersion: 1,
    idempotencyKey,
  };
}

function unpickInput(idempotencyKey = 'unpick-key'): UnpickShipmentInput {
  return {
    ...completeInput(idempotencyKey),
    expectedLeaseVersion: 2,
  };
}

/**
 * Shared behavioral contract for every picking provider. A provider-specific spec
 * supplies a fixture backed by either the real database or a deterministic model.
 */
export function definePickingStrategyContract(label: string, createFixture: PickingStrategyContractFactory): void {
  describe(`${label} picking strategy contract`, () => {
    let fixture: PickingStrategyContractFixture;

    beforeEach(() => {
      fixture = createFixture();
    });

    // 「공유 소스를 초과 배정하지 않고 정확한 소스 할당을 만든다」는 계획 층 계약이라
    // plan/picking-plan.spec.ts 로 이사했다. 전략 3벌에 대해 같은 코드를 3번 검증할
    // 대상 자체가 사라졌다 (ADR-0030).

    it('keeps scans idempotent and conserves handed-in custody', async () => {
      await fixture.plan();
      await fixture.start();

      const { first, replay } = await fixture.pickShipmentA();
      const snapshot = fixture.snapshot();

      expect(replay).toEqual(first);
      expect(snapshot.custody.total).toBe(snapshot.custody.handedIn);
      expect(snapshot.custody.total).toBe(5);
      expect(snapshot.custody.packing).toBe(0);
      expect(snapshot.physicalToteCount).toBe(fixture.strategy.capabilities.requiresPhysicalTote ? 1 : 0);
    });

    it('emits the common inspection-ready shape only after exact shipment picking', async () => {
      await fixture.plan();
      await fixture.start();
      await fixture.pickShipmentA();

      const result = await fixture.strategy.completePick(completeInput());
      const snapshot = fixture.snapshot();

      expect(result).toEqual({
        operationId: 'operation:complete-key',
        workItemId: PICKING_CONTRACT_IDS.workItemA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        custodyType: 'PACKING',
        custodyRef: `work-item:${PICKING_CONTRACT_IDS.workItemA}`,
        lines: [
          {
            shipmentLineId: PICKING_CONTRACT_IDS.lineA,
            skuId: PICKING_CONTRACT_IDS.sku,
            sourceLocationId: PICKING_CONTRACT_IDS.source,
            quantity: 2,
          },
        ],
        totalQty: 2,
      });
      expect(snapshot.custody.packing).toBe(2);
      expect(snapshot.custody.total).toBe(5);
      expect(snapshot.custody.handedIn).toBe(5);
      expect(snapshot.workItemStatuses[PICKING_CONTRACT_IDS.workItemA]).toBe('ready_to_pack');
    });

    it('unpick returns only the selected shipment to pooled source custody', async () => {
      await fixture.plan();
      await fixture.start();
      await fixture.pickShipmentA();
      await fixture.strategy.completePick(completeInput());

      const result = await fixture.strategy.unpickShipment(unpickInput());
      const snapshot = fixture.snapshot();

      expect(result).toEqual({
        operationId: 'operation:unpick-key',
        workItemId: PICKING_CONTRACT_IDS.workItemA,
        shipmentId: PICKING_CONTRACT_IDS.shipmentA,
        status: 'queued',
        returnedToSourceQty: 2,
      });
      expect(snapshot.custody).toMatchObject({ worker: 0, sorting: 0, packing: 0, total: 5, handedIn: 5 });
      expect(snapshot.workItemStatuses).toMatchObject({
        [PICKING_CONTRACT_IDS.workItemA]: 'queued',
        [PICKING_CONTRACT_IDS.workItemB]: 'picking',
      });
    });

    it('rejects scans for a retired member while the sibling work item stays active', async () => {
      await fixture.plan();
      await fixture.start();
      fixture.retireShipmentA();

      await expect(fixture.attemptRetiredShipmentA()).rejects.toMatchObject({
        response: expect.objectContaining({
          code: expect.stringMatching(/^PICKING_(SHIPMENT_NOT_IN_PLAN|STALE_CLAIM)$/),
        }),
      });
      expect(fixture.snapshot().workItemStatuses).toMatchObject({
        [PICKING_CONTRACT_IDS.workItemA]: 'short_pick_recovery',
        [PICKING_CONTRACT_IDS.workItemB]: 'picking',
      });
    });

    it('does not cross the economic inventory, reservation, invoice, progress, or event boundaries', async () => {
      await fixture.plan();
      await fixture.start();
      await fixture.pickShipmentA();
      await fixture.strategy.completePick(completeInput());
      await fixture.strategy.unpickShipment(unpickInput());

      expect(fixture.snapshot().forbiddenEffects).toEqual({
        stockLedgerWrites: 0,
        reservationConsumptions: 0,
        invoiceMutations: 0,
        fulfillmentProgressWrites: 0,
        shipmentEventsPublished: 0,
      });
    });
  });
}

type CustodyType = 'AT_SOURCE' | 'WORKER' | 'BULK_CART' | 'TOTE' | 'SORTING' | 'PACKING';

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

  constructor(private readonly state: ProductionDiscreteState) {}

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
  constructor(private readonly state: ProductionDiscreteState) {}

  set(values: Record<string, unknown>): this {
    this.state.applyUpdate(values);
    return this;
  }

  where(): this {
    return this;
  }

  returning(): QueryResult<{ id: string }> {
    return new QueryResult([{ id: PICKING_CONTRACT_IDS.workItemA }]);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled, onrejected);
  }
}

class ProductionDiscreteState {
  readonly allocations: PickingContractAllocation[] = [];
  readonly balances: CustodyBalance[] = [];
  readonly workItems: Record<string, Record<string, unknown>> = {
    [PICKING_CONTRACT_IDS.workItemA]: this.workItem(PICKING_CONTRACT_IDS.workItemA, PICKING_CONTRACT_IDS.shipmentA),
    [PICKING_CONTRACT_IDS.workItemB]: this.workItem(PICKING_CONTRACT_IDS.workItemB, PICKING_CONTRACT_IDS.shipmentB),
  };
  readonly replay = new Map<string, unknown>();
  handedIn = 0;
  operation = '';
  selectIndex = 0;
  insertIndex = 0;

  begin(operation: string): void {
    this.operation = operation;
    this.selectIndex = 0;
    this.insertIndex = 0;
  }

  selectRows(): unknown[] {
    const index = this.selectIndex++;
    if (this.operation === 'picking.discrete.plan') {
      if (index === 0) return [];
      if (index === 1) return [];
      if (index === 2) return [{ version: 0 }];
    }
    if (this.operation === 'picking.discrete.start') {
      if (index === 0) return [{ status: 'draft', strategy: 'discrete' }];
      if (index === 1) {
        return [{ shipmentId: PICKING_CONTRACT_IDS.shipmentA }, { shipmentId: PICKING_CONTRACT_IDS.shipmentB }];
      }
    }
    if (this.operation === 'picking.discrete.scan') {
      if (index === 0) return [{ shipmentId: PICKING_CONTRACT_IDS.shipmentA, skuId: PICKING_CONTRACT_IDS.sku }];
      if (index === 1) {
        return [
          {
            qty: this.allocations.find((allocation) => allocation.shipmentId === PICKING_CONTRACT_IDS.shipmentA)!
              .quantity,
          },
        ];
      }
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
    if (this.operation === 'picking.discrete.complete') {
      return this.assignedBalances(PICKING_CONTRACT_IDS.lineA).map((balance) => ({
        id: balance.id,
        custodyType: balance.custodyType,
        custodyRef: balance.custodyRef,
        qty: balance.qty,
      }));
    }
    if (this.operation === 'picking.discrete.unpick') {
      return this.assignedBalances(PICKING_CONTRACT_IDS.lineA).map((balance) => ({ ...balance }));
    }
    throw new Error(`Unexpected select ${index} during ${this.operation}`);
  }

  applyInsert(values: unknown): unknown[] {
    const index = this.insertIndex++;
    if (this.operation !== 'picking.discrete.plan') throw new Error(`Unexpected insert during ${this.operation}`);
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
    throw new Error(`Unexpected plan insert ${index}`);
  }

  applyUpdate(values: Record<string, unknown>): void {
    if (this.operation !== 'picking.discrete.complete' && this.operation !== 'picking.discrete.unpick') {
      throw new Error(`Unexpected update during ${this.operation}`);
    }
    Object.assign(this.workItems[PICKING_CONTRACT_IDS.workItemA], values);
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
    const source = this.balances.find(
      (balance) =>
        balance.skuId === from.skuId &&
        balance.sourceLocationId === from.sourceLocationId &&
        balance.custodyType === from.custodyType &&
        balance.custodyRef === (from.custodyRef ?? null) &&
        balance.shipmentLineId === (from.shipmentLineId ?? null),
    );
    if (!source || source.qty < input.quantity) throw new Error('session fixture custody underflow');
    source.qty -= input.quantity;
    const grain = {
      skuId: to.skuId as string,
      sourceLocationId: to.sourceLocationId as string,
      custodyType: to.custodyType as CustodyType,
      custodyRef: (to.custodyRef as string | undefined) ?? null,
      shipmentLineId: (to.shipmentLineId as string | undefined) ?? null,
    };
    const destination = this.balances.find(
      (balance) =>
        balance.skuId === grain.skuId &&
        balance.sourceLocationId === grain.sourceLocationId &&
        balance.custodyType === grain.custodyType &&
        balance.custodyRef === grain.custodyRef &&
        balance.shipmentLineId === grain.shipmentLineId,
    );
    if (destination) destination.qty += input.quantity;
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

  private assignedBalances(shipmentLineId: string): CustodyBalance[] {
    return this.balances.filter((balance) => balance.shipmentLineId === shipmentLineId && balance.qty > 0);
  }

  private workItem(id: string, shipmentId: string): Record<string, unknown> {
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

function createProductionDiscreteFixture(): PickingStrategyContractFixture {
  const state = new ProductionDiscreteState();
  let shipmentARetired = false;
  const tx = {
    select: jest.fn(() => new QueryResult(state.selectRows())),
    insert: jest.fn(() => new InsertResult(state)),
    update: jest.fn(() => new UpdateResult(state)),
  };
  const commands = {
    execute: jest.fn(async (request, handler) => {
      const replayKey = `${request.commandType}:${request.idempotencyKey}`;
      if (state.replay.has(replayKey)) return state.replay.get(replayKey);
      state.begin(request.commandType);
      const envelope = await handler(tx, `operation:${request.idempotencyKey}`);
      state.replay.set(replayKey, envelope.response);
      return envelope.response;
    }),
  };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const sessions = {
    startSession: jest.fn(async (_batchId, _planId, _tx, actorId) => {
      state.startSession(actorId);
      return { id: PICKING_CONTRACT_IDS.session, status: 'active' };
    }),
    moveCustody: jest.fn(async (input) => state.moveCustody(input)),
  };
  const controlledStock = {
    getAvailability: jest.fn(),
    writeStockLedger: jest.fn(),
  };
  const invoices = {
    assertDispatchableInvoice: jest.fn(),
    issue: jest.fn(),
    void: jest.fn(),
  };
  const batches = { handoff: jest.fn() };
  const Strategy = DiscretePickingStrategy as any;
  const strategy: DiscretePickingStrategy = new Strategy(commands, workflowGate, sessions, batches);
  const planDeps = {
    commands,
    workflowGate,
    sessions,
    invariant: {},
    controlledStock,
    waybills: invoices,
  } as unknown as PickingPlanDeps;

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
  jest.mocked(lockAggregate).mockResolvedValue(aggregate as never);
  jest.mocked(assertWarehouseConfiguration).mockResolvedValue(undefined);
  jest.mocked(assertPlanningEligibility).mockResolvedValue(undefined);
  jest.mocked(lockSourceCapacities).mockResolvedValue([
    {
      skuId: PICKING_CONTRACT_IDS.sku,
      sourceLocationId: PICKING_CONTRACT_IDS.source,
      stockVersion: 7,
      remainingQty: 5,
    },
  ]);
  jest.mocked(planStalenessReason).mockResolvedValue(null);
  jest.mocked(assertActivePlanSession).mockResolvedValue(undefined);
  jest.mocked(assertPlanMembers).mockImplementation(async (_trx, _planId, shipmentIds: string[]) => {
    if (shipmentARetired && shipmentIds.includes(PICKING_CONTRACT_IDS.shipmentA)) {
      throw new ConflictException({
        code: 'PICKING_SHIPMENT_NOT_IN_PLAN',
        message: 'Retired shipment is not an active plan member',
      });
    }
  });
  jest
    .mocked(lockAndAssertPickerClaim)
    .mockImplementation(async (_trx, workItemId: string) => state.workItems[workItemId] as never);
  jest
    .mocked(loadWorkItem)
    .mockImplementation(async (_trx, workItemId: string) => state.workItems[workItemId] as never);
  jest
    .mocked(loadShipmentAllocations)
    .mockImplementation(
      async (_trx, _planId: string, shipmentId: string) => state.allocationsForShipment(shipmentId) as never,
    );
  jest.mocked(databaseNow).mockResolvedValue(new Date('2026-07-15T00:10:00.000Z'));

  return {
    strategy,
    plan: () => planPicking(planDeps, strategy.capabilities.name, planInput()),
    start: () => startPicking(planDeps, strategy.capabilities.name, startInput()),
    pickShipmentA: async () => {
      const input = scanInput('A', 2, 'scan-a');
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
    attemptRetiredShipmentA: () => strategy.scan(scanInput('A', 1, 'retired-scan-a')),
    snapshot: () => {
      const custodyTotal = (type: CustodyType) =>
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
        physicalToteCount: 0,
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

definePickingStrategyContract('production discrete', createProductionDiscreteFixture);
