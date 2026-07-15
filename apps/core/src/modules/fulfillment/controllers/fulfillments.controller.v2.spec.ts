import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { FulfillmentsController } from './fulfillments.controller';

describe('FulfillmentsController V2 admin contract', () => {
  it('reads all shipments for an FO and uses durable transfer when idempotency is provided', async () => {
    const reservations = { transferReservationCommand: jest.fn().mockResolvedValue({ operationId: 'operation-1' }) };
    const shipmentPlanning = { getFulfillmentShipments: jest.fn().mockResolvedValue([{ id: 'shipment-1' }]) };
    const controller = new FulfillmentsController({} as never, reservations as never, shipmentPlanning as never);
    const dto = {
      fromFulfillmentOrderItemId: 'from-foi',
      toFulfillmentOrderItemId: 'to-foi',
      quantity: 2,
      reason: 'rebalance backorder',
      csCaseId: '11111111-1111-4111-8111-111111111111',
      note: 'planner approved',
    };

    await controller.shipments('fo-1');
    await controller.transfer('fo-1', dto, 'transfer-key', { userId: 'operator-1' });

    expect(shipmentPlanning.getFulfillmentShipments).toHaveBeenCalledWith('fo-1');
    expect(reservations.transferReservationCommand).toHaveBeenCalledWith(
      'fo-1',
      { ...dto, performedBy: 'operator-1' },
      'transfer-key',
    );
  });

  it.each(['reserve', 'unreserve', 'shipments'] as const)(
    'requires warehouse operate scope for %s',
    (methodName) => {
      const method = Object.getOwnPropertyDescriptor(FulfillmentsController.prototype, methodName)?.value as object;
      expect(Reflect.getMetadata('required_scopes', method)).toEqual([FULFILLMENT_SCOPE.WAREHOUSE_OPERATE]);
    },
  );

  it.each(['transfer', 'getTransferCandidates'] as const)(
    'requires reservation transfer scope for %s',
    (methodName) => {
      const method = Object.getOwnPropertyDescriptor(FulfillmentsController.prototype, methodName)?.value as object;
      expect(Reflect.getMetadata('required_scopes', method)).toEqual([FULFILLMENT_SCOPE.RESERVATION_TRANSFER]);
    },
  );

  it('rejects reservation transfer without an idempotency key', () => {
    const controller = new FulfillmentsController({} as never, {} as never, {} as never);
    expect(() =>
      controller.transfer(
        'fo-1',
        {
          fromFulfillmentOrderItemId: 'from-foi',
          toFulfillmentOrderItemId: 'to-foi',
          quantity: 1,
        },
        undefined,
        { userId: 'operator-1' },
      ),
    ).toThrow(/Idempotency-Key is required/);
  });
});
