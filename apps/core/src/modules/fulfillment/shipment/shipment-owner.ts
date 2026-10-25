import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '@app/shared';

/**
 * 상자의 주인 — 우리 창고가 싸는 상자이거나, 입점사가 싸서 보내는 상자다(K3, 스펙 §4.1).
 * 판별자는 `shipments.warehouse_id`·`supplier_id` 둘뿐이고 CHECK(`ck_shipments_owner`)가 정확히 하나를 지킨다 —
 * FO 의 `fulfillment_mode` 나 SKU `stock_type` 으로 판별하지 않는다.
 */
export type ShipmentOwner = { kind: 'warehouse'; warehouseId: string } | { kind: 'supplier'; supplierId: string };

/** 창고 흐름(예약·계획·피킹·배치·합배송·채번·발송·원장)에 입점사 상자가 들어왔다. 반목표(스펙 §2)라 409 로 거절한다. */
export class SupplierShipmentInWarehouseFlowError extends ApplicationException {
  getErrorCode(): string {
    return 'SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW';
  }
  getHttpStatus(): number {
    return HttpStatus.CONFLICT;
  }
}

export function shipmentOwnerOf(row: {
  id: string;
  warehouseId: string | null;
  supplierId: string | null;
}): ShipmentOwner {
  if (row.warehouseId !== null && row.supplierId === null) return { kind: 'warehouse', warehouseId: row.warehouseId };
  if (row.warehouseId === null && row.supplierId !== null) return { kind: 'supplier', supplierId: row.supplierId };
  throw new Error(`Shipment ${row.id} must have exactly one of warehouse_id and supplier_id`);
}

/**
 * 창고 흐름의 진입점이 부른다 — 창고 id 가 필요한 곳은 이것으로만 좁힌다. warehouse_id 가 NULL 이면 CHECK 상 입점사 상자다.
 * 진입 함수 목록은 `supplier-shipment-entry.guard.spec.ts` 가 지킨다.
 */
export function warehouseIdOf(row: { id: string; warehouseId: string | null }): string {
  if (row.warehouseId === null) {
    throw new SupplierShipmentInWarehouseFlowError(
      `Shipment ${row.id} is a supplier shipment; warehouse flow refuses it`,
    );
  }
  return row.warehouseId;
}

export function ownerColumns(owner: ShipmentOwner): { warehouseId: string | null; supplierId: string | null } {
  return owner.kind === 'warehouse'
    ? { warehouseId: owner.warehouseId, supplierId: null }
    : { warehouseId: null, supplierId: owner.supplierId };
}
