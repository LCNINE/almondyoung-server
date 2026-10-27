import { calculateShippingFee } from '../../../modules/almond-fulfillment/calculate-shipping-fee';
import type { ShippingPolicySnapshot } from '../../../modules/almond-fulfillment/types';

/** 부분취소가 더하는 배송비 방법의 이름 — 다음 판정이 «그룹의 원래 방법»과 가르는 표지다. */
export const PARTIAL_CANCEL_CHARGE_NAME = '부분취소 배송비';

/** 반품 정산이 더하는 택배비 방법의 이름 — 부분취소 배송비와 같이 «원래 방법이 아닌» 청구다. */
export const RETURN_FEE_CHARGE_NAME = '반품 택배비';
/** 우리가 정산으로 더한 청구 이름 둘. 다음 판정은 이 이름의 방법을 그룹의 원래 방법에서 뺀다. */
export const SETTLEMENT_CHARGE_NAMES: readonly string[] = [PARTIAL_CANCEL_CHARGE_NAME, RETURN_FEE_CHARGE_NAME];

export type ShippingMethodView = {
  id: string;
  shippingOptionId: string | null;
  amount: number;
  snapshot: ShippingPolicySnapshot | null;
  /** 이전 부분취소·반품 정산이 더한 «부분취소 배송비»·«반품 택배비» 방법. 그룹의 원래 방법이 아니다. */
  isSettlementCharge: boolean;
  /** 반품·교환·클레임의 배송 방법(order_shipping 행이 return_id·exchange_id·claim_id 를 든다). 스냅샷이 없고 그룹의 원래 방법도 아니다. */
  isReturnExchangeOrClaimShipping: boolean;
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
  /**
   * 환불의 바닥 — 주면 그룹 환불은 이 줄로 계산한 요금(과 newFee 중 큰 쪽) 아래로 내려가지 않는다. 청구는 lines 만 본다.
   * 부분취소가 «돌아온 수량을 빼지 않은» 줄을 준다(shippingRefundFloorLines). 없으면 바닥은 newFee 다(지금까지와 같다).
   */
  refundFloorLines?: ShippingLineView[];
  postalCode: string | null;
  priorGroupFees: PriorGroupFees;
  chargeCap: number;
}): ShippingPlan {
  const originals = input.methods.filter((m) => !m.isSettlementCharge && !m.isReturnExchangeOrClaimShipping);
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

  const floorLines = input.refundFloorLines?.filter((l) => l.requiresShipping);
  let computed: Array<{ shippingProfileId: string; shippingOptionId: string; currentFee: number; newFee: number; floorFee: number }>;
  try {
    computed = withSnapshot.map((m) => {
      const profileId = m.snapshot.shippingProfileId;
      const feeOf = (ls: ShippingLineView[]) => {
        const remaining = ls
          .filter((l) => l.productShippingProfileId === profileId && l.newQty > 0)
          .map((l) => ({ subtotal: l.unitPrice * l.newQty, quantity: l.newQty }));
        return remaining.length === 0 ? 0 : calculateShippingFee(m.snapshot.policy, remaining, input.postalCode);
      };
      const currentFee = input.priorGroupFees[profileId] ?? m.amount;
      const newFee = feeOf(shipLines);
      const floorFee = floorLines ? Math.max(newFee, feeOf(floorLines)) : newFee;
      return { shippingProfileId: profileId, shippingOptionId: m.shippingOptionId, currentFee, newFee, floorFee };
    });
  } catch {
    // 저장된 스냅샷을 지금 코드가 계산하지 못한다(모르는 정책 종류 등). 던지면 같은 요청이 매번 500 이 된다 —
    // 아직 아무것도 고치지 않았으니 스냅샷이 없는 것처럼 배송비를 건드리지 않는다.
    return { adjustable: false, reason: 'NO_SNAPSHOT' };
  }

  const up = computed.reduce((s, g) => s + Math.max(0, g.newFee - g.currentFee), 0);
  const down = computed.reduce((s, g) => s + Math.max(0, g.currentFee - g.floorFee), 0);
  const charge = Math.min(up, Math.max(0, input.chargeCap));

  // 올라가는 그룹에 청구분을 그룹 순서대로 배분한다. 내려가거나 그대로인 그룹은 돌려준 만큼만 내려간다
  // (바닥이 없으면 newFee 그대로, 바닥이 막으면 currentFee − 환불분).
  let left = charge;
  const groups = computed.map(({ floorFee, ...g }) => {
    if (g.newFee <= g.currentFee) return { ...g, recordedFee: Math.min(g.currentFee, floorFee) };
    const share = Math.min(left, g.newFee - g.currentFee);
    left -= share;
    return { ...g, recordedFee: g.currentFee + share };
  });
  return { adjustable: true, groups, charge, refund: down };
}
