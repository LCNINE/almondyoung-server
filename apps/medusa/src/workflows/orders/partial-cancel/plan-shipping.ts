import { calculateShippingFee } from '../../../modules/almond-fulfillment/calculate-shipping-fee';
import type { ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';

export type ShippingMethodView = {
  id: string;
  shippingOptionId: string | null;
  amount: number;
  snapshot: ShippingPolicySnapshot | null;
  /** 이전 부분취소가 더한 «부분취소 배송비» 방법. 그룹의 원래 방법이 아니다. */
  isPartialCancelCharge: boolean;
  /** 0 이 아닌 할인(배송비 쿠폰 등)이 붙어 있다. amount 는 할인 «전» 금액이라 고객이 실제로 낸 배송비가 아니다. */
  hasAdjustments: boolean;
};
export type ShippingLineView = {
  itemId: string;
  productShippingProfileId: string | null;
  unitPrice: number;
  newQty: number;
  requiresShipping: boolean;
};
/** shippingProfileId → 직전 부분취소가 남긴 그룹 요금 */
export type PriorGroupFees = Record<string, number>;
export type ShippingPlan =
  | { adjustable: false; reason: 'NO_SNAPSHOT' | 'GROUP_MISMATCH' | 'SHIPPING_DISCOUNTED' }
  | {
      adjustable: true;
      /**
       * newFee = 정책이 계산한 그룹 요금(로깅용). recordedFee = 이번 취소 뒤 «실제로 유효한» 그룹 요금.
       * 호출자(Task 7)는 groupFees 에 newFee 가 아니라 recordedFee 를 기록해야 한다 —
       * 상한이 청구를 깎았는데 newFee 를 기록하면 다음 취소가 청구하지 않은 금액을 환불한다.
       */
      groups: Array<{ shippingProfileId: string; shippingOptionId: string; currentFee: number; newFee: number; recordedFee: number }>;
      charge: number;
      refund: number;
    };

/**
 * 부분취소 뒤 배송비를 주문 시점 정책으로 다시 계산한다(스펙 D6·D7, §6.1).
 * 그룹 소속은 «지금» 상품의 배송 프로필로 정하고, 모든 배송 대상 줄이 스냅샷 하나에 정확히 맞을 때만 조정한다.
 * 그룹의 «지금 요금»은 직전 부분취소가 남긴 값(priorGroupFees)이 있으면 그것, 없으면 원래 배송 방법 금액이다.
 */
export function planShipping(input: {
  methods: ShippingMethodView[];
  lines: ShippingLineView[];
  postalCode: string | null;
  priorGroupFees: PriorGroupFees;
  chargeCap: number;
}): ShippingPlan {
  const originals = input.methods.filter((m) => !m.isPartialCancelCharge);
  // 배송비 할인이 붙은 주문은 조정하지 않는다(fail-safe). 할인 뒤 순 배송비로 계산하지 않는 이유: 할인을 그룹 사이에
  // 어떻게 나눌지·남은 요금에 할인을 다시 어떻게 매길지를 정해야 하는데, 틀리면 고객이 내지 않은 배송비를 돌려준다.
  if (originals.some((m) => m.hasAdjustments)) return { adjustable: false, reason: 'SHIPPING_DISCOUNTED' };
  const withSnapshot: Array<ShippingMethodView & { snapshot: ShippingPolicySnapshot; shippingOptionId: string }> = [];
  for (const m of originals) {
    if (!m.snapshot || !m.shippingOptionId) return { adjustable: false, reason: 'NO_SNAPSHOT' };
    withSnapshot.push({ ...m, snapshot: m.snapshot, shippingOptionId: m.shippingOptionId });
  }

  const profileIds = new Set(withSnapshot.map((m) => m.snapshot.shippingProfileId));
  if (profileIds.size !== withSnapshot.length) return { adjustable: false, reason: 'GROUP_MISMATCH' };
  const shipLines = input.lines.filter((l) => l.requiresShipping);
  if (shipLines.some((l) => !l.productShippingProfileId || !profileIds.has(l.productShippingProfileId))) {
    return { adjustable: false, reason: 'GROUP_MISMATCH' };
  }

  let computed: Array<{ shippingProfileId: string; shippingOptionId: string; currentFee: number; newFee: number }>;
  try {
    computed = withSnapshot.map((m) => {
      const profileId = m.snapshot.shippingProfileId;
      const remaining = shipLines
        .filter((l) => l.productShippingProfileId === profileId && l.newQty > 0)
        .map((l) => ({ subtotal: l.unitPrice * l.newQty, quantity: l.newQty }));
      const currentFee = input.priorGroupFees[profileId] ?? m.amount;
      const newFee = remaining.length === 0 ? 0 : calculateShippingFee(m.snapshot.policy, remaining, input.postalCode);
      return { shippingProfileId: profileId, shippingOptionId: m.shippingOptionId, currentFee, newFee };
    });
  } catch {
    // 저장된 스냅샷을 지금 코드가 계산하지 못한다(모르는 정책 종류 등). 던지면 같은 요청이 매번 500 이 된다 —
    // 아직 아무것도 고치지 않았으니 스냅샷이 없는 것처럼 배송비를 건드리지 않는다.
    return { adjustable: false, reason: 'NO_SNAPSHOT' };
  }

  const up = computed.reduce((s, g) => s + Math.max(0, g.newFee - g.currentFee), 0);
  const down = computed.reduce((s, g) => s + Math.max(0, g.currentFee - g.newFee), 0);
  const charge = Math.min(up, Math.max(0, input.chargeCap));

  // 올라가는 그룹에 청구분을 그룹 순서대로 배분한다. 내려가거나 그대로인 그룹은 newFee 그대로.
  let left = charge;
  const groups = computed.map((g) => {
    if (g.newFee <= g.currentFee) return { ...g, recordedFee: g.newFee };
    const share = Math.min(left, g.newFee - g.currentFee);
    left -= share;
    return { ...g, recordedFee: g.currentFee + share };
  });
  return { adjustable: true, groups, charge, refund: down };
}
