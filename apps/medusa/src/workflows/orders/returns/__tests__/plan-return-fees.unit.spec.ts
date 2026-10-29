import { planReturnFees } from '../plan-return-fees';
import type { ShippingLineView, ShippingMethodView } from '../../partial-cancel/plan-shipping';
import type { ShippingPolicySnapshot } from '../../../../modules/almond-fulfillment/types';

const cond: ShippingPolicySnapshot = {
  policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000, jejuExtraFee: 3000 },
  shippingGroupCode: 'cond',
  shippingProfileId: 'sp_cond',
};
const flat: ShippingPolicySnapshot = {
  policy: { type: 'flat', baseFee: 3000 },
  shippingGroupCode: 'flat',
  shippingProfileId: 'sp_flat',
};
const perq: ShippingPolicySnapshot = {
  policy: { type: 'per_quantity', baseFee: 1000 },
  shippingGroupCode: 'perq',
  shippingProfileId: 'sp_perq',
};
const free: ShippingPolicySnapshot = {
  policy: { type: 'free', baseFee: 0 },
  shippingGroupCode: 'free',
  shippingProfileId: 'sp_free',
};
const m = (id: string, snapshot: ShippingPolicySnapshot | null, amount: number): ShippingMethodView => ({
  id,
  shippingOptionId: `so_${id}`,
  amount,
  snapshot,
  isSettlementCharge: false,
  isReturnExchangeOrClaimShipping: false,
  hasAdjustments: false,
});
const l = (
  itemId: string,
  profile: string,
  unitPrice: number,
  newQty: number,
  returnedNow: number,
): ShippingLineView & { returnedNow: number } => ({
  itemId,
  productShippingProfileId: profile,
  unitPrice,
  newQty,
  requiresShipping: true,
  returnedNow,
});

const base = { feeBearer: 'customer' as const, postalCode: '04524', priorGroupFees: {}, chargeCap: 1_000_000 };
const zero = { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 };

