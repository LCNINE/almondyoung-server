import { buildPricingContext } from '../pricing-context';

describe('buildPricingContext', () => {
  it('비회원 컨텍스트에도 currency_code 외의 값이 남는다', () => {
    const context = buildPricingContext({
      currencyCode: 'krw',
      regionId: 'reg_1',
      customerGroupIds: [],
    });

    // currency_code 는 pricing 모듈이 매칭 전에 제거한다. 이것만 남으면 rule 매칭이
    // 통째로 건너뛰어져 멤버십 price list 가 비회원에게 적용된다.
    const { currency_code: _currencyCode, ...matchable } = context;
    expect(Object.keys(matchable)).toEqual(['region_id']);
    expect(context.customer).toBeUndefined();
  });

  it('회원이면 customer group 이 실린다', () => {
    const context = buildPricingContext({
      currencyCode: 'krw',
      regionId: 'reg_1',
      customerGroupIds: ['cusgroup_member', 'cusgroup_vip'],
    });

    expect(context.customer).toEqual({
      groups: [{ id: 'cusgroup_member' }, { id: 'cusgroup_vip' }],
    });
  });
});
