import { cancelledAdjustmentShare, prorateAdjustments, type OrderAdjustment } from './prorate-adjustments';

export type OrderLine = {
  id: string;
  quantity: number;
  unitPrice: number;
  productId: string | null;
  requiresShipping: boolean;
  /**
   * Medusa 가 아는 출고 수량(detail.fulfilled_quantity). 라이브는 core 출고를 metadata 로만 투영해 0 이고,
   * 반품 요청이 그 반품이 잡는 만큼만 올린다(K8 N1). Medusa 주문 수정은 이 아래로 수량을 못 줄인다(item-update 하한).
   */
  fulfilledQuantity: number;
  /**
   * 이미 돌아온 수량(detail.return_received_quantity + return_dismissed_quantity). Medusa 는 이걸 items.quantity 에서
   * 빼지 않는다 — 배송비 판정은 남는 수량으로 해야 하므로 따로 든다. 주문 수정의 수량 계산에는 쓰지 않는다.
   */
  returnedQuantity: number;
  adjustments: OrderAdjustment[];
};
export type CancelRequestItem = { itemId: string; quantity: number };
export type PartialCancelPlan = {
  lines: Array<{ itemId: string; oldQty: number; newQty: number; replaceAdjustments: OrderAdjustment[] | null }>;
  /** Σ (unitPrice × 취소 수량 − 취소분 할인). 배송비 차감 상한에만 쓴다. */
  itemRefundEstimate: number;
};

/** 결과가 정해진 거절 — 라우트가 400 `not_allowed` 로 내보낸다. */
export class PartialCancelRejected extends Error {}

export function planPartialCancel(lines: OrderLine[], items: CancelRequestItem[]): PartialCancelPlan {
  if (items.length === 0) throw new PartialCancelRejected('취소할 줄이 없습니다');
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const planned: PartialCancelPlan['lines'] = [];
  let itemRefundEstimate = 0;

  for (const it of items) {
    const l = byId.get(it.itemId);
    if (!l) throw new PartialCancelRejected(`주문에 없는 줄입니다: ${it.itemId}`);
    if (seen.has(it.itemId)) throw new PartialCancelRejected(`같은 줄이 두 번 왔습니다: ${it.itemId}`);
    seen.add(it.itemId);
    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new PartialCancelRejected(`취소 수량이 올바르지 않습니다: ${it.itemId}`);
    if (it.quantity > l.quantity) throw new PartialCancelRejected(`취소 수량이 남은 수량보다 많습니다: ${it.itemId}`);

    const newQty = l.quantity - it.quantity;
    // 반품 중인 물건은 취소 대상이 아니다. 여기서 막지 않으면 Medusa 가 주문 수정 중에 INVALID_DATA 를 던지고, 라우트가 그걸
    // 500 으로 내보내 channel-adapter 가 재시도를 되풀이한다 — 정해진 거절(400 partial_cancel_rejected)로 닫는다(K8 PR3 Review Focus 6)
    if (newQty < l.fulfilledQuantity) throw new PartialCancelRejected(`반품이 걸린 수량은 취소할 수 없습니다: ${it.itemId}`);
    const replaceAdjustments = newQty > 0 && l.adjustments.length > 0 ? prorateAdjustments(l.adjustments, l.quantity, newQty) : null;
    planned.push({ itemId: l.id, oldQty: l.quantity, newQty, replaceAdjustments });
    itemRefundEstimate += l.unitPrice * it.quantity - cancelledAdjustmentShare(l.adjustments, l.quantity, newQty);
  }

  const remaining = lines.reduce((s, l) => s + (planned.find((p) => p.itemId === l.id)?.newQty ?? l.quantity), 0);
  if (remaining === 0) throw new PartialCancelRejected('모든 줄이 취소됩니다 — 전체취소로 요청해야 합니다');

  return { lines: planned, itemRefundEstimate };
}
