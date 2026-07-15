import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { validateSync } from 'class-validator';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { RecallShipmentDispatchDto } from '../dto/shipment-recall.dto';
import { ShipmentRecallController, ShipmentRecallOperationController } from './shipment-recall.controller';

describe('ShipmentRecallController', () => {
  const shipmentId = '11111111-1111-4111-8111-111111111111';
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const dto: RecallShipmentDispatchDto = {
    dispatchAttemptId: attemptId,
    expectedManifestVersion: 3,
    physicalRecoveryConfirmed: true,
    reason: 'package_recovered',
  };

  it('requires recall scope and forwards exact attempt, actor and idempotency identity', async () => {
    const recall = { report: jest.fn().mockResolvedValue({ operationId: 'operation-1' }) };
    const controller = new ShipmentRecallController(recall as never);

    await controller.report(shipmentId, dto, 'recall-key', {
      userId: '33333333-3333-4333-8333-333333333333',
      roles: ['logistics_manager'],
    });

    const reportHandler: unknown = Object.getOwnPropertyDescriptor(ShipmentRecallController.prototype, 'report')?.value;
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, reportHandler)).toEqual([FULFILLMENT_SCOPE.DISPATCH_RECALL]);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, reportHandler)).toBe(202);
    expect(recall.report).toHaveBeenCalledWith(shipmentId, attemptId, dto, 'recall-key', {
      id: '33333333-3333-4333-8333-333333333333',
      roles: ['logistics_manager'],
    });
  });

  it('rejects non-visible idempotency and DTO recovery confirmation other than exact true', () => {
    const recall = { report: jest.fn() };
    const controller = new ShipmentRecallController(recall as never);
    expect(() => controller.report(shipmentId, dto, 'bad key', { id: shipmentId, roles: ['master'] })).toThrow(
      'visible ASCII Idempotency-Key',
    );
    expect(
      validateSync(
        Object.assign(new RecallShipmentDispatchDto(), {
          ...dto,
          physicalRecoveryConfirmed: false,
        }),
      ),
    ).not.toHaveLength(0);
    expect(recall.report).not.toHaveBeenCalled();
  });

  it('exposes the durable operation status under the same recall scope', async () => {
    const recall = { getOperation: jest.fn().mockResolvedValue({ operationStatus: 'pending' }) };
    const controller = new ShipmentRecallOperationController(recall as never);

    await controller.get('44444444-4444-4444-8444-444444444444');

    const getHandler: unknown = Object.getOwnPropertyDescriptor(
      ShipmentRecallOperationController.prototype,
      'get',
    )?.value;
    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, getHandler)).toEqual([FULFILLMENT_SCOPE.DISPATCH_RECALL]);
    expect(recall.getOperation).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
  });
});
