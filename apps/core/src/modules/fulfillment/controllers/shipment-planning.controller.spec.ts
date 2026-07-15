import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { FulfillmentOperationController, ShipmentPlanningController } from './shipment-planning.controller';

describe('Shipment planning read contract', () => {
  it('returns typed shipment detail and generic durable operation state', async () => {
    const planning = {
      getShipmentDetail: jest.fn().mockResolvedValue({
        id: 'shipment-1',
        lines: [{ id: 'line-1', reservedQty: 2, inspectedQty: 1, lineVersion: 3 }],
        invoices: [],
        dispatchAttempts: [],
        operations: [{ operationId: 'operation-1', status: 'recovery_required', lastError: 'provider timeout' }],
      }),
      getOperation: jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        type: 'recall',
        status: 'recovery_required',
        lastError: 'provider timeout',
      }),
    };
    const shipmentController = new ShipmentPlanningController(planning as never);
    const operationController = new FulfillmentOperationController(planning as never);

    await expect(shipmentController.detail('shipment-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'shipment-1',
        operations: [expect.objectContaining({ lastError: 'provider timeout' })],
      }),
    );
    await expect(operationController.get('operation-1')).resolves.toEqual(
      expect.objectContaining({ operationId: 'operation-1', status: 'recovery_required' }),
    );
    expect(planning.getShipmentDetail).toHaveBeenCalledWith('shipment-1');
    expect(planning.getOperation).toHaveBeenCalledWith('operation-1');
  });

  it('requires warehouse operate scope on both read surfaces', () => {
    const detail = Object.getOwnPropertyDescriptor(ShipmentPlanningController.prototype, 'detail')?.value as object;
    const operation = Object.getOwnPropertyDescriptor(FulfillmentOperationController.prototype, 'get')?.value as object;
    expect(Reflect.getMetadata('required_scopes', detail)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    expect(Reflect.getMetadata('required_scopes', operation)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
  });

  it('requires the exact recipient override scope for recipient changes', () => {
    const recipient = Object.getOwnPropertyDescriptor(
      ShipmentPlanningController.prototype,
      'reviseRecipient',
    )?.value as object;
    expect(Reflect.getMetadata('required_scopes', recipient)).toEqual([
      FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
    ]);
  });
});
