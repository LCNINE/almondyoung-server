import { REQUIRED_PERMISSIONS_KEY } from '@app/authorization';
import { FulfillmentsController } from './fulfillments.controller';

describe('FulfillmentsController V2 admin contract', () => {
  it('reads all shipments for an FO', async () => {
    const shipmentPlanning = { getFulfillmentShipments: jest.fn().mockResolvedValue([{ id: 'shipment-1' }]) };
    const controller = new FulfillmentsController({} as never, shipmentPlanning as never);

    await controller.shipments('fo-1');

    expect(shipmentPlanning.getFulfillmentShipments).toHaveBeenCalledWith('fo-1');
  });

  it.each(['shipments'] as const)('requires the shipment read permission for %s', (methodName) => {
    const method = Object.getOwnPropertyDescriptor(FulfillmentsController.prototype, methodName)?.value as object;
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method)).toEqual(['fulfillment.shipment.read']);
  });
});
