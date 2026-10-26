import type { CoreReturnEligibility } from './core-return-eligibility';
import type { ReturnFeeBearer } from './return-reasons';
import { returnWindowEndsAt } from './return-window';

export type ReturnRequestedBy = 'customer' | 'operator';

export type ReturnRejectReason =
  | 'order_canceled'
  | 'item_not_in_order'
  | 'not_delivered'
  | 'quantity_exceeds_returnable'
  | 'window_closed'
  | 'window_override_reason_required'
  | 'reason_not_found'
  | 'reason_not_selectable'
  | 'fee_bearer_required'
  | 'request_id_conflict'
  | 'return_option_missing'
  | 'return_already_received'
  | 'not_our_return';

/** 정해진 거절 — 호출자는 이걸 400 계열로 닫는다(500 이면 channel-adapter 류가 재시도를 되풀이한다). */
export class ReturnRequestRejected extends Error {
  constructor(
    readonly reason: ReturnRejectReason,
    message: string,
  ) {
    super(message);
    this.name = 'ReturnRequestRejected';
  }
}

export type ReturnableOrderItem = {
  id: string;
  quantity: number;
  fulfilled: number;
  returnRequested: number;
  returnReceived: number;
  returnDismissed: number;
};

export type ReturnableLine = { itemId: string; returnableQuantity: number; windowEndsAt: Date | null };

const held = (i: ReturnableOrderItem) => i.returnRequested + i.returnReceived + i.returnDismissed;

/**
 * 줄별 반품 가능 수량(N2): min(core 배송완료 단위, item.quantity) − (요청 + 수령 + 폐기). 음수는 0.
 * item.quantity 쪽 min 은 배송 뒤 부분취소로 Medusa 수량이 줄어든 경우를 막는다. core 줄이 없으면 0·null.
 */
export function describeReturnable(items: ReturnableOrderItem[], core: CoreReturnEligibility): ReturnableLine[] {
  return items.map((item) => {
    const line = core.lines.find((l) => l.channelOrderItemId === item.id);
    if (!line) return { itemId: item.id, returnableQuantity: 0, windowEndsAt: null };
    return {
      itemId: item.id,
      returnableQuantity: Math.max(0, Math.min(line.deliveredUnits, item.quantity) - held(item)),
      windowEndsAt: line.lastDeliveredAt ? returnWindowEndsAt(line.lastDeliveredAt) : null,
    };
  });
}

/** 취소된 주문은 반품할 수 없다 — POST(planReturnRequest 의 order_canceled)와 GET(반품 가능 수량)이 이 한 판정을 쓴다(N8) */
export const isOrderCanceled = (orderStatus: string) => orderStatus === 'canceled';

/**
 * 주문 단위 반품 가능 수량 — 취소된 주문은 core 를 묻지 않고 전 줄 0·기한 없음이다. 화면이 POST 의 거절 규칙을 다시 만들지 않게
 * GET 이 같은 판정을 먼저 적용한다. 취소되지 않은 주문은 loadCore 결과로 describeReturnable 을 계산한다.
 */
export async function describeOrderReturnable(
  orderStatus: string,
  items: ReturnableOrderItem[],
  loadCore: () => Promise<CoreReturnEligibility>,
): Promise<ReturnableLine[]> {
  if (isOrderCanceled(orderStatus)) return items.map((i) => ({ itemId: i.id, returnableQuantity: 0, windowEndsAt: null }));
  return describeReturnable(items, await loadCore());
}

export type PlanReturnRequestInput = {
  orderStatus: string;
  items: ReturnableOrderItem[];
  core: CoreReturnEligibility;
  requested: Array<{ itemId: string; quantity: number }>;
  requestedBy: ReturnRequestedBy;
  reason: { value: string; feeBearer: ReturnFeeBearer | null; customerSelectable: boolean } | null;
  operatorFeeBearer?: 'customer' | 'seller';
  windowOverrideReason?: string;
  now: Date;
};

