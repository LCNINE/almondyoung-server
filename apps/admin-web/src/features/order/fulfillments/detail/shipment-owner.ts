export function orderShipments<T extends { status: string }>(
  shipments: readonly T[]
): { active: T[]; retired: T[] } {
  return {
    active: shipments.filter((shipment) => shipment.status !== 'superseded'),
    retired: shipments.filter((shipment) => shipment.status === 'superseded'),
  };
}

export type ShipmentAction = 'split' | 'recipient' | 'plan' | 'recall';

const ALL_ACTIONS: readonly ShipmentAction[] = [
  'split',
  'recipient',
  'plan',
  'recall',
];

/**
 * 입점사 상자는 되돌리기만 연다 — 나누기 부분 이동은 서버가 409, 계획은 창고 흐름 가드가
 * 던지고, 수령인을 넘긴 뒤 바꾸면 입점사 시트와 갈린다. 창고/입점사는 `supplierId` 만으로 가른다.
 * 나누기·수령인 변경·계획 확정은 서버가 계획 전(draft) 상자만 받는다.
 */
export function shipmentActionsFor(shipment: {
  supplierId: string | null;
  status: string;
}): readonly ShipmentAction[] {
  if (shipment.supplierId || shipment.status !== 'draft') return ['recall'];
  return ALL_ACTIONS;
}

/**
 * 운송장 발급·수기 등록·재발급·무효는 창고 상자만 — 입점사 상자는 입점사가 송장을 붙이고 서버가 전부
 * 409 `SUPPLIER_SHIPMENT_IN_WAREHOUSE_FLOW` 로 거절한다.
 */
export function showsWaybillActions(shipment: {
  supplierId: string | null;
}): boolean {
  return !shipment.supplierId;
}

export function recallConfirmText(isSupplier: boolean): string {
  return isSupplier
    ? '입점사와 확인했습니다 — 이 송장은 잘못 반영되었거나 아직 보내지 않았습니다.'
    : '고른 출고의 상자를 창고에서 실제로 돌려받았어요.';
}

export function ownerLabel(
  shipment: { supplierId: string | null; warehouseId: string | null },
  supplierName: string | undefined
): string {
  if (shipment.supplierId) {
    return supplierName ? `입점사 직배 · ${supplierName}` : '입점사 직배';
  }
  return '창고 출고';
}
