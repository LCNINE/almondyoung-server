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
