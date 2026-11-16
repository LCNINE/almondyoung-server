import type { ApiClient } from '../../core/data/httpClient';
import { WorkBlockedError } from '../../core/operations/operationStore';
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

/**
 * 러너가 보내기 전에 막았다 — 같은 상자(상자 더하기는 같은 선적)에 결과가 나지 않은 다른 쓰기가 남아 있다(`store.begin`).
 * 서버에 아무것도 가지 않았으니 «결과 모름» 이 아니다: 잠그지 않고 `error.message`(«처리 여부를 먼저 확인해 주세요.»)를 보인다.
 * `isUncertainWrite` 는 이것도 참으로 본다(반품 화면이 쓰는 판정이라 그대로 둔다) — 선적 화면은 이 판정을 먼저 한다.
 */
export function isBlockedWrite(error: unknown): error is WorkBlockedError {
  return error instanceof WorkBlockedError;
}

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
