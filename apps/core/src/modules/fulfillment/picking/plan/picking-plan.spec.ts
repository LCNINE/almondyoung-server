/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DbTx } from '../../../inventory/schema/inventory.schema';
import { planPicking } from './picking-plan';
import { conflict, errorMessage, isPlanValidationError } from './picking-plan.errors';
import {
  assertPlanningEligibility,
  lockAggregate,
  lockSourceCapacities,
  planStalenessReason,
} from './picking-plan.locks';
import {
  assertPlanMembers,
  assertPositiveQuantity,
  assertProfileComplete,
  assertRecipientComplete,
  assertWorkItemIdentity,
  databaseNow,
  invalidateDraftPlan,
  loadWorkItem,
  requiredIds,
} from './picking-plan.queries';
import { PickingPlanDeps } from './picking-plan.types';

// Layer 2 does real locking against a real database; layer 1 and the entry points are what this
// spec pins down. The DB-gated integration specs cover layer 2 (ADR-0030 §5).
jest.mock('./picking-plan.locks');

const IDS = Object.freeze({
  actor: 'worker-1',
  batch: 'batch-1',
  plan: 'plan-1',
  shipmentA: 'shipment-a',
  shipmentB: 'shipment-b',
  lineA: 'line-a',
  lineB: 'line-b',
  workItem: 'work-item-a',
  sku: 'sku-1',
  source: 'source-1',
});

class ChainedRows<T> implements PromiseLike<T[]> {
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
  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

/** A `trx` fake is the entire fixture for layer 1 — no DI, no container, no database. */
function fakeTx(selectQueue: unknown[][] = []) {
  const queue = [...selectQueue];
  const inserted: unknown[][] = [];
  const insertReturns: unknown[][] = [[{ id: IDS.plan, version: 1 }], [], []];
  const updateBuilder = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: IDS.plan }]),
  };
  const tx = {
    select: jest.fn(() => new ChainedRows(queue.shift() ?? [])),
    insert: jest.fn(() => {
      const index = inserted.length;
      const builder = {
        values: jest.fn((values: unknown) => {
          inserted.push(Array.isArray(values) ? (values as unknown[]) : [values]);
          return builder;
        }),
        returning: jest.fn().mockReturnThis(),
        then: (onfulfilled: (v: unknown[]) => unknown) => Promise.resolve(insertReturns[index] ?? []).then(onfulfilled),
      };
      return builder;
    }),
    update: jest.fn(() => updateBuilder),
    execute: jest.fn().mockResolvedValue([{ now: new Date('2026-07-15T00:10:00.000Z') }]),
  };
  return { tx: tx as unknown as DbTx, raw: tx, inserted, updateBuilder };
}

function planDepsFake() {
  const commands = {
    execute: jest.fn(
      async (_request: unknown, handler: any, suppliedTx: unknown) =>
        (await handler(suppliedTx, 'command-request-1')).response,
    ),
  };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const deps = {
    commands,
    workflowGate,
    sessions: { startSession: jest.fn() },
    invariant: {},
    controlledStock: {},
    waybills: {},
  } as unknown as PickingPlanDeps;
  return { deps, commands, workflowGate };
}

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    batchId: IDS.batch,
    shipmentIds: [IDS.shipmentB, IDS.shipmentA],
    actorId: IDS.actor,
    idempotencyKey: 'plan-key',
    ...overrides,
  };
}

const LOCKED_AGGREGATE = {
  batch: { id: IDS.batch, warehouseId: 'warehouse-1' },
  shipments: [
    { id: IDS.shipmentA, manifestVersion: 1, reservationVersion: 1 },
    { id: IDS.shipmentB, manifestVersion: 1, reservationVersion: 1 },
  ],
  lines: [
    { id: IDS.lineA, shipmentId: IDS.shipmentA, skuId: IDS.sku, qty: 2 },
    { id: IDS.lineB, shipmentId: IDS.shipmentB, skuId: IDS.sku, qty: 3 },
  ],
  workItems: [],
};

