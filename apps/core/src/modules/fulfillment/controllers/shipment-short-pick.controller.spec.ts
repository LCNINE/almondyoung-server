import { REQUIRED_SCOPES_KEY } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { ReportShipmentShortPickDto } from '../dto/shipment-short-pick.dto';
import { ShipmentShortPickController } from './shipment-short-pick.controller';

describe('ShipmentShortPickController', () => {
  const shipmentId = '11111111-1111-4111-8111-111111111111';
  const dto: ReportShipmentShortPickDto = {
    workItemId: '22222222-2222-4222-8222-222222222222',
    expectedWorkItemLeaseVersion: 3,
    planId: '33333333-3333-4333-8333-333333333333',
    expectedPlanVersion: 2,
    sessionId: '44444444-4444-4444-8444-444444444444',
    expectedSessionVersion: 7,
    expectedManifestVersion: 5,
    lines: [
      {
        shipmentLineId: '55555555-5555-4555-8555-555555555555',
        sourceLocationId: '66666666-6666-4666-8666-666666666666',
        expectedLineVersion: 4,
        shortQty: 1,
      },
    ],
    reason: 'inventory_shortage',
  };

  it('requires shipment reopen scope and forwards the exact actor/idempotency command', async () => {
    const shortPick = { report: jest.fn().mockResolvedValue({ operationId: 'operation-1' }) };
    const controller = new ShipmentShortPickController(shortPick as never);

    await controller.report(shipmentId, dto, 'short-pick-key', {
      userId: '77777777-7777-4777-8777-777777777777',
      roles: ['logistics_manager'],
    });

    expect(Reflect.getMetadata(REQUIRED_SCOPES_KEY, ShipmentShortPickController.prototype.report)).toEqual([
      FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
    ]);
    expect(shortPick.report).toHaveBeenCalledWith(shipmentId, dto, 'short-pick-key', {
      id: '77777777-7777-4777-8777-777777777777',
      roles: ['logistics_manager'],
    });
  });

  it('rejects a missing or non-visible idempotency key before invoking the saga', () => {
    const shortPick = { report: jest.fn() };
    const controller = new ShipmentShortPickController(shortPick as never);
    expect(() => controller.report(shipmentId, dto, 'bad key', { id: shipmentId, roles: ['master'] })).toThrow(
      'visible ASCII Idempotency-Key',
    );
    expect(shortPick.report).not.toHaveBeenCalled();
  });
});
