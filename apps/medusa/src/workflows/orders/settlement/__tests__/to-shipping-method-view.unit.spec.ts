import { toShippingMethodView } from '../load-order-view';

const base = { id: 'sm_1', amount: 2500 };

describe('toShippingMethodView — 반품·교환·클레임 배송 방법 표지', () => {
  it('detail 에 return_id 가 있으면 true', () => {
    expect(toShippingMethodView({ ...base, detail: { return_id: 'x' } }).isReturnExchangeOrClaimShipping).toBe(true);
  });
  it('detail 에 exchange_id 가 있으면 true', () => {
    expect(toShippingMethodView({ ...base, detail: { exchange_id: 'x' } }).isReturnExchangeOrClaimShipping).toBe(true);
  });
  it('detail 에 claim_id 가 있으면 true', () => {
    expect(toShippingMethodView({ ...base, detail: { claim_id: 'x' } }).isReturnExchangeOrClaimShipping).toBe(true);
  });
  it('detail 이 null 이거나 셋 다 비면 false', () => {
    expect(toShippingMethodView({ ...base, detail: null }).isReturnExchangeOrClaimShipping).toBe(false);
    expect(toShippingMethodView({ ...base, detail: { return_id: null, exchange_id: null, claim_id: null } }).isReturnExchangeOrClaimShipping).toBe(false);
  });
});