describe('picking plan layer — layer 1 pure functions', () => {
  describe('requiredIds', () => {
    it('sorts and de-duplicates nothing but rejects duplicates outright', () => {
      expect(requiredIds('shipmentIds', [IDS.shipmentB, IDS.shipmentA])).toEqual([IDS.shipmentA, IDS.shipmentB]);
      expect(() => requiredIds('shipmentIds', [IDS.shipmentA, IDS.shipmentA])).toThrow(BadRequestException);
    });

    it('rejects an empty or blank-only list', () => {
      expect(() => requiredIds('shipmentIds', [])).toThrow('shipmentIds must not be empty');
      expect(() => requiredIds('shipmentIds', ['   '])).toThrow('shipmentIds must not be empty');
    });
  });

  describe('assertPositiveQuantity', () => {
    it.each([0, -1, 1.5, Number.NaN])('rejects %p', (quantity) => {
      expect(() => assertPositiveQuantity(quantity)).toThrow(BadRequestException);
    });

    it('accepts a positive integer', () => {
      expect(() => assertPositiveQuantity(2)).not.toThrow();
    });
  });

  describe('assertWorkItemIdentity', () => {
    it('rejects a work item belonging to another batch or shipment', () => {
      const item = { batchId: IDS.batch, shipmentId: IDS.shipmentA } as never;
      expect(() => assertWorkItemIdentity(item, IDS.batch, IDS.shipmentA)).not.toThrow();
      expect(() => assertWorkItemIdentity(item, 'other-batch', IDS.shipmentA)).toThrow(ConflictException);
      expect(() => assertWorkItemIdentity(item, IDS.batch, IDS.shipmentB)).toThrow(ConflictException);
    });
  });

  describe('assertRecipientComplete', () => {
    const complete = {
      recipientName: '홍길동',
      phone: '010-0000-0000',
      postalCode: '06236',
      roadAddress: '서울시 강남구',
      detailAddress: '101호',
    };

    it('accepts a fully populated recipient snapshot', () => {
      expect(() => assertRecipientComplete(complete)).not.toThrow();
    });

    it.each(['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'])(
      'names %s when it is blank',
      (field) => {
        expect(() => assertRecipientComplete({ ...complete, [field]: '  ' })).toThrow(
          expect.objectContaining({
            response: expect.objectContaining({
              code: 'SHIPMENT_RECIPIENT_INCOMPLETE',
              message: expect.stringContaining(field),
            }),
          }),
        );
      },
    );

    it('treats a missing snapshot as every field missing', () => {
      expect(() => assertRecipientComplete(null)).toThrow(/recipientName,phone,postalCode,roadAddress,detailAddress/);
    });
  });

  describe('assertProfileComplete', () => {
    const profile = {
      senderSnapshot: { name: '아몬드영', phone: '02-000-0000' },
      originAddressSnapshot: { roadAddress: '서울시' },
      returnAddressSnapshot: { roadAddress: '서울시' },
      carrierAccountRef: 'cj-account-1',
    } as never;

    it('accepts a profile carrying all three snapshots and a carrier account', () => {
      expect(() => assertProfileComplete(profile)).not.toThrow();
    });

    it('accepts the senderName/senderPhone spelling of the sender snapshot', () => {
      expect(() =>
        assertProfileComplete({
          ...(profile as object),
          senderSnapshot: { senderName: '아몬드영', senderPhone: '02-000-0000' },
        } as never),
      ).not.toThrow();
    });

    it.each([
      ['an empty snapshot object', { originAddressSnapshot: {} }],
      ['a missing snapshot', { returnAddressSnapshot: null }],
      ['an array snapshot', { originAddressSnapshot: [] }],
      ['a blank carrier account', { carrierAccountRef: '  ' }],
      ['a sender without a phone', { senderSnapshot: { name: '아몬드영' } }],
    ])('rejects %s', (_label, override) => {
      expect(() => assertProfileComplete({ ...(profile as object), ...override } as never)).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE' }),
        }),
      );
    });
  });

  describe('isPlanValidationError / errorMessage', () => {
    it('treats only the three request-shaped Nest exceptions as plan validation failures', () => {
      expect(isPlanValidationError(new BadRequestException('x'))).toBe(true);
      expect(isPlanValidationError(new ConflictException('x'))).toBe(true);
      expect(isPlanValidationError(new NotFoundException('x'))).toBe(true);
      expect(isPlanValidationError(new Error('x'))).toBe(false);
      expect(isPlanValidationError('x')).toBe(false);
    });

    it('unwraps the message from a code/message conflict body', () => {
      expect(errorMessage(conflict('PICKING_SOURCE_STALE', 'source stale'))).toBe('source stale');
    });

    it('unwraps a plain-string and an array message', () => {
      expect(errorMessage(new NotFoundException('missing thing'))).toBe('missing thing');
      expect(errorMessage(new BadRequestException({ message: ['a', 'b'] }))).toBe('a; b');
    });
  });

  describe('databaseNow', () => {
    it('reads the clock from the transaction rather than the process', async () => {
      const { tx } = fakeTx();
      await expect(databaseNow(tx)).resolves.toEqual(new Date('2026-07-15T00:10:00.000Z'));
    });

    it('fails loudly when the database returns no clock', async () => {
      const tx = { execute: jest.fn().mockResolvedValue([]) } as unknown as DbTx;
      await expect(databaseNow(tx)).rejects.toThrow('Database clock unavailable');
    });
  });

  describe('loadWorkItem', () => {
    it('locks the row only when asked', async () => {
      const { tx } = fakeTx([[{ id: IDS.workItem }], [{ id: IDS.workItem }]]);
      await expect(loadWorkItem(tx, IDS.workItem)).resolves.toEqual({ id: IDS.workItem });
      await expect(loadWorkItem(tx, IDS.workItem, true)).resolves.toEqual({ id: IDS.workItem });
    });

    it('404s on an unknown work item', async () => {
      const { tx } = fakeTx([[]]);
      await expect(loadWorkItem(tx, IDS.workItem)).rejects.toThrow(NotFoundException);
    });
  });

  describe('assertPlanMembers', () => {
    it('accepts an exact, sorted membership match', async () => {
      const { tx } = fakeTx([[{ shipmentId: IDS.shipmentA }, { shipmentId: IDS.shipmentB }]]);
      await expect(assertPlanMembers(tx, IDS.plan, [IDS.shipmentB, IDS.shipmentA])).resolves.toBeUndefined();
    });

    it('rejects a duplicated or empty request before touching the database', async () => {
      const { tx, raw } = fakeTx();
      await expect(assertPlanMembers(tx, IDS.plan, [IDS.shipmentA, IDS.shipmentA])).rejects.toThrow(
        BadRequestException,
      );
      await expect(assertPlanMembers(tx, IDS.plan, [])).rejects.toThrow(BadRequestException);
      expect(raw.select).not.toHaveBeenCalled();
    });

    it('rejects when a requested shipment is not an active member', async () => {
      const { tx } = fakeTx([[{ shipmentId: IDS.shipmentA }]]);
      await expect(assertPlanMembers(tx, IDS.plan, [IDS.shipmentA, IDS.shipmentB])).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PICKING_SHIPMENT_NOT_IN_PLAN' }),
      });
    });
  });

  describe('invalidateDraftPlan', () => {
    it('returns the invalidated envelope after a successful CAS', async () => {
      const { tx } = fakeTx();
      await expect(invalidateDraftPlan(tx, IDS.plan, IDS.batch, 'source stale', 'op-1')).resolves.toEqual({
        state: 'invalidated',
        operationId: 'op-1',
        planId: IDS.plan,
        batchId: IDS.batch,
        reason: 'source stale',
      });
    });

    it('conflicts when the draft moved underneath the CAS', async () => {
      const { tx, updateBuilder } = fakeTx();
      updateBuilder.returning.mockResolvedValue([]);
      await expect(invalidateDraftPlan(tx, IDS.plan, IDS.batch, 'source stale', 'op-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PICKING_PLAN_STALE_VERSION' }),
      });
    });
  });
});

