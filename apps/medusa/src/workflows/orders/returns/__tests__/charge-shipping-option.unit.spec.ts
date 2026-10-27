import { chargeShippingOption } from '../charge-shipping-option';
import type { ShippingMethodView } from '../../partial-cancel/plan-shipping';
import type { ShippingPolicySnapshot } from '../../../../modules/almond-fulfillment/types';

const snap = (profile: string): ShippingPolicySnapshot => ({
  policy: { type: 'flat', baseFee: 3000 },
  shippingGroupCode: profile,
  shippingProfileId: profile,
});
const m = (id: string, snapshot: ShippingPolicySnapshot | null, over: Partial<ShippingMethodView> = {}): ShippingMethodView => ({
  id,
  shippingOptionId: `so_${id}`,
  amount: 3000,
  snapshot,
  isSettlementCharge: false,
  isReturnExchangeOrClaimShipping: false,
  hasAdjustments: false,
  ...over,
});
const lines = [
  { id: 'a', productId: 'p_a' },
  { id: 'b', productId: 'p_b' },
];
const profiles = new Map([
  ['p_a', 'sp_a'],
  ['p_b', 'sp_b'],
]);
const returningB = [{ itemId: 'b', received: 1, dismissed: 0 }];

describe('chargeShippingOption', () => {
  it('반품이 닿은 그룹의 원래 방법 옵션을 고른다', () => {
    expect(chargeShippingOption([m('a', snap('sp_a')), m('b', snap('sp_b'))], lines, profiles, returningB)).toBe('so_b');
  });

  it('스냅샷이 없으면 정산 청구·반품 배송이 아닌 첫 원래 방법으로 돌아간다(보류 차감만 붙는 주문)', () => {
    const methods = [
      m('charge', null, { isSettlementCharge: true }),
      m('ret', null, { isReturnExchangeOrClaimShipping: true }),
      m('orig', null),
    ];
    expect(chargeShippingOption(methods, lines, profiles, returningB)).toBe('so_orig');
  });

  it('닿은 그룹이 없으면(그룹 불일치) 옵션이 있는 첫 원래 방법', () => {
    const methods = [m('none', snap('sp_a'), { shippingOptionId: null }), m('a2', snap('sp_a'))];
    expect(chargeShippingOption(methods, lines, profiles, returningB)).toBe('so_a2');
  });

  it('옵션이 있는 원래 방법이 없으면 null — 호출자가 수령 전에 거절한다', () => {
    const methods = [m('charge', null, { isSettlementCharge: true }), m('orig', null, { shippingOptionId: null })];
    expect(chargeShippingOption(methods, lines, profiles, returningB)).toBeNull();
    expect(chargeShippingOption([], lines, profiles, returningB)).toBeNull();
  });
});
