import type { ShippingMethodView } from '../partial-cancel/plan-shipping';

/**
 * «반품 택배비»·«반품 차감» 방법을 붙일 배송 옵션. 금액은 custom_amount 라 옵션은 그릇일 뿐이다.
 * ① 이번 반품이 닿은 첫 그룹(주문의 배송 방법 순서)의 원래 방법 옵션 — 택배비가 있으면 계획이 그룹을 맞춘 것이라 여기서 찾는다.
 * ② 없으면(스냅샷 없는 주문·그룹 불일치 — 택배비는 0 이고 보류 차감만 있을 수 있다) 정산 청구·반품·교환·클레임 배송이 아닌
 *    원래 방법 중 옵션이 있는 첫 방법.
 * 둘 다 없으면 null — 호출자가 수령 «전»에 정한다(보류 차감이 있으면 정해진 거절). 배송 방법은 수령으로 바뀌지 않는다.
 */
export function chargeShippingOption(
  methods: ShippingMethodView[],
  lines: ReadonlyArray<{ id: string; productId: string | null }>,
  profiles: ReadonlyMap<string, string>,
  items: ReadonlyArray<{ itemId: string; received: number; dismissed: number }>,
): string | null {
  const originals = methods.filter((m) => !m.isSettlementCharge && !m.isReturnExchangeOrClaimShipping && m.shippingOptionId);
  const ids = new Set(items.filter((i) => i.received + i.dismissed > 0).map((i) => i.itemId));
  const touched = new Set(
    lines.flatMap((l) => {
      const profile = ids.has(l.id) && l.productId ? profiles.get(l.productId) : undefined;
      return profile ? [profile] : [];
    }),
  );
  const grouped = originals.find((m) => m.snapshot && touched.has(m.snapshot.shippingProfileId));
  return (grouped ?? originals[0])?.shippingOptionId ?? null;
}
