import type { Permission } from '@app/authorization';

/** 출고 판정 지점·강제출고 낙인이 쓰는 권한 키. */
export const FULFILLMENT_PERMISSION = {
  WAREHOUSE_OPERATE: 'fulfillment.warehouse.operate',
  SHIPMENT_CONSOLIDATE: 'fulfillment.shipment.consolidate',
  SHIPMENT_OVERRIDE_RECIPIENT: 'fulfillment.shipment.override_recipient',
  RESERVATION_TRANSFER: 'fulfillment.reservation.transfer',
  DISPATCH_FORCE: 'fulfillment.dispatch.force',
  DISPATCH_RECALL: 'fulfillment.dispatch.recall',
  SHIPMENT_REOPEN: 'fulfillment.shipment.reopen',
  TRACKING_INGEST: 'fulfillment.tracking.ingest',
  SHIPMENT_SHORT_PICK: 'fulfillment.shipment.short_pick',
  DISPATCH_STATION_FORCE: 'fulfillment.dispatch.station_force',
} as const satisfies Record<string, Permission>;

export type FulfillmentPermission = (typeof FULFILLMENT_PERMISSION)[keyof typeof FULFILLMENT_PERMISSION];

/** 결품 보고: 관리자(reopen) 또는 스테이션 작업자(short_pick) — 하나라도. */
export const SHORT_PICK_REPORT_PERMISSIONS: readonly FulfillmentPermission[] = [
  FULFILLMENT_PERMISSION.SHIPMENT_REOPEN,
  FULFILLMENT_PERMISSION.SHIPMENT_SHORT_PICK,
];

/** 단순출고 강제완료: 관리자(dispatch.force) 또는 스테이션 작업자(station_force) — 하나라도. 관리자 판정이 앞선다. */
export const SIMPLE_OUTBOUND_FORCE_PERMISSIONS: readonly FulfillmentPermission[] = [
  FULFILLMENT_PERMISSION.DISPATCH_FORCE,
  FULFILLMENT_PERMISSION.DISPATCH_STATION_FORCE,
];
