import type { OrderLine } from '../plan-partial-cancel';
import { planShipping, type ShippingMethodView } from '../plan-shipping';
import { shippingPlanLines, shippingRefundFloorLines } from '../shipping-plan-lines';
import type { ShippingPolicySnapshot } from '../../../../modules/almond-fulfillment/types';

const cond: ShippingPolicySnapshot = { policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000 }, shippingGroupCode: 'c', shippingProfileId: 'sp' };
const flat: ShippingPolicySnapshot = { policy: { type: 'flat', baseFee: 3000 }, shippingGroupCode: 'f', shippingProfileId: 'sp' };
const line = (id: string, quantity: number, returnedQuantity: number): OrderLine => ({
  id, quantity, unitPrice: id === 'c' || id === 'e' ? 10000 : 30000, productId: `p_${id}`, requiresShipping: true,
  fulfilledQuantity: 0, returnedQuantity, adjustments: [],
});
const profiles = new Map([['p_a', 'sp'], ['p_b', 'sp'], ['p_c', 'sp'], ['p_e', 'sp']]);
const method: ShippingMethodView = { id: 'm', shippingOptionId: 'so', amount: 0, snapshot: cond, isSettlementCharge: false, isReturnExchangeOrClaimShipping: false, hasAdjustments: false };

describe('shippingPlanLines', () => {
  const lines = [line('a', 1, 1), line('b', 1, 0), line('c', 1, 0)];

  it('돌아온 수량을 빼서 남는 수량으로 판정한다 — 반품이 올린 그룹 요금을 부분취소가 되돌려 주지 않는다', () => {
    const view = shippingPlanLines(lines, new Map([['c', 0]]), profiles);
    expect(view.map((v) => v.newQty)).toEqual([0, 1, 0]);
    const plan = planShipping({ methods: [method], lines: view, postalCode: '04524', priorGroupFees: { sp: 3000 }, chargeCap: 1_000_000 });
    expect(plan).toMatchObject({ adjustable: true, charge: 0, refund: 0 });
  });

  it('빼지 않으면 환불이 생기는 경우의 대조 — 돌아온 수량을 무시하면 3,000 을 돌려준다', () => {
    const naive = lines.map((l) => ({ ...l, returnedQuantity: 0 }));
    const view = shippingPlanLines(naive, new Map([['c', 0]]), profiles);
    const plan = planShipping({ methods: [method], lines: view, postalCode: '04524', priorGroupFees: { sp: 3000 }, chargeCap: 1_000_000 });
    expect(plan).toMatchObject({ refund: 3000 });
  });

  it('0 아래로 내려가지 않는다', () => {
    expect(shippingPlanLines([line('a', 1, 2)], new Map(), profiles)[0].newQty).toBe(0);
  });

  /** 부분취소의 판정 그대로: 청구는 돌아온 수량을 뺀 줄로, 환불은 돌아온 수량을 «남아 있는» 것으로 센 요금 아래로 내려가지 않는다 */
  const plan = (ls: OrderLine[], cancel: Map<string, number>, m: ShippingMethodView, priorGroupFees: Record<string, number>) =>
    planShipping({
      methods: [m],
      lines: shippingPlanLines(ls, cancel, profiles),
      refundFloorLines: shippingRefundFloorLines(ls, cancel, profiles),
      postalCode: '04524',
      priorGroupFees,
      chargeCap: 1_000_000,
    });

  it('A 배송·반품 뒤 미출고 E 부분취소 — 줄이 다 비어도 A 의 출고 배송비는 쓴 것이라 돌려주지 않는다', () => {
    // A 30,000 + E 10,000 = 40,000 < 50,000 → 3,000 을 냈다. A 반품이 그룹 요금을 그대로 두고(깨짐 0), E 를 취소한다
    const ls = [line('a', 1, 1), line('e', 1, 0)];
    expect(shippingRefundFloorLines(ls, new Map([['e', 0]]), profiles).map((v) => v.newQty)).toEqual([1, 0]);
    const p = plan(ls, new Map([['e', 0]]), { ...method, amount: 3000 }, {});
    expect(p).toMatchObject({ adjustable: true, charge: 0, refund: 0 });
    expect(p.adjustable && p.groups[0]).toMatchObject({ currentFee: 3000, newFee: 0, recordedFee: 3000 });
  });

  it('반품 정산이 그룹 요금을 올려 둔 뒤에도 같다 — 깨짐 3,000 을 부분취소가 되돌려 주지 않는다', () => {
    const p = plan([line('a', 1, 1), line('e', 1, 0)], new Map([['e', 0]]), method, { sp: 3000 });
    expect(p).toMatchObject({ adjustable: true, charge: 0, refund: 0 });
  });

  it('고정 그룹도 같다 — A 가 나갔으니 출고 배송비 3,000 은 돌려주지 않는다', () => {
    const p = plan([line('a', 1, 1), line('e', 1, 0)], new Map([['e', 0]]), { ...method, amount: 3000, snapshot: flat }, {});
    expect(p).toMatchObject({ adjustable: true, charge: 0, refund: 0 });
  });

  it('청구는 여전히 돌아온 수량을 뺀다 — A 반품·B 남음·C 취소는 청구 0, 환불 0', () => {
    const p = plan([line('a', 1, 1), line('b', 1, 0), line('c', 1, 0)], new Map([['c', 0]]), method, { sp: 3000 });
    expect(p).toMatchObject({ adjustable: true, charge: 0, refund: 0 });
  });

  it('반품이 없는 주문은 바닥 줄을 줘도 판정이 같다', () => {
    const ls = [line('a', 1, 0), line('b', 1, 0)];
    const cancel = new Map([['b', 0]]);
    const without = planShipping({ methods: [method], lines: shippingPlanLines(ls, cancel, profiles), postalCode: '04524', priorGroupFees: {}, chargeCap: 1_000_000 });
    expect(plan(ls, cancel, method, {})).toEqual(without);
    expect(without).toMatchObject({ charge: 3000, refund: 0 });
  });
});
