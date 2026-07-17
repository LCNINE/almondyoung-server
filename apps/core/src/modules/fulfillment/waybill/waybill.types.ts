import type { Waybill } from '../../inventory/schema/inventory.schema';

export type WaybillRow = Waybill;

// recipientSnapshot(AddressDto) 의 안전한 부분집합. 발급 시점 assertRecipientComplete 로 5필드 보장.
export interface WaybillRecipient {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
}

export interface ManifestLineLite {
  productName: string;
  quantity: number;
  skuId: string;
}

// Reader.loadIssueContext 반환 — 발급 조립에 필요한 최소 컨텍스트.
export interface IssueContext {
  shipmentId: string;
  status: string; // shipments.status
  manifestVersion: number;
  recipientSnapshot: unknown; // 원본(해시 대상)
  lines: ManifestLineLite[];
}

// WaybillManager.issueBatch 개별 결과. status 는 issueForShipment 가 반환한 WaybillRow.status(registered/failed 등)
// 또는 시간예산 초과/미착수를 나타내는 'pending' 이다 — reason 에 항상 사유가 남는다(silent truncation 금지).
export interface BatchResultItem {
  shipmentId: string;
  status: string;
  trackingNo: string | null;
  reason: string | null;
}

// 컨트롤러/서비스 응답.
export interface WaybillView {
  id: string;
  shipmentId: string;
  source: 'carrier' | 'manual';
  carrier: string;
  status: string;
  trackingNo: string | null;
  custOrdNo: string | null;
  manifestVersion: number;
  issuedAt: string | null;
  voidedAt: string | null;
  lastError: string | null;
}
