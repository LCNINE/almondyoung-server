/** core `inbound-shipment/dto/receive.dto.ts`·`inbound-shipment-view.dto.ts` 를 그대로 옮긴 것. 날짜는 HTTP 로 ISO 문자열이다. */
export type ShipmentStatus =
  | 'draft'
  | 'expected'
  | 'receiving'
  | 'closed'
  | 'canceled';

export interface BoxCandidate {
  shipmentId: string;
  shipmentName: string;
  expectedArrival: string | null;
  boxId: string;
  label: string;
  disposition: 'stock' | 'forward';
  status: 'open' | 'received';
  shipmentStatus: 'expected' | 'receiving' | 'closed';
  previewItems: string[];
}

export interface BoxLine {
  lineId: string;
  kind: 'sku' | 'free' | 'unresolved';
  skuId: string | null;
  sku: { code: string; name: string } | null;
  productName: string;
  option: string;
  expectedQty: number | null;
  coversBoxLabels: string[];
  alreadyCountedInOtherBoxes: number;
  remark: string;
}

export interface BoxCount {
  id: string;
  lineId: string | null;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  countedQty: number;
  method: 'counted' | 'list';
}

export interface BoxView {
  shipmentId: string;
  shipmentName: string;
  shipmentStatus: ShipmentStatus;
  expectedArrival: string | null;
  boxId: string;
  label: string;
  origin: 'list' | 'added';
  disposition: 'stock' | 'forward';
  status: 'open' | 'received';
  forwardNote: string | null;
  receiptId: string | null;
  receivedAt: string | null;
  lines: BoxLine[];
  counts: BoxCount[];
}

export interface ShipmentSummary {
  id: string;
  warehouseId: string;
  status: ShipmentStatus;
  name: string;
  expectedArrival: string | null;
  boxCount: number;
  lineCount: number;
  createdAt: string;
  closedAt: string | null;
  closedManually: boolean;
}

export interface ReceiveBoxBody {
  counts: { lineId: string; countedQty: number; method: 'counted' | 'list' }[];
  unplanned: { skuId: string; quantity: number }[];
}

export interface ReceiveBoxResult {
  boxId: string;
  receiptId: string | null;
  shipmentStatus: ShipmentStatus;
  countIds: string[];
}

export interface CancelBoxReceiptResult {
  boxId: string;
  shipmentStatus: ShipmentStatus;
  canceledCountIds: string[];
}

export interface AddBoxResult {
  boxId: string;
  label: string;
  shipmentStatus: ShipmentStatus;
}
