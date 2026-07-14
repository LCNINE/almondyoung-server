import {
  PickByBarcodeSchema,
  PickIndividualItemSchema,
  PickItemSchema,
  PickingController,
  ScanBarcodeSchema,
} from './picking.controller';

describe('PickingController actor identity', () => {
  const batchId = '11111111-1111-4111-8111-111111111111';
  const skuId = '22222222-2222-4222-8222-222222222222';
  const warehouseId = '33333333-3333-4333-8333-333333333333';
  const fulfillmentOrderId = '44444444-4444-4444-8444-444444444444';

  it.each([
    [PickItemSchema, { batchId, skuId, pickedQty: 1, pickerUserId: 'forged-actor' }],
    [PickIndividualItemSchema, { pickedQty: 1, pickerUserId: 'forged-actor' }],
    [ScanBarcodeSchema, { barcode: 'SKU-1', warehouseId, pickerUserId: 'forged-actor' }],
    [PickByBarcodeSchema, { barcode: 'SKU-1', pickedQty: 1, warehouseId, pickerUserId: 'forged-actor' }],
  ])('strips pickerUserId from the validated self-operation body', (schema, body) => {
    expect(schema.parse(body)).not.toHaveProperty('pickerUserId');
  });

  it('passes the JWT actor to every picking service operation and ignores forged body identity', async () => {
    const pickingProcessService = {
      pickItem: jest.fn().mockResolvedValue(undefined),
      pickIndividualItem: jest.fn().mockResolvedValue(undefined),
      scanBarcode: jest.fn().mockResolvedValue({}),
      pickByBarcodeScan: jest.fn().mockResolvedValue({}),
    };
    const controller = new PickingController(pickingProcessService as never);
    const jwtUser = { id: 'jwt-picker' };

    await controller.pickItem({ batchId, skuId, pickedQty: 2, pickerUserId: 'forged-actor' } as never, jwtUser);
    await controller.pickIndividualItem(
      '55555555-5555-4555-8555-555555555555',
      { pickedQty: 3, pickerUserId: 'forged-actor' } as never,
      jwtUser,
    );
    await controller.scanBarcode(
      {
        barcode: 'SKU-1',
        fulfillmentOrderId,
        warehouseId,
        pickerUserId: 'forged-actor',
      } as never,
      jwtUser,
    );
    await controller.pickByBarcodeScan(
      {
        barcode: 'SKU-1',
        pickedQty: 4,
        batchId,
        warehouseId,
        pickerUserId: 'forged-actor',
      } as never,
      jwtUser,
    );

    expect(pickingProcessService.pickItem).toHaveBeenCalledWith({
      batchId,
      skuId,
      pickedQty: 2,
      pickerUserId: 'jwt-picker',
    });
    expect(pickingProcessService.pickIndividualItem).toHaveBeenCalledWith(
      '55555555-5555-4555-8555-555555555555',
      3,
      'jwt-picker',
    );
    expect(pickingProcessService.scanBarcode).toHaveBeenCalledWith('SKU-1', {
      batchId: undefined,
      fulfillmentOrderId,
      warehouseId,
      pickerUserId: 'jwt-picker',
    });
    expect(pickingProcessService.pickByBarcodeScan).toHaveBeenCalledWith('SKU-1', 4, {
      batchId,
      fulfillmentOrderId: undefined,
      warehouseId,
      pickerUserId: 'jwt-picker',
      locationCode: undefined,
    });
  });
});
