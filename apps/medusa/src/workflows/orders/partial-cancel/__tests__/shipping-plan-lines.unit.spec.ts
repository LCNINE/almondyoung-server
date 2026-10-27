import type { OrderLine } from '../plan-partial-cancel';
import { planShipping, type ShippingMethodView } from '../plan-shipping';
import { shippingPlanLines } from '../shipping-plan-lines';
import type { ShippingPolicySnapshot } from '../../../../modules/almond-fulfillment/types';

const cond: ShippingPolicySnapshot = { policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000 }, shippingGroupCode: 'c', shippingProfileId: 'sp' };
const line = (id: string, quantity: number, returnedQuantity: number): OrderLine => ({
  id, quantity, unitPrice: id === 'c' ? 10000 : 30000, productId: `p_${id}`, requiresShipping: true,
  fulfilledQuantity: 0, returnedQuantity, adjustments: [],
});
const profiles = new Map([['p_a', 'sp'], ['p_b', 'sp'], ['p_c', 'sp']]);
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
});
