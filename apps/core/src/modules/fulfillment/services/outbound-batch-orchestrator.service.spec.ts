import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { OutboundBatchV2Controller } from '../controllers/outbound-batch-v2.controller';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { deriveOutboundBatchV2ReadSummary } from './outbound-batch.service';

const UUIDS = {
  actor: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  workItem: '33333333-3333-4333-8333-333333333333',
  batch: '44444444-4444-4444-8444-444444444444',
};

class QueryResult implements PromiseLike<unknown[]> {
  constructor(private readonly rows: unknown[]) {}

  from(): this {
    return this;
  }

  innerJoin(): this {
    return this;
  }

  where(): this {
    return this;
  }

  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

function workItem(overrides: Record<string, unknown> = {}) {
  return {
    id: UUIDS.workItem,
    batchId: UUIDS.batch,
    shipmentId: '55555555-5555-4555-8555-555555555555',
    status: 'queued',
    pickerId: null,
    pickerClaimedAt: null,
    pickerReleasedAt: null,
    packerId: null,
    packerClaimedAt: null,
    packerReleasedAt: null,
    handedOffAt: null,
    completedAt: null,
    leaseExpiresAt: null,
    leaseVersion: 0,
    exclusionReason: null,
    recoveryReason: null,
    waitingOperationId: null,
    createdAt: new Date('2026-07-15T00:00:00Z'),
    updatedAt: new Date('2026-07-15T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const commands = { execute: jest.fn() };
  const workflowGate = { assertV2MutationAllowed: jest.fn() };
  const service = new OutboundBatchOrchestrator(
    {} as never,
    commands as never,
    {} as never,
    {} as never,
    {} as never,
    workflowGate as never,
    {} as never,
  );
  return { service, commands, workflowGate };
}

describe('OutboundBatchOrchestrator policy', () => {
  it('derives a safe active V2 summary for legacy reads without trusting stored totals', () => {
    const summary = deriveOutboundBatchV2ReadSummary(
      [
        { workItemId: 'work-1', status: 'picking', shipmentLineId: 'line-1', lineQty: 2 },
        { workItemId: 'work-1', status: 'picking', shipmentLineId: 'line-2', lineQty: 3 },
        { workItemId: 'work-old', status: 'completed', shipmentLineId: 'line-old', lineQty: 99 },
        { workItemId: 'work-out', status: 'excluded', shipmentLineId: 'line-out', lineQty: 99 },
      ],
      'created',
    );

    expect(summary).toEqual({ status: 'picking', totalItems: 2, totalQty: 5 });
    expect(deriveOutboundBatchV2ReadSummary([], 'completed').status).toBe('completed');
  });

  it('derives status without allowing excluded or short-pick items to close the batch', () => {
    const { service } = makeService();
    const derive = (items: Array<Record<string, unknown>>) =>
      (service as any).derivedBatchStatus({ status: 'created' }, items);

    expect(derive([])).toBe('created');
    expect((service as any).derivedBatchStatus({ status: 'completed' }, [])).toBe('completed');
    expect(derive([workItem({ status: 'excluded' })])).toBe('created');
    expect(derive([workItem({ status: 'completed' }), workItem({ id: UUIDS.other, status: 'excluded' })])).toBe(
      'completed',
    );
    expect(derive([workItem({ status: 'short_pick_recovery' })])).toBe('picking');
    expect(derive([workItem(), workItem({ id: UUIDS.other, status: 'picking' })])).toBe('picking');
  });

  it('treats the shared lease as active only for the role matching work-item status', () => {
    const { service } = makeService();
    const response = (service as any).workItemResponse(
      workItem({
        status: 'packing',
        pickerId: UUIDS.actor,
        pickerClaimedAt: new Date('2026-07-15T00:00:00Z'),
        pickerReleasedAt: new Date('2026-07-15T00:10:00Z'),
        packerId: UUIDS.other,
        packerClaimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    );

    expect(response.pickerClaim.state).toBe('released');
    expect(response.pickerClaim.leaseExpiresAt).toBeNull();
    expect(response.packerClaim.state).toBe('active');
  });

  it('allows an explicit audited claim after DB-clock expiry but requires handoff before expiry', () => {
    const { service } = makeService();
    const now = new Date('2026-07-15T00:10:00Z');
    const expired = workItem({
      status: 'picking',
      pickerId: UUIDS.other,
      pickerClaimedAt: new Date('2026-07-15T00:00:00Z'),
      leaseExpiresAt: new Date('2026-07-15T00:09:59Z'),
    });
    expect(() => (service as any).assertClaimable('picker', expired, UUIDS.actor, now)).not.toThrow();

    const active = workItem({ ...expired, leaseExpiresAt: new Date('2026-07-15T00:10:01Z') });
    expect(() => (service as any).assertClaimable('picker', active, UUIDS.actor, now)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'WORK_ITEM_HANDOFF_REQUIRED' }) }),
    );
  });

  it('requires an active shipment tote assignment to be released before exclusion', async () => {
    const { service } = makeService();
    const queryResults = [[], [], [], [{ id: '66666666-6666-4666-8666-666666666666' }]];
    const select = jest.fn(() => new QueryResult(queryResults.shift() ?? []));
    const tx = {
      select,
    } as unknown as DbTx;
    const policy = service as unknown as {
      assertExcludable(
        aggregate: {
          shipment: { id: string; status: string };
          lines: Array<{ id: string; inspectedQty: number }>;
        },
        transaction: DbTx,
      ): Promise<void>;
    };

    let caught: unknown;
    try {
      await policy.assertExcludable(
        {
          shipment: { id: '55555555-5555-4555-8555-555555555555', status: 'ready' },
          lines: [{ id: '77777777-7777-4777-8777-777777777777', inspectedQty: 0 }],
        },
        tx,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    const response = (caught as ConflictException).getResponse();
    const code = typeof response === 'object' && response !== null && 'code' in response ? response.code : response;
    expect(code).toBe('WORK_ITEM_TOTE_RELEASE_REQUIRED');
    expect(select).toHaveBeenCalledTimes(4);
  });

  it('rejects named handoff from a non-manager before claiming a command row', async () => {
    const { service, commands } = makeService();
    await expect(
      service.handoff(
        UUIDS.workItem,
        { claimType: 'picker', targetWorkerId: UUIDS.other, expectedLeaseVersion: 1, reason: 'shift change' },
        'handoff-key',
        { id: UUIDS.actor, roles: ['logistics_worker'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it('keeps unimplemented total picking unavailable in V2', async () => {
    const { service, commands } = makeService();
    await expect(
      service.createBatch({ warehouseId: UUIDS.batch, pickingMethod: 'total_picking' } as never, 'create-key', {
        id: UUIDS.actor,
        roles: ['logistics_manager'],
      }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'OUTBOUND_BATCH_STRATEGY_NOT_AVAILABLE' }) });
    expect(commands.execute).not.toHaveBeenCalled();
  });
});

describe('OutboundBatchV2Controller contract', () => {
  const metadata = (method: keyof OutboundBatchV2Controller) =>
    Reflect.getMetadata(REQUIRED_SCOPES_KEY, OutboundBatchV2Controller.prototype[method]);

  it('registers static V2 routes under ScopeGuard with warehouse operate scope', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OutboundBatchV2Controller)).toHaveLength(1);
    expect(Reflect.getMetadata(PATH_METADATA, OutboundBatchV2Controller.prototype.create)).toBe('outbound-batches/v2');
    expect(metadata('create')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('addShipment')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('handoff')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
  });

  it('takes self-claim identity and audit actor from JWT rather than request body', async () => {
    const batches = { claimPicker: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new OutboundBatchV2Controller(batches as never);

    expect(() => controller.claimPicker(UUIDS.workItem, { expectedLeaseVersion: 0 }, 'key', {})).toThrow(
      UnauthorizedException,
    );
    await controller.claimPicker(UUIDS.workItem, { expectedLeaseVersion: 0 }, 'key', {
      sub: UUIDS.actor,
      roles: ['logistics_worker'],
    });
    expect(batches.claimPicker).toHaveBeenCalledWith(UUIDS.workItem, { expectedLeaseVersion: 0 }, 'key', {
      id: UUIDS.actor,
      roles: ['logistics_worker'],
    });
  });

  it('fails closed for generic picker handoff while retaining packer handoff', async () => {
    const batches = { handoff: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new OutboundBatchV2Controller(batches as never);
    const actor = { sub: UUIDS.actor, roles: ['logistics_manager'] };
    const request = {
      expectedLeaseVersion: 2,
      targetWorkerId: UUIDS.other,
      reason: 'shift change',
    };

    expect(() => controller.handoff(UUIDS.workItem, { ...request, claimType: 'picker' }, 'picker-key', actor)).toThrow(
      ConflictException,
    );
    expect(batches.handoff).not.toHaveBeenCalled();

    await controller.handoff(UUIDS.workItem, { ...request, claimType: 'packer' }, 'packer-key', actor);
    expect(batches.handoff).toHaveBeenCalledWith(UUIDS.workItem, { ...request, claimType: 'packer' }, 'packer-key', {
      id: UUIDS.actor,
      roles: ['logistics_manager'],
    });
  });
});
