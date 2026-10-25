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
 */
export function shipmentActionsFor(shipment: {
  supplierId: string | null;
}): readonly ShipmentAction[] {
  return shipment.supplierId ? ['recall'] : ALL_ACTIONS;
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
    : '선택한 출고 시도의 실물 패키지가 창고에 회수되었음을 확인합니다.';
}

function short(value: string | null | undefined): string {
  return value ? `${value.slice(0, 8)}…` : '-';
}

export function ownerLabel(
  shipment: { supplierId: string | null; warehouseId: string | null },
  supplierName: string | undefined
): string {
  if (shipment.supplierId) {
    return `입점사 ${supplierName ?? short(shipment.supplierId)}`;
  }
  return `창고 ${short(shipment.warehouseId)}`;
}
