'use client';

// 한 주문만 공급처가 고객에게 바로 보낸다 — 맡기기·송장 입력·창고로 되돌리기

import { ALMONDYOUNG_API_BASE_URL } from '@/const';
import type { SupplierSheetCarrier } from '@/lib/types/dto/fulfillment';
import { client } from '../../client';

export type DirectDeliveryBlockerCode =
  | 'not_draft'
  | 'recovery'
  | 'active_waybill'
  | 'active_work'
  | 'drop_shipped'
  | 'sellmate_handed_over'
  | 'recipient_incomplete'
  | 'no_warehouse';

export interface DirectDeliveryBlocker {
  code: DirectDeliveryBlockerCode;
  batchId?: string | null;
  batchNo?: string | null;
}

export interface DirectDeliveryLine {
  lineId: string;
  skuId: string;
  skuName: string;
  qty: number;
  reservedQty: number;
  linkedSupplierId: string | null;
}

export interface DirectDeliveryRecipient {
  name: string;
  phone: string;
  address: string;
  memo: string;
  entrancePassword: string;
}

export interface DirectDeliveryPreview {
  shipmentId: string;
  owner: 'warehouse' | 'supplier';
  status: string;
  manifestVersion: number;
  supplierId: string | null;
  handedOff: boolean;
  salesOrderId: string;
  fulfillmentOrderId: string;
  orderNo: string | null;
  lines: DirectDeliveryLine[];
  suggestedSupplierId: string | null;
  suppliers: Array<{ id: string; name: string }>;
  recipient: DirectDeliveryRecipient | null;
  blockers: DirectDeliveryBlocker[];
  /** 송장 입력을 막는 것 — 공급처 상자만, 창고 상자는 빈 목록 */
  dispatchBlockers: DirectDeliveryBlocker[];
}

export interface DirectDeliveryAwaitingItem {
  shipmentId: string;
  manifestVersion: number;
  salesOrderId: string;
  fulfillmentOrderId: string;
  orderNo: string | null;
  supplierId: string;
  supplierName: string;
  handedOffAt: string;
  handedOffBy: string | null;
  firstSkuName: string;
  lineCount: number;
  totalQty: number;
}

export interface DirectDeliveryReasonFields {
  reason: string;
  reasonCode?: string;
  requestChannel?: string;
  note?: string;
}

export interface DirectDeliveryTracking {
  carrier: SupplierSheetCarrier;
  trackingNo: string;
}

export interface DirectDeliveryDispatchRequest extends DirectDeliveryTracking {
  expectedManifestVersion: number;
}

export interface DirectDeliveryTakeoverRequest extends DirectDeliveryReasonFields {
  supplierId: string;
  expectedManifestVersion: number;
  carrier?: SupplierSheetCarrier;
  trackingNo?: string;
}

export interface DirectDeliveryReturnRequest extends DirectDeliveryReasonFields {
  expectedManifestVersion: number;
}

export interface DirectDeliveryTakeoverResult {
  shipmentId: string;
  previousShipmentId: string;
  releasedQty: number;
  dispatched: boolean;
  operationId: string;
}

export interface DirectDeliveryDispatchResult {
  shipmentId: string;
  waybillId: string;
  handedOffNow: boolean;
}

export interface DirectDeliveryReturnResult {
  shipmentId: string;
  previousShipmentId: string;
  wasHandedOff: boolean;
  operationId: string;
}

// 주소는 상수째 적는다 — 개인정보 경로 게이트가 이 문자열로 화면이 닿는 경로를 읽는다
const shipmentPath = (id: string) =>
  `${ALMONDYOUNG_API_BASE_URL}/direct-delivery/shipments/${encodeURIComponent(id)}`;
const withKey = (idempotencyKey: string) => ({
  headers: { 'Idempotency-Key': idempotencyKey },
});

export const directDeliveryClient = {
  preview: async (shipmentId: string): Promise<DirectDeliveryPreview> =>
    (await client.get(shipmentPath(shipmentId))).data,

  awaitingTracking: async (
    warehouseId: string
  ): Promise<{ items: DirectDeliveryAwaitingItem[] }> =>
    (
      await client.get(
        `${ALMONDYOUNG_API_BASE_URL}/direct-delivery/awaiting-tracking`,
        {
          params: { warehouseId },
        }
      )
    ).data,

  takeover: async (
    shipmentId: string,
    data: DirectDeliveryTakeoverRequest,
    idempotencyKey: string
  ): Promise<DirectDeliveryTakeoverResult> =>
    (
      await client.post(
        `${shipmentPath(shipmentId)}/takeover`,
        data,
        withKey(idempotencyKey)
      )
    ).data,

  dispatch: async (
    shipmentId: string,
    data: DirectDeliveryDispatchRequest,
    idempotencyKey: string
  ): Promise<DirectDeliveryDispatchResult> =>
    (
      await client.post(
        `${shipmentPath(shipmentId)}/dispatch`,
        data,
        withKey(idempotencyKey)
      )
    ).data,

  returnToWarehouse: async (
    shipmentId: string,
    data: DirectDeliveryReturnRequest,
    idempotencyKey: string
  ): Promise<DirectDeliveryReturnResult> =>
    (
      await client.post(
        `${shipmentPath(shipmentId)}/return`,
        data,
        withKey(idempotencyKey)
      )
    ).data,
};
