/** core `CustomerReturnView`·`CustomerReturnReceivingItem` 의 손 미러 — 화면이 쓰는 칸만. */

export interface ReturnItem {
  id: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  qtyPerUnit: number;
  expectedQty: number;
  arrivedQty: number;
  acceptedQty: number | null;
  rejectedQty: number | null;
  heldQty: number | null;
  /** 주 바코드 먼저, 그다음 오름차순. */
  barcodes: string[];
  /** 대표 선반(sku_shelf_positions). 정해지지 않았으면 null */
  shelfCode: string | null;
}

export interface ReturnLine {
  id: string;
  productName: string;
  quantity: number;
  missingQty: number;
  items: ReturnItem[];
}

export interface ReturnView {
  id: string;
  reason: string;
  feeBearer: string;
  note: string | null;
  status: string;
  order: { orderNo: string };
  warehouseId: string | null;
  csResolution: { missing?: unknown } | null;
  lines: ReturnLine[];
}

export interface ReceivingItem {
  id: string;
  orderNo: string;
  customerMasked: string;
  reason: string;
  productSummary: string;
  expectedQty: number;
  arrivedQty: number;
  stage: 'awaiting' | 'partial' | 'ready';
  requestedAt: string;
}

export interface ReceivingPage {
  items: ReceivingItem[];
  total: number;
}