export type ReturnRequestPlan = {
  items: Array<{ itemId: string; quantity: number }>;
  fulfillmentTopUp: Array<{ itemId: string; quantity: number }>;
  feeBearer: 'customer' | 'seller';
  windowOverridden: boolean;
};

/**
 * 반품 요청 판정 — 주문 상태 → 사유 → 품목·수량 → 기한 순. 부수효과 없음.
 * CS 도 수량 상한은 넘지 못한다(§4.0). 넘길 수 있는 건 기한뿐이고, 그러려면 사유가 필수다(D5).
 * fulfillmentTopUp(N1): Medusa 는 출고를 몰라 fulfilled_quantity 가 0 이라 코어 검증(quantity ≤ fulfilled − requested)이 막는다.
 * 그래서 반품이 잡는 수량만큼만 올린다 — 전부 올리면 주문 수정이 그 아래로 수량을 못 줄인다.
 */
export function planReturnRequest(input: PlanReturnRequestInput): ReturnRequestPlan {
  if (isOrderCanceled(input.orderStatus))
    throw new ReturnRequestRejected('order_canceled', '취소된 주문은 반품할 수 없습니다');

  const feeBearer = resolveFeeBearer(input);
  const lines = describeReturnable(input.items, input.core);

  const picked = input.requested.map((req) => {
    const item = input.items.find((i) => i.id === req.itemId);
    const line = lines.find((l) => l.itemId === req.itemId);
    if (!item || !line) throw new ReturnRequestRejected('item_not_in_order', `주문에 없는 품목입니다: ${req.itemId}`);
    const deliveredUnits = input.core.lines.find((l) => l.channelOrderItemId === req.itemId)?.deliveredUnits ?? 0;
    if (line.returnableQuantity === 0 && deliveredUnits === 0) {
      throw new ReturnRequestRejected('not_delivered', `배송완료되지 않은 품목입니다: ${req.itemId}`);
    }
    if (req.quantity > line.returnableQuantity) {
      throw new ReturnRequestRejected(
        'quantity_exceeds_returnable',
        `반품 가능 수량(${line.returnableQuantity})을 넘었습니다: ${req.itemId}`,
      );
    }
    return { item, line, quantity: req.quantity };
  });

  const closed = picked.some(
    (p) => p.line.windowEndsAt !== null && input.now.getTime() > p.line.windowEndsAt.getTime(),
  );
  let windowOverridden = false;
  if (closed) {
    if (input.requestedBy === 'customer')
      throw new ReturnRequestRejected('window_closed', '반품 가능 기한이 지났습니다');
    if (!input.windowOverrideReason?.trim()) {
      throw new ReturnRequestRejected('window_override_reason_required', '기한을 넘기려면 사유가 필요합니다');
    }
    windowOverridden = true;
  }

  const fulfillmentTopUp = picked
    .map((p) => ({ itemId: p.item.id, quantity: Math.max(0, held(p.item) + p.quantity - p.item.fulfilled) }))
    .filter((t) => t.quantity > 0);

  return {
    items: picked.map((p) => ({ itemId: p.item.id, quantity: p.quantity })),
    fulfillmentTopUp,
    feeBearer,
    windowOverridden,
  };
}

function resolveFeeBearer(input: PlanReturnRequestInput): 'customer' | 'seller' {
  const reason = input.reason;
  if (!reason) throw new ReturnRequestRejected('reason_not_found', '반품 사유를 찾을 수 없습니다');
  if (input.requestedBy === 'customer' && !reason.customerSelectable) {
    throw new ReturnRequestRejected('reason_not_selectable', '고객이 고를 수 없는 사유입니다');
  }
  if (reason.feeBearer === null)
    throw new ReturnRequestRejected('reason_not_found', '부담 주체가 정해지지 않은 사유입니다');
  if (reason.feeBearer === 'operator') {
    if (!input.operatorFeeBearer)
      throw new ReturnRequestRejected('fee_bearer_required', '택배비 부담 주체를 골라야 합니다');
    return input.operatorFeeBearer;
  }
  return reason.feeBearer;
}
