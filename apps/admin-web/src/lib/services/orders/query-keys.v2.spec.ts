import { orderQueryKeys } from './query-keys';

describe('fulfillment V2 query keys', () => {
  it('keeps FO shipments, shipment detail, and durable operations isolated', () => {
    expect(orderQueryKeys.fulfillmentShipments('fo-1')).toEqual([
      'fulfillments',
      'fo-1',
      'shipments',
    ]);
    expect(orderQueryKeys.shipment('shipment-1')).toEqual([
      'shipments',
      'shipment-1',
    ]);
    expect(orderQueryKeys.fulfillmentOperation('operation-1')).not.toEqual(
      orderQueryKeys.invoiceOperation('operation-1')
    );
    expect(orderQueryKeys.invoiceOperation('operation-1')).not.toEqual(
      orderQueryKeys.shipmentRecallOperation('operation-1')
    );
  });

  it('includes V2 batch filters and consolidation source in cache identity', () => {
    expect(
      orderQueryKeys.outboundBatchesV2({ warehouseId: 'warehouse-1' })
    ).not.toEqual(
      orderQueryKeys.outboundBatchesV2({ warehouseId: 'warehouse-2' })
    );
    expect(
      orderQueryKeys.shipmentConsolidationCandidates({
        warehouseId: 'warehouse-1',
        sourceShipmentId: 'shipment-1',
      })
    ).toEqual([
      'shipments',
      'consolidation-candidates',
      { warehouseId: 'warehouse-1', sourceShipmentId: 'shipment-1' },
    ]);
  });
});
