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
  return lines.map((l) => ({
    itemId: l.id,
    productShippingProfileId: l.productId ? (profiles.get(l.productId) ?? null) : null,
    unitPrice: l.unitPrice,
    newQty: Math.max(0, (newQty.get(l.id) ?? l.quantity) - l.returnedQuantity),
    requiresShipping: l.requiresShipping,
  }));
}
