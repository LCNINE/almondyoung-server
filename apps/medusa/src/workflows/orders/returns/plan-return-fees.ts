import { calculateShippingFee } from '../../../modules/almond-fulfillment/calculate-shipping-fee';
import {
  planShipping,
  type PriorGroupFees,
  type ShippingLineView,
  type ShippingMethodView,
} from '../partial-cancel/plan-shipping';

/** 계약(@app/event-contracts)의 ReturnSettlementDeduction 과 같은 모양 — Medusa 는 계약 패키지를 import 하지 않는다. */
export type ReturnSettlementDeduction = {
  returnShipping: number;
  freeShippingBreak: number;
  roundTrip: number;
};

export type ReturnFeePlan = {
  /** 스냅샷이 없거나 그룹이 안 맞거나 배송비 할인이 붙어 계산하지 못했다 — 차감 0, CS 가 다룬다 */
  feeNotAdjusted: boolean;
  deduction: ReturnSettlementDeduction;
  total: number;
  /** 깨짐·왕복이 올린 그룹의 «이 반품 뒤 그룹 요금». 반품 택배비는 그룹 요금이 아니므로 들어가지 않는다 */
  groupFees: Record<string, number>;
};

const NONE: ReturnFeePlan = {
  feeNotAdjusted: false,
  deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
  total: 0,
  groupFees: {},
};

/**
 * 반품 택배비 차감을 계산한다(N13). 고객 부담일 때만 세 몫 — 반품 택배비·무료배송 깨짐·왕복.
 * 줄어드는 배송비는 돌려주지 않는다(물건은 이미 배송됐다). 합은 chargeCap 을 넘지 않는다(반품비 → 깨짐 → 왕복 순).
 * lines[].newQty = 남는 수량, returnedNow = 이번 반품 수량.
 */
export function planReturnFees(input: {
  feeBearer: 'customer' | 'seller';
  methods: ShippingMethodView[];
  lines: Array<ShippingLineView & { returnedNow: number }>;
  postalCode: string | null;
  priorGroupFees: PriorGroupFees;
  chargeCap: number;
}): ReturnFeePlan {
  if (input.feeBearer === 'seller') return NONE;

  // 그룹·스냅샷 판정은 부분취소와 같은 계산에 맡긴다. 상한 없이 돌려 «올라감»만 읽는다.
  const shipping = planShipping({
    methods: input.methods,
    lines: input.lines,
    postalCode: input.postalCode,
    priorGroupFees: input.priorGroupFees,
    chargeCap: Number.MAX_SAFE_INTEGER,
  });
  if (!shipping.adjustable) return { ...NONE, feeNotAdjusted: true };

  const snapshots = new Map(
    input.methods.flatMap((m) => (m.snapshot ? [[m.snapshot.shippingProfileId, m.snapshot] as const] : [])),
  );
  const flatFee = (profileId: string): number => {
    const policy = snapshots.get(profileId)?.policy;
    return policy ? calculateShippingFee({ ...policy, type: 'flat' }, [{ subtotal: 0, quantity: 1 }], input.postalCode) : 0;
  };

  const groups = shipping.groups.flatMap((g) => {
    const lines = input.lines.filter((l) => l.requiresShipping && l.productShippingProfileId === g.shippingProfileId);
    if (!lines.some((l) => l.returnedNow > 0)) return []; // 이번 반품이 닿지 않은 그룹
    const policy = snapshots.get(g.shippingProfileId)?.policy;
    const remaining = lines.some((l) => l.newQty > 0);
    const returnShipping = !policy || policy.type === 'free' ? 0 : flatFee(g.shippingProfileId);
    const wantBreak = remaining ? Math.max(0, g.newFee - g.currentFee) : 0;
    const wantRoundTrip =
      !remaining && policy?.type === 'conditional_free' ? Math.max(0, flatFee(g.shippingProfileId) - g.currentFee) : 0;
    return [{ profileId: g.shippingProfileId, currentFee: g.currentFee, returnShipping, wantBreak, wantRoundTrip }];
  });

  let left = Math.max(0, input.chargeCap);
  const take = (want: number) => {
    const got = Math.min(want, left);
    left -= got;
    return got;
  };
  const shares = new Map<string, number>();
  const rows = groups.map((g) => ({ ...g, ret: take(g.returnShipping) }));
  const withBreak = rows.map((g) => ({ ...g, brk: take(g.wantBreak) }));
  const withAll = withBreak.map((g) => ({ ...g, trip: take(g.wantRoundTrip) }));
  for (const g of withAll) if (g.brk + g.trip > 0) shares.set(g.profileId, g.brk + g.trip);

  const deduction: ReturnSettlementDeduction = {
    returnShipping: withAll.reduce((s, g) => s + g.ret, 0),
    freeShippingBreak: withAll.reduce((s, g) => s + g.brk, 0),
    roundTrip: withAll.reduce((s, g) => s + g.trip, 0),
  };
  return {
    feeNotAdjusted: false,
    deduction,
    total: deduction.returnShipping + deduction.freeShippingBreak + deduction.roundTrip,
    groupFees: Object.fromEntries(
      withAll.filter((g) => shares.has(g.profileId)).map((g) => [g.profileId, g.currentFee + (shares.get(g.profileId) ?? 0)]),
    ),
  };
}
