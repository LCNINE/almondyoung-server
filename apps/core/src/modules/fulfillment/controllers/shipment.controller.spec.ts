import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createGlobalValidationPipe } from '../../../platform/http/validation-pipe';
import { PATH_METADATA } from '@nestjs/common/constants';
import {
  REQUIRED_PERMISSIONS_KEY,
  createCheckpointsForTesting,
  PermissionCheckpoints,
  recordPermissionDecisions,
} from '@app/authorization';
import { Test } from '@nestjs/testing';
import { validateSync } from 'class-validator';
import { ForceShipmentDispatchDto, ShipmentInspectionScanDto } from '../dto/shipment-dispatch.dto';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { ShipmentDispatchService } from '../services/shipment-dispatch.service';
import { ShipmentController } from './shipment.controller';

describe('ShipmentController V2 dispatch commands', () => {
  function fixture() {
    const workflowGate = { assertV2MutationAllowed: jest.fn() };
    const inspectionScan = jest.fn().mockResolvedValue({ shipmentId: 'shipment-1', status: 'inspecting' });
    const forceDispatch = jest.fn().mockResolvedValue({ shipmentId: 'shipment-1', dispatchAttemptId: 'attempt-1' });
    const dispatch = {
      inspectionScan,
      forceDispatch,
    };
    const controller = new ShipmentController(workflowGate as never, dispatch, createCheckpointsForTesting());
    return { controller, workflowGate, inspectionScan, forceDispatch };
  }

  function controllerMethod(name: 'inspectionScan' | 'forceDispatch'): object {
    const descriptor = Object.getOwnPropertyDescriptor(ShipmentController.prototype, name);
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error(`Missing ShipmentController.${name}`);
    return descriptor.value as object;
  }

  // 라우트 가드(PermissionGuard)가 그 요청이 받은 권한에 대해 남기는 낙인과 같은 것을 남긴다.
  function requestAuthorizedForForce(): object {
    const request = {};
    recordPermissionDecisions(request, ['fulfillment.dispatch.force']);
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
    const authorizedRequest = requestAuthorizedForForce();

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
          permission: 'fulfillment.dispatch.force',
          granted: true,
        }) as unknown,
      }),
    );
  });

  it('accepts a newly mapped role without hard-coded role names and passes the guard decision', async () => {
    const { controller, forceDispatch } = fixture();
    const request = requestAuthorizedForForce();

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
          permission: 'fulfillment.dispatch.force',
          granted: true,
        }) as unknown,
      }),
    );
  });

  it('requires ShipmentDispatchService in the Nest controller graph', async () => {
    const baseProviders = [
      { provide: FulfillmentWorkflowGate, useValue: { assertV2MutationAllowed: jest.fn() } },
      { provide: PermissionCheckpoints, useValue: createCheckpointsForTesting() },
    ];
    const missingDispatchBuilder = Test.createTestingModule({
      controllers: [ShipmentController],
      providers: baseProviders,
    });
    await expect(missingDispatchBuilder.compile()).rejects.toThrow(/ShipmentDispatchService/);

    const moduleBuilder = Test.createTestingModule({
      controllers: [ShipmentController],
      providers: [...baseProviders, { provide: ShipmentDispatchService, useValue: {} }],
    });
    const moduleRef = await moduleBuilder.compile();
    expect(moduleRef.get(ShipmentController)).toBeInstanceOf(ShipmentController);
  });

  it('requires warehouse operate for inspection and dispatch force for override', () => {
    const metadata = (name: 'inspectionScan' | 'forceDispatch') =>
      Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controllerMethod(name)) as string[] | undefined;

    expect(metadata('inspectionScan')).toEqual(['fulfillment.warehouse.operate']);
    expect(metadata('forceDispatch')).toEqual(['fulfillment.dispatch.force']);
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
        authorization: { permission: 'fulfillment.dispatch.force', granted: true },
      },
      { type: 'body', metatype: ForceShipmentDispatchDto },
    )) as ForceShipmentDispatchDto & Record<string, unknown>;

    expect(scan.operatorId).toBeUndefined();
    expect(scan.actor).toBeUndefined();
    expect(force.operatorId).toBeUndefined();
    expect(force.actor).toBeUndefined();
    expect(force.authorization).toBeUndefined();
  });

  it('관리자 강제 발송 라우트는 dispatch.force 만 요구한다(스테이션 권한으로 열리지 않는다)', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, ShipmentController.prototype.forceDispatch)).toEqual([
      'fulfillment.dispatch.force',
    ]);
  });
});

describe('ShipmentController force-dispatch decision source', () => {
  const dto = { reason: 'verified damaged scan gun', csCaseId: '11111111-1111-4111-8111-111111111111', note: 'case' };
  const user = { userId: 'jwt-actor', sub: 'jwt-actor', roles: ['admin'] };
  const run = async (request: object) => {
    const forceDispatch = jest.fn().mockResolvedValue({ shipmentId: 'shipment-1', dispatchAttemptId: 'attempt-1' });
    const controller = new ShipmentController(
      { assertV2MutationAllowed: jest.fn() } as never,
      { inspectionScan: jest.fn(), forceDispatch },
      createCheckpointsForTesting({ admin: ['fulfillment.dispatch.force'] }),
    );
    await controller.forceDispatch('shipment-1', dto, 'force-key', user, request);
    return forceDispatch.mock.calls[0][1].authorization;
  };

  it('passes the permission stamp', async () => {
    const request = {};
    recordPermissionDecisions(request, ['fulfillment.dispatch.force']);
    expect(await run(request)).toMatchObject({ permission: 'fulfillment.dispatch.force', granted: true });
  });

  it('keeps a station stamp out of the admin route', async () => {
    const request = {};
    recordPermissionDecisions(request, ['fulfillment.dispatch.station_force']);
    expect(await run(request)).toBeUndefined();
  });

  it('passes no decision for a request without a permission stamp', async () => {
    expect(await run({ user })).toBeUndefined();
  });
});
