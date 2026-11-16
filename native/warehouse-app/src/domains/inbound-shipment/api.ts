import type { ApiClient } from '../../core/data/httpClient';
import type {
  AddBoxResult,
  BoxCandidate,
  BoxView,
  CancelBoxReceiptResult,
  ReceiveBoxBody,
  ReceiveBoxResult,
  ShipmentSummary,
} from './types';

export { isUncertainWrite } from '../customer-returns/api';

const enc = encodeURIComponent;
const shipmentPath = (shipmentId: string) =>
  `/inventory/inbound-shipments/${enc(shipmentId)}`;

/** 상자 이름은 친 그대로 보낸다 — 정규화는 서버 몫이다. */
export function findBoxes(
  api: ApiClient,
  warehouseId: string,
  label: string
): Promise<BoxCandidate[]> {
  return api.request<BoxCandidate[]>({
    path: `/inventory/inbound-shipment-boxes?warehouseId=${enc(warehouseId)}&label=${enc(label)}`,
  });
}

export function openBox(
  api: ApiClient,
  shipmentId: string,
  boxId: string
): Promise<BoxView> {
  return api.request<BoxView>({
    path: `${shipmentPath(shipmentId)}/boxes/${enc(boxId)}`,
  });
}

export function listShipments(
  api: ApiClient,
  warehouseId: string,
  statuses: ('expected' | 'receiving' | 'closed')[]
): Promise<ShipmentSummary[]> {
  return api.request<ShipmentSummary[]>({
    path: `/inventory/inbound-shipments?warehouseId=${enc(warehouseId)}&status=${enc(statuses.join(','))}`,
  });
}

export function receiveBox(
  api: ApiClient,
  shipmentId: string,
  boxId: string,
  body: ReceiveBoxBody,
  idempotencyKey: string
): Promise<ReceiveBoxResult> {
  return api.request<ReceiveBoxResult>({
    method: 'POST',
    path: `${shipmentPath(shipmentId)}/boxes/${enc(boxId)}/receive`,
    body,
    idempotencyKey,
  });
}

export function cancelBoxReceipt(
  api: ApiClient,
  shipmentId: string,
  boxId: string,
  idempotencyKey: string
): Promise<CancelBoxReceiptResult> {
  return api.request<CancelBoxReceiptResult>({
    method: 'POST',
    path: `${shipmentPath(shipmentId)}/boxes/${enc(boxId)}/receive/cancel`,
    body: {},
    idempotencyKey,
  });
}

export function addBox(
  api: ApiClient,
  shipmentId: string,
  label: string,
  idempotencyKey: string
): Promise<AddBoxResult> {
  return api.request<AddBoxResult>({
    method: 'POST',
    path: `${shipmentPath(shipmentId)}/boxes`,
    body: { label },
    idempotencyKey,
  });
}
