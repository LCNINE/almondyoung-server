import { UnauthorizedException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AggregateBulkCartScanDto, AggregateSortScanDto } from '../dto/picking-v2.dto';
import { PickingCommandV2Controller, PickingV2Controller } from './picking-v2.controller';

describe('PickingV2Controller aggregate-then-sort contract', () => {
  const bulkScan = {
    batchId: '11111111-1111-4111-8111-111111111111',
    planId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    skuId: '66666666-6666-4666-8666-666666666666',
    sourceLocationId: '77777777-7777-4777-8777-777777777777',
    cartId: 'BULK-CART-17',
    quantity: 4,
  };

  it('routes the JWT actor and idempotency key to both explicit scan commands', async () => {
    const picking = {
      aggregateBulkCartScan: jest.fn().mockResolvedValue({ operationId: 'bulk-operation' }),
      aggregateSortScan: jest.fn().mockResolvedValue({ operationId: 'sort-operation' }),
      aggregateCartHandoff: jest.fn().mockResolvedValue({ operationId: 'handoff-operation' }),
    };
    const controller = new PickingV2Controller(picking as never);
    const user = { userId: 'jwt-worker', id: 'ignored-id', roles: ['warehouse_operator'] };

    await controller.bulkCartScan(bulkScan, 'bulk-key', user);
    await controller.sortScan(
      {
        batchId: bulkScan.batchId,
        planId: bulkScan.planId,
        sessionId: bulkScan.sessionId,
        workItemId: '44444444-4444-4444-8444-444444444444',
        shipmentId: '55555555-5555-4555-8555-555555555555',
        shipmentLineId: '88888888-8888-4888-8888-888888888888',
        skuId: bulkScan.skuId,
        cartId: bulkScan.cartId,
        quantity: 2,
        expectedLeaseVersion: 2,
        destinationCustody: 'SORTING',
      },
      'sort-key',
      user,
    );
    await controller.cartHandoff(
      {
        batchId: bulkScan.batchId,
        planId: bulkScan.planId,
        sessionId: bulkScan.sessionId,
        expectedOwnerId: '99999999-9999-4999-8999-999999999999',
        targetWorkerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cartId: bulkScan.cartId,
        reason: 'shift change',
      },
      'handoff-key',
      user,
    );

    expect(picking.aggregateBulkCartScan).toHaveBeenCalledWith({
      ...bulkScan,
      strategy: 'aggregate_then_sort',
      stage: 'bulk_collect',
      actor: { id: 'jwt-worker', roles: ['warehouse_operator'] },
      idempotencyKey: 'bulk-key',
    });
    expect(picking.aggregateSortScan).toHaveBeenCalledWith({
      batchId: bulkScan.batchId,
      planId: bulkScan.planId,
      sessionId: bulkScan.sessionId,
      workItemId: '44444444-4444-4444-8444-444444444444',
      shipmentId: '55555555-5555-4555-8555-555555555555',
      shipmentLineId: '88888888-8888-4888-8888-888888888888',
      skuId: bulkScan.skuId,
      cartId: bulkScan.cartId,
      quantity: 2,
      expectedLeaseVersion: 2,
      destinationCustody: 'SORTING',
      strategy: 'aggregate_then_sort',
      stage: 'sort',
      actor: { id: 'jwt-worker', roles: ['warehouse_operator'] },
      idempotencyKey: 'sort-key',
    });
    expect(picking.aggregateCartHandoff).toHaveBeenCalledWith({
      batchId: bulkScan.batchId,
      planId: bulkScan.planId,
      sessionId: bulkScan.sessionId,
      expectedOwnerId: '99999999-9999-4999-8999-999999999999',
      targetWorkerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      cartId: bulkScan.cartId,
      reason: 'shift change',
      actor: { id: 'jwt-worker', roles: ['warehouse_operator'] },
      idempotencyKey: 'handoff-key',
    });
  });

  it('rejects a request without an authenticated actor identity', () => {
    const controller = new PickingV2Controller({} as never);

    expect(() => controller.bulkCartScan(bulkScan, 'key', {})).toThrow(UnauthorizedException);
  });

  it('requires warehouse operate scope for both scan endpoints', () => {
    const metadata = (methodName: 'bulkCartScan' | 'sortScan' | 'cartHandoff') => {
      const method = Object.getOwnPropertyDescriptor(PickingV2Controller.prototype, methodName)?.value as object;
      return Reflect.getMetadata('required_scopes', method) as string[] | undefined;
    };

    expect(metadata('bulkCartScan')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('sortScan')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('cartHandoff')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
  });

  it('validates all custody identities and does not accept a body actor', () => {
    const dto = Object.assign(new AggregateSortScanDto(), {
      batchId: bulkScan.batchId,
      planId: bulkScan.planId,
      sessionId: bulkScan.sessionId,
      workItemId: '44444444-4444-4444-8444-444444444444',
      shipmentId: '55555555-5555-4555-8555-555555555555',
      shipmentLineId: '88888888-8888-4888-8888-888888888888',
      skuId: bulkScan.skuId,
      cartId: bulkScan.cartId,
      quantity: 2,
      expectedLeaseVersion: 2,
      destinationCustody: 'PACKING',
      actor: { id: 'forged-worker', roles: ['admin'] },
    });

    expect(validateSync(dto)).toHaveLength(0);
    expect(Object.keys(new AggregateBulkCartScanDto())).not.toContain('actor');

    const invalid = Object.assign(new AggregateSortScanDto(), {
      batchId: bulkScan.batchId,
      planId: bulkScan.planId,
      sessionId: bulkScan.sessionId,
      workItemId: '44444444-4444-4444-8444-444444444444',
      shipmentId: '55555555-5555-4555-8555-555555555555',
      skuId: bulkScan.skuId,
      cartId: bulkScan.cartId,
      quantity: 0,
      expectedLeaseVersion: 2,
      destinationCustody: 'WORKER',
      shipmentLineId: 'not-a-uuid',
    });
    expect(
      validateSync(invalid)
        .map((error) => error.property)
        .sort(),
    ).toEqual(['destinationCustody', 'quantity', 'shipmentLineId']);
  });
});

describe('PickingCommandV2Controller generic strategy contract', () => {
  const actor = { userId: 'worker-1', roles: ['warehouse_operator'] };
  const ids = {
    batchId: '11111111-1111-4111-8111-111111111111',
    planId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    workItemId: '44444444-4444-4444-8444-444444444444',
    shipmentId: '55555555-5555-4555-8555-555555555555',
    shipmentLineId: '66666666-6666-4666-8666-666666666666',
    skuId: '77777777-7777-4777-8777-777777777777',
    sourceLocationId: '88888888-8888-4888-8888-888888888888',
  };

  it('exposes every generic strategy command with trusted actor and idempotency', async () => {
    const picking = {
      plan: jest.fn(),
      start: jest.fn(),
      scan: jest.fn(),
      handoff: jest.fn(),
      completePick: jest.fn(),
    };
    const controller = new PickingCommandV2Controller(picking as never);
    await controller.plan(
      { strategy: 'discrete', batchId: ids.batchId, shipmentIds: [ids.shipmentId] },
      'plan-key',
      actor,
    );
    await controller.start({ batchId: ids.batchId, planId: ids.planId }, 'start-key', actor);
    await controller.scan({ ...ids, quantity: 2, expectedLeaseVersion: 1 }, 'scan-key', actor);
    await controller.handoff(
      {
        batchId: ids.batchId,
        planId: ids.planId,
        sessionId: ids.sessionId,
        workItemId: ids.workItemId,
        shipmentId: ids.shipmentId,
        targetWorkerId: '99999999-9999-4999-8999-999999999999',
        expectedLeaseVersion: 2,
        reason: 'shift change',
      },
      'handoff-key',
      actor,
    );
    await controller.complete(
      {
        batchId: ids.batchId,
        planId: ids.planId,
        sessionId: ids.sessionId,
        workItemId: ids.workItemId,
        shipmentId: ids.shipmentId,
        expectedLeaseVersion: 3,
      },
      'complete-key',
      actor,
    );

    expect(picking.plan).toHaveBeenCalledWith('discrete', {
      batchId: ids.batchId,
      shipmentIds: [ids.shipmentId],
      actorId: 'worker-1',
      idempotencyKey: 'plan-key',
    });
    expect(picking.scan).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'discrete',
        stage: 'source',
        actor: { id: 'worker-1', roles: ['warehouse_operator'] },
        idempotencyKey: 'scan-key',
      }),
    );
    expect(picking.completePick).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'complete-key',
        actor: { id: 'worker-1', roles: ['warehouse_operator'] },
      }),
    );
  });

  it('rejects missing/unsafe idempotency and requires warehouse scope', () => {
    const controller = new PickingCommandV2Controller({} as never);
    expect(() => controller.start({ batchId: ids.batchId, planId: ids.planId }, undefined, actor)).toThrow();
    expect(() => controller.start({ batchId: ids.batchId, planId: ids.planId }, 'contains space', actor)).toThrow();
    for (const name of ['plan', 'start', 'scan', 'handoff', 'complete'] as const) {
      const method = Object.getOwnPropertyDescriptor(PickingCommandV2Controller.prototype, name)?.value as object;
      expect(Reflect.getMetadata('required_scopes', method)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    }
  });
});
