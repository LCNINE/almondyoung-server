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
  /**
   * 지금까지 적치한 누계. boolean 이 아닌 이유는 부분 적치가 가능해졌기 때문이다 —
   * 50개 중 30개만 적치한 라인에 다시 50개를 제안하면 서버가 400 을 낸다.
   */
  putawayDoneQty: number;
}

/** GET /inbound/putaway/pending 의 items[] 한 행. */
export interface PutawayPendingItem {
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationId: string;
  originLocationCode: string;
  /** ISO 문자열. */
  receivedAt: string;
}

export interface PutawayPendingResult {
  total: number;
  /** LIMIT(200)에 걸려 잘렸는지 여부. true 면 백로그가 더 있다. */
  truncated: boolean;
  items: PutawayPendingItem[];
}

/**
 * PutawaySheet 의 입력. 입고 직후 화면과 적치 큐가 공유한다.
 * originLocationId 가 선택인 이유: 입고 직후 경로는 그 값을 모른다
 * (ReceiveFromPlanResult·SimpleInboundLine 어느 쪽도 로케이션을 안 돌려준다).
 * 없으면 "출발지를 대상지 후보에서 제외" 가드를 걸지 않는다.
 */
export interface PutawayTarget {
  lineId: string;
  skuName: string;
  skuCode: string;
  pendingQty: number;
  originLocationCode: string;
  originLocationId?: string;
}
