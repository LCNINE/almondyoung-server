// 선적 입고 — core inbound-shipment-view.dto.ts 응답 모양. 날짜는 JSON 으로 오므로 string.
import type { ShipmentListRow } from '@/features/inventory/inbound-shipments/lib/read-workbook';

export type InboundShipmentStatus = 'draft' | 'expected' | 'receiving' | 'closed' | 'canceled';

/** core 파서 `LineIssue` 15개 그대로. */
export type LineIssueCode =
  | 'box_label_guess'
  | 'box_label_missing'
  | 'box_range_invalid'
  | 'box_label_too_long'
  | 'qty_formula'
  | 'qty_invalid'
  | 'barcode_missing'
  | 'barcode_is_text'
  | 'foreign_code'
  | 'barcode_not_found'
  | 'barcode_ambiguous'
  | 'packing_unit_barcode'
  | 'option_date_coerced'
  | 'forward_hint'
  | 'contact_hint';

export interface InboundShipmentRawCell {
  text: string;
  value: string | number | boolean | null;
  formula?: string;
}

/** core 파서 `RAW_KEYS`. */
export type InboundShipmentRawKey =
  | 'boxLabel'
  | 'no'
  | 'productName'
  | 'quantity'
  | 'option'
  | 'barcode'
  | 'total'
  | 'remark';

export interface InboundShipmentSummary {
  id: string;
  warehouseId: string;
  status: InboundShipmentStatus;
  name: string;
  expectedArrival: string | null;
  boxCount: number;
  lineCount: number;
  createdAt: string;
}

export interface InboundShipmentBox {
  id: string;
  label: string;
  sortKey: number;
  origin: 'list' | 'added';
  disposition: 'stock' | 'forward';
  forwardNote: string | null;
  status: 'open' | 'received';
  receivedAt: string | null;
  countedQty: number;
}

export interface InboundShipmentAiCandidate {
  skuId: string;
  reason: string;
  code: string | null;
  name: string | null;
}

export interface InboundShipmentBarcodeCandidate {
  skuId: string;
  code: string;
  name: string;
}

export interface InboundShipmentLineDifference {
  state: 'pending' | 'not_arrived' | 'match' | 'short' | 'over';
  counted: number;
  expected: number | null;
}

export interface InboundShipmentLine {
  id: string;
  rowNumber: number;
  kind: 'sku' | 'free' | 'unresolved';
  skuId: string | null;
  sku: { code: string; name: string } | null;
  expectedQty: number | null;
  resolution: 'barcode' | 'manual' | null;
  issues: LineIssueCode[];
  coversBoxLabels: string[];
  aiCandidates: InboundShipmentAiCandidate[] | null;
  barcodeCandidates: InboundShipmentBarcodeCandidate[];
  raw: Partial<Record<InboundShipmentRawKey, InboundShipmentRawCell | null>>;
  countedQty: number;
  difference: InboundShipmentLineDifference;
}

export interface InboundShipmentDifferenceSummary {
  boxesReceived: number;
  boxesTotalStock: number;
  forwardBoxes: number;
  addedBoxes: number;
  shortLines: number;
  overLines: number;
  notArrivedLines: number;
  unplannedCounts: number;
}

export interface InboundShipmentUnplannedItem {
  boxId: string;
  boxLabel: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  countedQty: number;
}

export interface InboundShipmentDetail extends InboundShipmentSummary {
  sourceFileId: string | null;
  sourceFileName: string | null;
  memo: string | null;
  closedReason: string | null;
  closedAt: string | null;
  boxes: InboundShipmentBox[];
  lines: InboundShipmentLine[];
  summary: InboundShipmentDifferenceSummary;
  unplannedItems: InboundShipmentUnplannedItem[];
}

// ── 요청 본문 (core dto/upload.dto.ts · draft-edit.dto.ts 와 같은 모양)

export interface UploadInboundShipmentBody {
  warehouseId: string;
  name: string;
  /** YYYY-MM-DD */
  expectedArrival?: string;
  sourceFileId?: string;
  sourceFileName: string;
  header: string[];
  rows: ShipmentListRow[];
}

export interface UpdateInboundShipmentHeaderBody {
  name?: string;
  expectedArrival?: string | null;
  memo?: string | null;
}

export interface EditInboundShipmentLineBody {
  kind?: 'sku' | 'free';
  skuId?: string;
  expectedQty?: number;
  boxLabels?: string[];
}

export interface EditInboundShipmentBoxBody {
  disposition?: 'stock' | 'forward';
  forwardNote?: string | null;
  label?: string;
}

export interface ConfirmInboundShipmentBody {
  acknowledgedForwardBoxIds: string[];
}

export interface InboundShipmentListFilter {
  status?: InboundShipmentStatus[];
  warehouseId?: string;
}
