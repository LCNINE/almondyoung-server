/** GET /inbound/pending 의 items[] 한 행. */
export interface PendingPlanItem {
  planItemId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  expectedQty: number;
  receivedQty: number;
  pendingQty: number;
}

/** GET /inbound/pending 의 pendingPlans[] 한 행 중 현장에서 쓰는 필드만. */
export interface PendingPlan {
  planId: string;
  warehouseId: string;
  /** ISO 문자열. 서버는 Date 로 두지만 JSON 을 건너오며 문자열이 된다. */
  expectedDate: string | null;
  purchaseOrder: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: { id: string; name: string } | null;
  };
  items: PendingPlanItem[];
  totalQuantity: number;
  totalPendingQuantity: number;
}

export interface PendingPlanListResult {
  totalPendingPlans: number;
  totalPendingQuantity: number;
  pendingPlans: PendingPlan[];
}

export interface ReceiveFromPlanInput {
  planItemId: string;
  quantity: number;
  memo?: string;
  idempotencyKey: string;
}

export interface ReceiveFromPlanResult {
  success: boolean;
  receiptId: string;
  lineId: string;
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
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  quantity: number;
  putawayDone: boolean;
}
