import { ownerColumns, shipmentOwnerOf, SupplierShipmentInWarehouseFlowError, warehouseIdOf } from './shipment-owner';

describe('shipment-owner', () => {
  it('창고 상자는 창고 id 를 돌려준다', () => {
    expect(warehouseIdOf({ id: 's1', warehouseId: 'w1' })).toBe('w1');
  });

  it('입점사 상자(warehouse_id NULL)가 창고 흐름에 오면 409 SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW', () => {
    let thrown: unknown;
    try {
      warehouseIdOf({ id: 's1', warehouseId: null });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SupplierShipmentInWarehouseFlowError);
    const error = thrown as SupplierShipmentInWarehouseFlowError;
    expect(error.getErrorCode()).toBe('SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW');
    expect(error.getHttpStatus()).toBe(409);
    expect(error.message).toContain('s1');
  });

  it('주인은 창고 또는 입점사 정확히 하나다', () => {
    expect(shipmentOwnerOf({ id: 's1', warehouseId: 'w1', supplierId: null })).toEqual({
      kind: 'warehouse',
      warehouseId: 'w1',
    });
    expect(shipmentOwnerOf({ id: 's1', warehouseId: null, supplierId: 'p1' })).toEqual({
      kind: 'supplier',
      supplierId: 'p1',
    });
    expect(() => shipmentOwnerOf({ id: 's1', warehouseId: 'w1', supplierId: 'p1' })).toThrow('s1');
    expect(() => shipmentOwnerOf({ id: 's1', warehouseId: null, supplierId: null })).toThrow('s1');
  });

  it('ownerColumns 는 주인을 칸 둘로 펼친다', () => {
    expect(ownerColumns({ kind: 'warehouse', warehouseId: 'w1' })).toEqual({ warehouseId: 'w1', supplierId: null });
    expect(ownerColumns({ kind: 'supplier', supplierId: 'p1' })).toEqual({ warehouseId: null, supplierId: 'p1' });
    const row = { id: 's1', ...ownerColumns({ kind: 'supplier', supplierId: 'p1' }) };
    expect(shipmentOwnerOf(row)).toEqual({ kind: 'supplier', supplierId: 'p1' });
  });
});
