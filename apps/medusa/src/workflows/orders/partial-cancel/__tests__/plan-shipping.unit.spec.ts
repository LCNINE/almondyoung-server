import { planShipping, ShippingMethodView, ShippingLineView } from '../plan-shipping';
import type { ShippingPolicySnapshot } from '../../../../modules/almond-fulfillment/types';

const cond: ShippingPolicySnapshot = { policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000 }, shippingGroupCode: 'cond', shippingProfileId: 'sp_cond' };
const flat: ShippingPolicySnapshot = { policy: { type: 'flat', baseFee: 3000 }, shippingGroupCode: 'flat', shippingProfileId: 'sp_flat' };
const perq: ShippingPolicySnapshot = { policy: { type: 'per_quantity', baseFee: 1000 }, shippingGroupCode: 'perq', shippingProfileId: 'sp_perq' };
const m = (id: string, snapshot: ShippingPolicySnapshot | null, amount: number): ShippingMethodView => ({ id, shippingOptionId: `so_${id}`, amount, snapshot, isPartialCancelCharge: false });
const l = (itemId: string, profile: string | null, unitPrice: number, newQty: number, requiresShipping = true): ShippingLineView =>
  ({ itemId, productShippingProfileId: profile, unitPrice, newQty, requiresShipping });

const base = { postalCode: '04524', priorGroupFees: {}, chargeCap: 1_000_000 };

describe('planShipping', () => {
  it('조건부 무료 그룹이 기준 아래로 내려가면 기본 배송비를 받는다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1), l('b', 'sp_cond', 30000, 0)] });
    expect(p).toEqual({ adjustable: true, groups: [{ shippingProfileId: 'sp_cond', shippingOptionId: 'so_c', currentFee: 0, newFee: 3000 }], charge: 3000, refund: 0 });
  });

  it('받을 배송비는 상품 환불액을 넘지 않는다', () => {
    const p = planShipping({ ...base, chargeCap: 1000, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable && p.charge).toBe(1000);
  });

  it('그룹이 통째로 비면 그 그룹 배송비를 돌려준다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0), m('f', flat, 3000)], lines: [l('a', 'sp_cond', 60000, 1), l('x', 'sp_flat', 10000, 0)] });
    expect(p.adjustable && { charge: p.charge, refund: p.refund }).toEqual({ charge: 0, refund: 3000 });
  });

  it('수량당 그룹은 줄어든 수량만큼 돌려준다', () => {
    const p = planShipping({ ...base, methods: [m('q', perq, 3000)], lines: [l('d', 'sp_perq', 5000, 1)] });
    expect(p.adjustable && p.refund).toBe(2000);
  });

  it('제주 우편번호면 지역 추가비가 남는다(줄이 남아 있으면 추가비 포함 요금 그대로)', () => {
    const jeju: ShippingPolicySnapshot = { ...flat, policy: { ...flat.policy, jejuExtraFee: 3000 } };
    const p = planShipping({ ...base, postalCode: '63000', methods: [m('f', jeju, 6000)], lines: [l('x', 'sp_flat', 10000, 1)] });
    expect(p.adjustable && p.refund).toBe(0);
  });

  it('직전 부분취소가 남긴 그룹 요금을 «지금 요금»으로 쓴다', () => {
    const p = planShipping({ ...base, priorGroupFees: { sp_cond: 3000 }, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable && { charge: p.charge, refund: p.refund }).toEqual({ charge: 0, refund: 0 });
  });

  it('배송 대상이 아닌 줄은 그룹 판정에서 빠진다', () => {
    const p = planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_cond', 60000, 1), l('dig', null, 1000, 0, false)] });
    expect(p.adjustable).toBe(true);
  });

  it('스냅샷 없는 배송 방법이 있으면 조정하지 않는다', () => {
    expect(planShipping({ ...base, methods: [m('c', null, 0)], lines: [l('a', 'sp_cond', 30000, 1)] })).toEqual({ adjustable: false, reason: 'NO_SNAPSHOT' });
  });

  it('줄의 배송 프로필이 스냅샷 중 어디에도 맞지 않으면 조정하지 않는다', () => {
    expect(planShipping({ ...base, methods: [m('c', cond, 0)], lines: [l('a', 'sp_moved', 30000, 1)] })).toEqual({ adjustable: false, reason: 'GROUP_MISMATCH' });
  });

  it('직전 부분취소가 더한 «부분취소 배송비» 방법은 그룹 판정에서 빼고 본다', () => {
    const extra: ShippingMethodView = { id: 'x', shippingOptionId: 'so_c', amount: 3000, snapshot: null, isPartialCancelCharge: true };
    const p = planShipping({ ...base, priorGroupFees: { sp_cond: 3000 }, methods: [m('c', cond, 0), extra], lines: [l('a', 'sp_cond', 30000, 1)] });
    expect(p.adjustable).toBe(true);
  });
});