describe('planReturnFees', () => {
  it.each([0, 1000])('판매자 전량 반품은 차감 상한 %i와 무관하게 현재 배송비를 환불한다', (chargeCap) => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      chargeCap,
      methods: [m('f', flat, 2500)],
      lines: [l('a', 'sp_flat', 4990, 0, 1)],
    });

    expect(plan).toEqual({
      feeNotAdjusted: false,
      deduction: zero,
      total: 0,
      shippingRefund: 2500,
      groupFees: { sp_flat: 0 },
    });
  });

  it('판매자 부분 반품은 다른 줄에 남은 수량이 있으면 배송비를 환불하지 않는다', () => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [m('f', flat, 2500)],
      lines: [l('a', 'sp_flat', 4990, 0, 1), l('b', 'sp_flat', 4990, 1, 0)],
    });

    expect(plan).toMatchObject({ shippingRefund: 0, groupFees: {}, deduction: zero });
  });

  it.each([
    ['스냅샷 없음', m('f', null, 2500)],
    ['배송비 할인', { ...m('f', flat, 2500), hasAdjustments: true }],
    ['그룹 불일치', m('c', cond, 2500)],
  ])('판매자 반품도 조정 불가면 CS에 맡긴다: %s', (_name, method) => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [method],
      lines: [l('a', 'sp_flat', 4990, 0, 1)],
    });

    expect(plan).toEqual({ feeNotAdjusted: true, deduction: zero, total: 0, shippingRefund: 0, groupFees: {} });
  });

  it('판매자 부분 반품은 조정 불가여도 돌려줄 배송비가 없어 CS 에 넘기지 않는다', () => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [{ ...m('f', flat, 2500), hasAdjustments: true }],
      lines: [l('a', 'sp_flat', 4990, 0, 1), l('b', 'sp_flat', 4990, 1, 0)],
    });

    expect(plan).toEqual({ feeNotAdjusted: false, deduction: zero, total: 0, shippingRefund: 0, groupFees: {} });
  });

  it('두 그룹 중 이번에 전량 반품한 그룹만 환불한다', () => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [m('f', flat, 2500), m('c', cond, 3000)],
      lines: [l('a', 'sp_flat', 4990, 0, 1), l('b', 'sp_cond', 10000, 1, 1)],
    });

    expect(plan).toMatchObject({ shippingRefund: 2500, groupFees: { sp_flat: 0 } });
  });

  it('이미 비어 있고 이번 반품이 닿지 않은 그룹은 환불하지 않는다', () => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [m('f', flat, 2500), m('c', cond, 3000)],
      lines: [l('a', 'sp_flat', 4990, 0, 0), l('b', 'sp_cond', 10000, 0, 1)],
    });

    expect(plan).toMatchObject({ shippingRefund: 3000, groupFees: { sp_cond: 0 } });
  });

  it.each([1500, 0])('앞선 정산의 그룹 요금 %i를 현재 요금으로 쓴다', (currentFee) => {
    const plan = planReturnFees({
      ...base,
      feeBearer: 'seller',
      priorGroupFees: { sp_flat: currentFee },
      methods: [m('f', flat, 2500)],
      lines: [l('a', 'sp_flat', 4990, 0, 1)],
    });

    expect(plan).toMatchObject({ shippingRefund: currentFee, groupFees: { sp_flat: 0 } });
  });

  it('고객 전량 반품은 원래 배송비를 환불하지 않는다', () => {
    const plan = planReturnFees({ ...base, methods: [m('f', flat, 3000)], lines: [l('a', 'sp_flat', 4990, 0, 1)] });

    expect(plan).toEqual({
      feeNotAdjusted: false,
      deduction: { ...zero, returnShipping: 3000 },
      total: 3000,
      shippingRefund: 0,
      groupFees: {},
    });
  });

  it('판매자 사유는 차감 0', () => {
    const p = planReturnFees({
      ...base,
      feeBearer: 'seller',
      methods: [m('c', cond, 0)],
      lines: [l('a', 'sp_cond', 30000, 1, 1), l('b', 'sp_cond', 30000, 1, 0)],
    });
    expect(p).toEqual({ feeNotAdjusted: false, deduction: zero, total: 0, shippingRefund: 0, groupFees: {} });
  });

  it('변심 1개 반품 → 반품비 3,000 + 깨짐 3,000', () => {
    const p = planReturnFees({
      ...base,
      methods: [m('c', cond, 0)],
      lines: [l('a', 'sp_cond', 30000, 0, 1), l('b', 'sp_cond', 30000, 1, 0)],
    });
    expect(p.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 });
    expect(p.total).toBe(6000);
    expect(p.groupFees).toEqual({ sp_cond: 3000 });
  });

  it('변심 전량 반품 → 반품비 3,000 + 왕복 3,000', () => {
    const two = planReturnFees({
      ...base,
      methods: [m('c', cond, 0)],
      lines: [l('a', 'sp_cond', 30000, 0, 1), l('b', 'sp_cond', 30000, 0, 1)],
    });
    expect(two.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 0, roundTrip: 3000 });
    expect(two.groupFees).toEqual({ sp_cond: 3000 });
    const one = planReturnFees({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 0, 2)] });
    expect(one.deduction).toEqual(two.deduction);
  });

  it('제주 주소는 반품비·왕복에 지역 추가비가 붙는다', () => {
    const p = planReturnFees({
      ...base,
      postalCode: '63100',
      methods: [m('c', cond, 3000)],
      lines: [l('a', 'sp_cond', 30000, 0, 2)],
    });
    expect(p.deduction).toEqual({ returnShipping: 6000, freeShippingBreak: 0, roundTrip: 3000 });
  });

  it('free 그룹은 0, flat 그룹 전량 반품은 왕복 0', () => {
    const f = planReturnFees({ ...base, methods: [m('f', free, 0)], lines: [l('a', 'sp_free', 30000, 0, 1)] });
    expect(f.deduction).toEqual(zero);
    const fl = planReturnFees({ ...base, methods: [m('f', flat, 3000)], lines: [l('a', 'sp_flat', 30000, 0, 1)] });
    expect(fl.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 });
    expect(fl.groupFees).toEqual({});
  });

  it('per_quantity 그룹은 반품비 baseFee 한 번, 줄어드는 배송비는 돌려주지 않는다', () => {
    const p = planReturnFees({ ...base, methods: [m('q', perq, 3000)], lines: [l('a', 'sp_perq', 10000, 1, 2)] });
    expect(p.deduction).toEqual({ returnShipping: 1000, freeShippingBreak: 0, roundTrip: 0 });
    expect(p.total).toBe(1000);
  });

  it('두 그룹에 걸친 반품은 그룹마다 반품비', () => {
    const p = planReturnFees({
      ...base,
      methods: [m('c', cond, 0), m('f', flat, 3000)],
      lines: [l('a', 'sp_cond', 60000, 1, 0), l('b', 'sp_flat', 10000, 0, 1), l('c', 'sp_cond', 10000, 0, 1)],
    });
    expect(p.deduction.returnShipping).toBe(6000);
  });

  it('합이 chargeCap 을 넘으면 반품비 → 깨짐 → 왕복 순으로 채운다', () => {
    const p = planReturnFees({
      ...base,
      chargeCap: 4000,
      methods: [m('c', cond, 0)],
      lines: [l('a', 'sp_cond', 30000, 0, 1), l('b', 'sp_cond', 30000, 1, 0)],
    });
    expect(p.deduction).toEqual({ returnShipping: 3000, freeShippingBreak: 1000, roundTrip: 0 });
    expect(p.total).toBe(4000);
    expect(p.groupFees).toEqual({ sp_cond: 1000 });
  });

  it('앞선 부분취소가 이미 그룹 요금을 올렸으면 깨짐을 다시 빼지 않는다', () => {
    const p = planReturnFees({
      ...base,
      priorGroupFees: { sp_cond: 3000 },
      methods: [m('c', cond, 0)],
      lines: [l('a', 'sp_cond', 30000, 0, 1), l('b', 'sp_cond', 30000, 1, 0)],
    });
    expect(p.deduction.freeShippingBreak).toBe(0);
  });

  it('스냅샷이 없으면 feeNotAdjusted, 차감 0', () => {
    const p = planReturnFees({ ...base, methods: [m('c', null, 0)], lines: [l('a', 'sp_cond', 30000, 0, 1)] });
    expect(p).toEqual({ feeNotAdjusted: true, deduction: zero, total: 0, shippingRefund: 0, groupFees: {} });
  });
});
