import type { ReceiptActionBlockReason } from './receiptState';
export interface ExpectedArrivalLine {
  skuId: string;
  skuName: string;
  skuCode: string;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  expectedArrival: string | null;
}

export interface ExpectedArrival {
  source: 'purchase_order';
  documentId: string;
  type: 'domestic' | 'foreign';
  supplier: { id: string; name: string } | null;
  expectedDate: string | null;
  totalOutstandingQuantity: number;
  lines: ExpectedArrivalLine[];
}

export interface ExpectedArrivalsResult {
  warehouseId: string;
  totalDocuments: number;
  totalOutstandingQuantity: number;
  arrivals: ExpectedArrival[];
}

export interface ReceivePurchaseOrderInput {
  poId: string;
  warehouseId: string;
  lines: Array<{ skuId: string; quantity: number; memo?: string }>;
  idempotencyKey: string;
}

export interface ReceivePurchaseOrderResult {
  receiptId: string;
  poId: string;
  lines: Array<{ receiptLineId: string; skuId: string; quantity: number }>;
}

export interface CancelPurchaseOrderReceiptInput {
  receiptLineId: string;
  idempotencyKey: string;
}

export interface CancelPurchaseOrderReceiptResult {
  poId: string;
  skuId: string;
  quantity: number;
  receiptLineId: string;
}

export interface SimpleInboundInput {
  warehouseId: string;
  items: Array<{ skuId: string; quantity: number; memo?: string }>;
  idempotencyKey: string;
}

/** SimpleInboundResponseDto 의 lines[] 한 행 중 적치에 필요한 필드만. */
export interface SimpleInboundLine {
  id: string;
  skuId: string;
  quantity: number;
}

/** SimpleInboundResponseDto — 회차 헤더 필드는 id 로 온다(receiptId 아님). */
export interface SimpleInboundResult {
  id: string;
  lines: SimpleInboundLine[];
}

export interface PutawayInput {
  lineId: string;
  toLocationId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface CancelInboundInput {
  lineId: string;
  quantity: number;
  idempotencyKey: string;
}

/** 입고 직후 화면에 남는 "방금 만든 라인" — 적치·취소의 대상. */
export interface FreshLine {
  canceledQty?: number;
  returnedQty?: number;
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  quantity: number;
  /**
   * 지금까지 적치한 누계. boolean 이 아닌 이유는 부분 적치가 가능해졌기 때문이다 —
   * 50개 중 30개만 적치한 라인에 다시 50개를 제안하면 서버가 400 을 낸다.
   */
  putawayDoneQty: number;
}

/** GET /inbound/putaway/pending 의 items[] 한 행. */
export interface PutawayPendingItem {
  source: 'direct' | 'purchase_order';
  canPutaway: boolean;
  putawayBlockReason: ReceiptActionBlockReason | null;
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationId: string | null;
  originLocationCode: string | null;
  /** ISO 문자열. */
  receivedAt: string;
}

export interface PutawayPendingResult {
  /** Opaque continuation token. Absent only on older servers. */
  nextCursor?: string | null;
  total: number;
  /** LIMIT(200)에 걸려 잘렸는지 여부. true 면 백로그가 더 있다. */
  truncated: boolean;
  items: PutawayPendingItem[];
}

/** Actionable sheet snapshot; the detail read revalidates it before submission. */
export interface PutawayTarget {
  lineId: string;
  source: 'direct' | 'purchase_order';
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationCode: string;
  originLocationId: string;
}

/** Only an explicit server policy and identifiable origin can open a sheet. */
export function isActionablePutaway(
  item: PutawayPendingItem
): item is PutawayPendingItem & PutawayTarget {
  return (
    item.canPutaway === true &&
    item.putawayBlockReason === null &&
    (item.source === 'direct' || item.source === 'purchase_order') &&
    typeof item.originLocationId === 'string' &&
    item.originLocationId.length > 0 &&
    typeof item.originLocationCode === 'string' &&
    item.originLocationCode.length > 0 &&
    Number.isSafeInteger(item.pendingQty) &&
    item.pendingQty > 0
  );
}
