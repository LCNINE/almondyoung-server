import { cancelledAdjustmentShare } from '../partial-cancel/prorate-adjustments';
import type { OrderView } from '../settlement/load-order-view';

/**
 * 반품 품목 값 V = floor(Σ 단가 × 반품 수량 − 그 수량 몫의 할인)(K8 PR6b N5). 할인 몫은 부분취소와 같은 계산
 * (cancelledAdjustmentShare)이라 수령이 만드는 «돌려줄 차액»과 맞는다. 원 단위로 내림한다 — 선환불 상한이 실제 차액을 넘지 않게.
 * 같은 줄이 여러 행으로 오면 합쳐서 센다(행마다 반올림하면 할인 몫이 갈린다).
 */
export function returnItemValue(lines: OrderView['lines'], items: Array<{ itemId: string; quantity: number }>): number {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const quantities = new Map<string, number>();
  for (const i of items) quantities.set(i.itemId, (quantities.get(i.itemId) ?? 0) + i.quantity);

  let value = 0;
  for (const [itemId, q] of quantities) {
    const line = byId.get(itemId);
    if (!line) throw new Error(`반품 품목이 주문 줄에 없습니다: ${itemId}`);
    if (!Number.isFinite(q) || q < 0 || q > line.quantity) {
      throw new Error(`반품 수량이 줄 수량을 벗어납니다: ${itemId} ${q}/${line.quantity}`);
    }
    if (q === 0) continue;
    value += line.unitPrice * q - cancelledAdjustmentShare(line.adjustments, line.quantity, line.quantity - q);
  }
  return Math.floor(value);
}