describe('planPicking', () => {
  beforeEach(() => {
    jest.mocked(lockAggregate).mockResolvedValue(LOCKED_AGGREGATE as never);
    jest.mocked(assertPlanningEligibility).mockResolvedValue(undefined);
    jest.mocked(planStalenessReason).mockResolvedValue(null);
    jest
      .mocked(lockSourceCapacities)
      .mockResolvedValue([{ skuId: IDS.sku, sourceLocationId: IDS.source, stockVersion: 7, remainingQty: 5 }]);
  });

  it('derives the command namespace from the strategy name alone', async () => {
    const { deps, commands, workflowGate } = planDepsFake();
    const { tx } = fakeTx([[], [], [{ version: 0 }]]);

    await planPicking(deps, 'aggregate_then_sort', planInput() as never, tx);

    expect(workflowGate.assertV2MutationAllowed).toHaveBeenCalledWith('picking.aggregate_then_sort.plan');
    expect(commands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        commandType: 'picking.aggregate_then_sort.plan',
        canonicalRequest: expect.objectContaining({ strategy: 'aggregate_then_sort' }),
      }),
      expect.any(Function),
      tx,
    );
  });

  // 이사: picking-strategy.contract.spec.ts 의 「공유 소스를 초과 배정하지 않는다」
  it('creates exact source allocations without overcommitting a shared source', async () => {
    const { deps } = planDepsFake();
    const { tx, inserted } = fakeTx([[], [], [{ version: 0 }]]);

    const result = await planPicking(deps, 'discrete', planInput() as never, tx);

    expect(result).toMatchObject({
      state: 'planned',
      strategy: 'discrete',
      batchId: IDS.batch,
      shipmentIds: [IDS.shipmentA, IDS.shipmentB],
      allocationCount: 2,
      totalQty: 5,
    });
    expect(inserted[2]).toEqual([
      { planId: IDS.plan, shipmentLineId: IDS.lineA, sourceLocationId: IDS.source, qty: 2, sourceStockVersion: 7 },
      { planId: IDS.plan, shipmentLineId: IDS.lineB, sourceLocationId: IDS.source, qty: 3, sourceStockVersion: 7 },
    ]);
  });

  it('refuses to plan when the shared source cannot cover every line', async () => {
    const { deps } = planDepsFake();
    jest
      .mocked(lockSourceCapacities)
      .mockResolvedValue([{ skuId: IDS.sku, sourceLocationId: IDS.source, stockVersion: 7, remainingQty: 4 }]);
    const { tx } = fakeTx([[], [], [{ version: 0 }]]);

    await expect(planPicking(deps, 'discrete', planInput() as never, tx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_SOURCE_INSUFFICIENT' }),
    });
  });

  it('rejects a second open plan for the batch', async () => {
    const { deps } = planDepsFake();
    const { tx } = fakeTx([[{ id: IDS.plan, status: 'active' }]]);

    await expect(planPicking(deps, 'discrete', planInput() as never, tx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_PLAN_ALREADY_ACTIVE' }),
    });
  });

  // 이사: discrete-picking.strategy.spec.ts
  it('does not invalidate an existing draft when caller shipment membership differs', async () => {
    const { deps } = planDepsFake();
    const { tx, raw } = fakeTx([[{ id: IDS.plan, status: 'draft' }], [{ shipmentId: 'someone-else' }]]);

    await expect(
      planPicking(deps, 'discrete', planInput({ shipmentIds: [IDS.shipmentA] }) as never, tx),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH' }),
    });
    expect(raw.update).not.toHaveBeenCalled();
  });

  // 이사: discrete-picking.strategy.spec.ts
  it('commits a stored-member draft validation failure as an invalidated result', async () => {
    const { deps } = planDepsFake();
    jest
      .mocked(lockAggregate)
      .mockRejectedValue(new ConflictException({ code: 'PICKING_SOURCE_STALE', message: 'source stale' }));
    const { tx, raw } = fakeTx([[{ id: IDS.plan, status: 'draft' }], [{ shipmentId: IDS.shipmentA }]]);

    await expect(
      planPicking(deps, 'discrete', planInput({ shipmentIds: [IDS.shipmentA] }) as never, tx),
    ).resolves.toEqual({
      state: 'invalidated',
      operationId: 'command-request-1',
      planId: IDS.plan,
      batchId: IDS.batch,
      reason: 'source stale',
    });
    expect(raw.update).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-validation failure instead of invalidating the draft', async () => {
    const { deps } = planDepsFake();
    jest.mocked(lockAggregate).mockRejectedValue(new Error('connection reset'));
    const { tx, raw } = fakeTx([[{ id: IDS.plan, status: 'draft' }], [{ shipmentId: IDS.shipmentA }]]);

    await expect(
      planPicking(deps, 'discrete', planInput({ shipmentIds: [IDS.shipmentA] }) as never, tx),
    ).rejects.toThrow('connection reset');
    expect(raw.update).not.toHaveBeenCalled();
  });
});
