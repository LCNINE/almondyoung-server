import { buildPricingContext } from '../pricing-context';

const makeReq = (pricingContext?: Record<string, unknown>) =>
  ({ ...(pricingContext ? { pricingContext } : {}) }) as any;

describe('buildPricingContext', () => {
  it('코어 컨텍스트가 없으면 라우트 기본값을 쓴다', () => {
    expect(buildPricingContext(makeReq(), { currency_code: 'krw' })).toEqual({
      currency_code: 'krw',
    });
  });

  it('코어가 채운 값이 기본값을 이긴다', () => {
    const context = buildPricingContext(makeReq({ currency_code: 'jpy', region_id: 'reg_jp' }), {
      currency_code: 'krw',
    });

    expect(context).toEqual({ currency_code: 'jpy', region_id: 'reg_jp' });
  });

  it('세그먼트만 채워진 컨텍스트에도 라우트 기본값(region/통화)이 남는다', () => {
    // region_id 가 빠지면 멤버십 price list 가 비회원에게도 적용된다.
    const context = buildPricingContext(makeReq({ customer: { groups: [{ id: 'g_1' }] } }), {
      currency_code: 'krw',
      region_id: 'reg_kr',
    });

    expect(context).toEqual({
      currency_code: 'krw',
      region_id: 'reg_kr',
      customer: { groups: [{ id: 'g_1' }] },
    });
  });

  it('세그먼트만 채워진 컨텍스트에도 통화가 남는다', () => {
    // 이 라우트엔 코어 setPricingContext 가 안 붙는다. 예전 `?? 기본값` 은 세그먼트가
    // 고객 그룹만 넣어두면 통째로 죽어서 멤버십 회원만 가격이 null 이 됐다.
    const context = buildPricingContext(makeReq({ customer: { groups: [{ id: 'g_1' }] } }), {
      currency_code: 'krw',
    });

    expect(context).toEqual({
      currency_code: 'krw',
      customer: { groups: [{ id: 'g_1' }] },
    });
  });
});
