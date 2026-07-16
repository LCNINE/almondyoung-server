import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { validateSync } from 'class-validator';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { AssignToteDto, RegisterToteDto, ReleaseToteDto, ToteHandoffDto, ToteScanDto } from '../dto/tote.dto';
import { ToteController } from './tote.controller';

describe('ToteController pick-to-tote contract', () => {
  const assignment = {
    batchId: '11111111-1111-4111-8111-111111111111',
    planId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    workItemId: '44444444-4444-4444-8444-444444444444',
    shipmentId: '55555555-5555-4555-8555-555555555555',
    toteBarcode: 'TOTE-00017',
    expectedLeaseVersion: 3,
  };
  const actor = { userId: 'jwt-worker', id: 'ignored-id', roles: ['logistics_worker'] };

  it('routes all physical tote commands with JWT actor and explicit idempotency', async () => {
    const picking = {
      registerTote: jest.fn().mockResolvedValue({ operationId: 'register-operation' }),
      assignTote: jest.fn().mockResolvedValue({ operationId: 'assign-operation' }),
      toteScan: jest.fn().mockResolvedValue({ operationId: 'scan-operation' }),
      toteHandoff: jest.fn().mockResolvedValue({ operationId: 'handoff-operation' }),
      releaseTote: jest.fn().mockResolvedValue({ operationId: 'release-operation' }),
    };
    const controller = new ToteController(picking as never);

    await controller.register(
      { warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', toteBarcode: assignment.toteBarcode },
      'register-key',
      actor,
    );
    await controller.assign(assignment, 'assign-key', actor);
    await controller.scan(
      {
        ...assignment,
        shipmentLineId: '66666666-6666-4666-8666-666666666666',
        skuId: '77777777-7777-4777-8777-777777777777',
        sourceLocationId: '88888888-8888-4888-8888-888888888888',
        quantity: 4,
      },
      'scan-key',
      actor,
    );
    await controller.handoff(
      {
        ...assignment,
        targetWorkItemId: '99999999-9999-4999-8999-999999999999',
        targetShipmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        targetExpectedLeaseVersion: 5,
        reason: 'empty tote reassignment',
      },
      'handoff-key',
      { ...actor, roles: ['logistics_manager'] },
    );
    await controller.release({ ...assignment, reason: 'packing custody settled' }, 'release-key', actor);

    const jwtActor = { id: 'jwt-worker', roles: ['logistics_worker'] };
    expect(picking.registerTote).toHaveBeenCalledWith({
      warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      toteBarcode: assignment.toteBarcode,
      actor: jwtActor,
      idempotencyKey: 'register-key',
    });
    expect(picking.assignTote).toHaveBeenCalledWith({
      ...assignment,
      actor: jwtActor,
      idempotencyKey: 'assign-key',
    });
    expect(picking.toteScan).toHaveBeenCalledWith({
      ...assignment,
      shipmentLineId: '66666666-6666-4666-8666-666666666666',
      skuId: '77777777-7777-4777-8777-777777777777',
      sourceLocationId: '88888888-8888-4888-8888-888888888888',
      quantity: 4,
      strategy: 'pick_to_tote',
      stage: 'source',
      actor: jwtActor,
      idempotencyKey: 'scan-key',
    });
    expect(picking.toteHandoff).toHaveBeenCalledWith({
      ...assignment,
      targetWorkItemId: '99999999-9999-4999-8999-999999999999',
      targetShipmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      targetExpectedLeaseVersion: 5,
      reason: 'empty tote reassignment',
      actor: { id: 'jwt-worker', roles: ['logistics_manager'] },
      idempotencyKey: 'handoff-key',
    });
    expect(picking.releaseTote).toHaveBeenCalledWith({
      ...assignment,
      reason: 'packing custody settled',
      actor: jwtActor,
      idempotencyKey: 'release-key',
    });
  });

  it('requires an authenticated identity and a nonblank bounded idempotency key', () => {
    const picking = { registerTote: jest.fn() };
    const controller = new ToteController(picking as never);
    const registration = {
      warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      toteBarcode: assignment.toteBarcode,
    };

    expect(() => controller.register(registration, 'key', {})).toThrow(UnauthorizedException);
    expect(() => controller.register(registration, undefined, actor)).toThrow(BadRequestException);
    expect(() => controller.register(registration, 'contains whitespace', actor)).toThrow(BadRequestException);
    expect(() => controller.register(registration, 'x'.repeat(201), actor)).toThrow(BadRequestException);
    expect(picking.registerTote).not.toHaveBeenCalled();
  });

  it('requires warehouse operate scope on every command', () => {
    const metadata = (methodName: 'register' | 'assign' | 'scan' | 'handoff' | 'release') => {
      const method = Object.getOwnPropertyDescriptor(ToteController.prototype, methodName)?.value as object;
      return Reflect.getMetadata('required_scopes', method) as string[] | undefined;
    };

    expect(metadata('register')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('assign')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('scan')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('handoff')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('release')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
  });

  it('strictly validates physical barcodes, custody identities, quantities, versions and reasons', () => {
    expect(
      validateSync(
        Object.assign(new RegisterToteDto(), {
          warehouseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          toteBarcode: assignment.toteBarcode,
        }),
      ),
    ).toHaveLength(0);
    expect(validateSync(Object.assign(new AssignToteDto(), assignment))).toHaveLength(0);

    const invalidScan = Object.assign(new ToteScanDto(), {
      ...assignment,
      toteBarcode: 'not a physical barcode',
      expectedLeaseVersion: -1,
      shipmentLineId: 'not-a-uuid',
      skuId: '77777777-7777-4777-8777-777777777777',
      sourceLocationId: '88888888-8888-4888-8888-888888888888',
      quantity: 0,
    });
    expect(
      validateSync(invalidScan)
        .map((error) => error.property)
        .sort(),
    ).toEqual(['expectedLeaseVersion', 'quantity', 'shipmentLineId', 'toteBarcode']);

    const invalidHandoff = Object.assign(new ToteHandoffDto(), {
      ...assignment,
      targetWorkItemId: 'not-a-uuid',
      targetShipmentId: 'also-not-a-uuid',
      targetExpectedLeaseVersion: -1,
      reason: '   ',
    });
    expect(
      validateSync(invalidHandoff)
        .map((error) => error.property)
        .sort(),
    ).toEqual(['reason', 'targetExpectedLeaseVersion', 'targetShipmentId', 'targetWorkItemId']);

    const invalidRelease = Object.assign(new ReleaseToteDto(), {
      ...assignment,
      reason: 'x'.repeat(501),
    });
    expect(validateSync(invalidRelease).map((error) => error.property)).toEqual(['reason']);
  });

  it('does not trust operator identity supplied in the request body', async () => {
    const pipe = createGlobalValidationPipe();
    const transformed = (await pipe.transform(
      {
        ...assignment,
        shipmentLineId: '66666666-6666-4666-8666-666666666666',
        skuId: '77777777-7777-4777-8777-777777777777',
        sourceLocationId: '88888888-8888-4888-8888-888888888888',
        quantity: 1,
        operatorId: 'forged-worker',
        actor: { id: 'forged-worker', roles: ['master'] },
      },
      { type: 'body', metatype: ToteScanDto },
    )) as ToteScanDto & Record<string, unknown>;

    expect(transformed.operatorId).toBeUndefined();
    expect(transformed.actor).toBeUndefined();
  });
});
