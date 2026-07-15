import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ScopeGuard } from '@app/authorization';
import { Test } from '@nestjs/testing';
import { validateSync } from 'class-validator';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ForceShipmentDispatchDto, ShipmentInspectionScanDto } from '../dto/shipment-dispatch.dto';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentDispatchService } from '../services/shipment-dispatch.service';
import { ShipmentService } from '../services/shipment.service';
import { ShipmentController } from './shipment.controller';

describe('ShipmentController V2 dispatch commands', () => {
  function fixture() {
    const legacy = {};
    const workflowGate = { assertV2MutationAllowed: jest.fn() };
    const inspectionScan = jest.fn().mockResolvedValue({ shipmentId: 'shipment-1', status: 'inspecting' });
    const forceDispatch = jest.fn().mockResolvedValue({ shipmentId: 'shipment-1', dispatchAttemptId: 'attempt-1' });
    const dispatch = {
      inspectionScan,
      forceDispatch,
    };
    const controller = new ShipmentController(legacy as never, workflowGate as never, dispatch);
    return { controller, workflowGate, inspectionScan, forceDispatch };
  }

  function controllerMethod(name: 'inspectionScan' | 'forceDispatch'): object {
    const descriptor = Object.getOwnPropertyDescriptor(ShipmentController.prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error(`Missing ShipmentController.${name}`);
    return descriptor.value as object;
  }

  async function requestAuthorizedByMappedRole(role = 'new_database_mapped_dispatcher') {
    const request = { user: { roles: [role] } };
    const guard = new ScopeGuard(
      { getAllAndOverride: () => [FULFILLMENT_SCOPE.DISPATCH_FORCE] } as never,
      { getScopesByRoles: jest.fn().mockResolvedValue(new Set([FULFILLMENT_SCOPE.DISPATCH_FORCE])) } as never,
    );
    const context = {
      getHandler: () => controllerMethod('forceDispatch'),
      getClass: () => ShipmentController,
      switchToHttp: () => ({ getRequest: () => request }),
    };
    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    return request;
  }

  it('exposes the exact inspection and force-dispatch routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ShipmentController)).toBe('shipments');
    expect(Reflect.getMetadata(PATH_METADATA, controllerMethod('inspectionScan'))).toBe(':id/inspection-scans');
    expect(Reflect.getMetadata(PATH_METADATA, controllerMethod('forceDispatch'))).toBe(':id/force-dispatch');
  });

  it('passes only the JWT actor and visible-ASCII idempotency key to commands', async () => {
    const { controller, workflowGate, inspectionScan, forceDispatch } = fixture();
    const user = { userId: 'jwt-actor', id: 'ignored', roles: ['logistics_manager'] };
    const authorizedRequest = await requestAuthorizedByMappedRole('logistics_manager');

    await controller.inspectionScan('shipment-1', { barcode: 'SKU-001', quantity: 2 }, 'inspection-key', user);
    await controller.forceDispatch(
      'shipment-1',
      { reason: 'verified damaged scan gun', csCaseId: '11111111-1111-4111-8111-111111111111', note: 'case' },
      'force-key',
      user,
      authorizedRequest,
    );

    expect(workflowGate.assertV2MutationAllowed).toHaveBeenNthCalledWith(1, 'shipment.inspection.scan');
    expect(workflowGate.assertV2MutationAllowed).toHaveBeenNthCalledWith(2, 'shipment.dispatch.force');
    expect(inspectionScan).toHaveBeenCalledWith('shipment-1', {
      barcode: 'SKU-001',
      quantity: 2,
      actor: { id: 'jwt-actor', roles: ['logistics_manager'] },
      idempotencyKey: 'inspection-key',
    });
    expect(forceDispatch).toHaveBeenCalledWith(
      'shipment-1',
      expect.objectContaining({
        reason: 'verified damaged scan gun',
        csCaseId: '11111111-1111-4111-8111-111111111111',
        note: 'case',
        actor: { id: 'jwt-actor', roles: ['logistics_manager'] },
        idempotencyKey: 'force-key',
        authorization: expect.objectContaining({
          scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
          granted: true,
        }) as unknown,
      }),
    );
  });

  it('accepts a newly DB-mapped role without hard-coded role names and passes the guard decision', async () => {
    const { controller, forceDispatch } = fixture();
    const request = await requestAuthorizedByMappedRole();

    await controller.forceDispatch(
      'shipment-1',
      { reason: 'approved physical exception' },
      'force-new-role',
      { userId: 'jwt-actor', roles: ['new_database_mapped_dispatcher'] },
      request,
    );

    expect(forceDispatch).toHaveBeenCalledWith(
      'shipment-1',
      expect.objectContaining({
        authorization: expect.objectContaining({
          scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
          granted: true,
        }) as unknown,
      }),
    );
  });

  it('requires ShipmentDispatchService in the Nest controller graph', async () => {
    const baseProviders = [
      { provide: ShipmentService, useValue: {} },
      { provide: FulfillmentWorkflowGate, useValue: { assertV2MutationAllowed: jest.fn() } },
    ];
    const guard = { canActivate: jest.fn().mockReturnValue(true) };
    const missingDispatchBuilder = Test.createTestingModule({
      controllers: [ShipmentController],
      providers: baseProviders,
    })
      .overrideGuard(ScopeGuard)
      .useValue(guard);
    await expect(missingDispatchBuilder.compile()).rejects.toThrow(/ShipmentDispatchService/);

    const moduleBuilder = Test.createTestingModule({
      controllers: [ShipmentController],
      providers: [...baseProviders, { provide: ShipmentDispatchService, useValue: {} }],
    })
      .overrideGuard(ScopeGuard)
      .useValue(guard);
    const moduleRef = await moduleBuilder.compile();
    expect(moduleRef.get(ShipmentController)).toBeInstanceOf(ShipmentController);
  });

  it('requires warehouse operate for inspection and dispatch force for override', () => {
    const metadata = (name: 'inspectionScan' | 'forceDispatch') =>
      Reflect.getMetadata('required_scopes', controllerMethod(name)) as string[] | undefined;

    expect(metadata('inspectionScan')).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(metadata('forceDispatch')).toEqual([FULFILLMENT_SCOPE.DISPATCH_FORCE]);
  });

  it('requires an authenticated actor and a bounded visible-ASCII idempotency key', () => {
    const { controller, inspectionScan } = fixture();
    const scan = { barcode: 'SKU-001', quantity: 1 };
    const actor = { userId: 'jwt-actor', roles: ['logistics_worker'] };

    expect(() => controller.inspectionScan('shipment-1', scan, 'key', {})).toThrow(UnauthorizedException);
    expect(() => controller.inspectionScan('shipment-1', scan, undefined, actor)).toThrow(BadRequestException);
    expect(() => controller.inspectionScan('shipment-1', scan, 'contains space', actor)).toThrow(BadRequestException);
    expect(() => controller.inspectionScan('shipment-1', scan, '한글', actor)).toThrow(BadRequestException);
    expect(() => controller.inspectionScan('shipment-1', scan, 'x'.repeat(201), actor)).toThrow(BadRequestException);
    expect(inspectionScan).not.toHaveBeenCalled();
  });

  it('validates positive scans and a nonblank bounded force reason', () => {
    expect(validateSync(Object.assign(new ShipmentInspectionScanDto(), { barcode: 'SKU-001', quantity: 1 }))).toEqual(
      [],
    );
    expect(
      validateSync(Object.assign(new ShipmentInspectionScanDto(), { barcode: '   ', quantity: 0 }))
        .map((error) => error.property)
        .sort(),
    ).toEqual(['barcode', 'quantity']);

    expect(
      validateSync(Object.assign(new ForceShipmentDispatchDto(), { reason: 'inventory physically verified' })),
    ).toHaveLength(0);
    expect(
      validateSync(
        Object.assign(new ForceShipmentDispatchDto(), {
          reason: ' '.repeat(501),
          csCaseId: 'not-a-uuid',
          note: 'x'.repeat(2_001),
        }),
      )
        .map((error) => error.property)
        .sort(),
    ).toEqual(['csCaseId', 'note', 'reason']);
  });

  it('strips forged operator identity from both request DTOs', async () => {
    const pipe = createGlobalValidationPipe();
    const scan = (await pipe.transform(
      { barcode: 'SKU-001', quantity: 1, operatorId: 'forged', actor: { id: 'forged' } },
      { type: 'body', metatype: ShipmentInspectionScanDto },
    )) as ShipmentInspectionScanDto & Record<string, unknown>;
    const force = (await pipe.transform(
      {
        reason: 'manual verification',
        operatorId: 'forged',
        actor: { id: 'forged' },
        authorization: { scope: FULFILLMENT_SCOPE.DISPATCH_FORCE, granted: true },
      },
      { type: 'body', metatype: ForceShipmentDispatchDto },
    )) as ForceShipmentDispatchDto & Record<string, unknown>;

    expect(scan.operatorId).toBeUndefined();
    expect(scan.actor).toBeUndefined();
    expect(force.operatorId).toBeUndefined();
    expect(force.actor).toBeUndefined();
    expect(force.authorization).toBeUndefined();
  });
});
