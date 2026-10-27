import type { OrderLine } from './plan-partial-cancel';
import type { ShippingLineView } from './plan-shipping';

/**
 * 부분취소의 배송비 판정 입력. 남는 수량 = 취소 뒤 수량 − 이미 돌아온 수량(수령·폐기).
 * Medusa items.quantity 는 반품이 수령돼도 줄지 않으므로, 빼지 않으면 돌아간 물건이 그룹 소계에 남아
 * 반품 정산이 받은 «무료배송 깨짐»을 부분취소가 되돌려 준다. 주문 수정의 수량 계산은 건드리지 않는다.
 */
export function shippingPlanLines(
  lines: OrderLine[],
  newQty: ReadonlyMap<string, number>,
  profiles: ReadonlyMap<string, string>,
): ShippingLineView[] {
  return toViews(lines, newQty, profiles, (l) => l.returnedQuantity);
}

/**
 * 부분취소 «환불»의 바닥 줄 — 돌아온 수량을 빼지 않는다(취소 뒤 수량 그대로). 돌아온 물건도 한 번은 나갔으니
 * 그 출고 배송비는 이미 쓴 것이다: 반품 뒤 남은 줄을 다 취소해도 «돌아온 물건이 아직 있다면» 냈을 요금 아래로는
 * 돌려주지 않는다. 반품이 없는 주문은 shippingPlanLines 와 같은 값이라 판정이 바뀌지 않는다.
 */
export function shippingRefundFloorLines(
  lines: OrderLine[],
  newQty: ReadonlyMap<string, number>,
  profiles: ReadonlyMap<string, string>,
): ShippingLineView[] {
  return toViews(lines, newQty, profiles, () => 0);
}

function toViews(
  lines: OrderLine[],
  newQty: ReadonlyMap<string, number>,
  profiles: ReadonlyMap<string, string>,
  returned: (l: OrderLine) => number,
): ShippingLineView[] {
  return lines.map((l) => ({
    itemId: l.id,
    productShippingProfileId: l.productId ? (profiles.get(l.productId) ?? null) : null,
    unitPrice: l.unitPrice,
    newQty: Math.max(0, (newQty.get(l.id) ?? l.quantity) - returned(l)),
    requiresShipping: l.requiresShipping,
  }));
}
