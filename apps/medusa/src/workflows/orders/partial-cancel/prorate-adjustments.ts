export type OrderAdjustment = {
  amount: number;
  code?: string | null;
  promotion_id?: string | null;
  description?: string | null;
  is_tax_inclusive?: boolean;
};

const roundHalfUp = (n: number) => Math.floor(n + 0.5);

/**
 * 수량만 줄어든 줄의 할인을 구매 시점 배분대로 남은 수량에 맞춘다(스펙 D5).
 * Medusa 의 줄 할인은 «줄 전체 금액»이라, 재계산을 끄고 수량만 줄이면 할인이 남은 수량에 몰린다.
 * 줄을 통째로 빼는 경우(newQty 0)는 Medusa 가 할인도 같이 빼므로 이 함수를 부르지 않는다.
 */
export function prorateAdjustments(adjs: OrderAdjustment[], oldQty: number, newQty: number): OrderAdjustment[] {
  if (!(newQty > 0 && newQty < oldQty)) throw new Error(`prorateAdjustments: 0 < newQty(${newQty}) < oldQty(${oldQty}) 이어야 한다`);
  return adjs.map((a) => ({ ...a, amount: roundHalfUp((a.amount * newQty) / oldQty) }));
}

export function cancelledAdjustmentShare(adjs: OrderAdjustment[], oldQty: number, newQty: number): number {
  const kept = newQty === 0 ? 0 : prorateAdjustments(adjs, oldQty, newQty).reduce((s, a) => s + a.amount, 0);
  return adjs.reduce((s, a) => s + a.amount, 0) - kept;
}
