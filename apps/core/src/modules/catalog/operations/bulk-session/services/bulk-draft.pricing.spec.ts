import { applyPriceChanges, toReplaceDto } from './bulk-draft.pricing';
import type { SimplePrices } from './form-export.pricing-judge';

const empty = (): SimplePrices => ({ basePrice: null, membershipPrice: null, variantOverrides: new Map() });

describe('applyPriceChanges', () => {
  it('상품 판매가·멤버십가 변경을 얹는다', () => {
    const current: SimplePrices = { basePrice: 10000, membershipPrice: 9000, variantOverrides: new Map() };
    const { prices, errors } = applyPriceChanges(current, { 'product.basePrice': '12000' }, new Map());

    expect(errors).toEqual([]);
    expect(prices.basePrice).toBe(12000);
    // 안 건드린 축은 현재 값이 그대로 살아남는다 — 이것이 "재조립이 무손실"인 이유다.
    expect(prices.membershipPrice).toBe(9000);
  });

  it('조합별 가격을 variantId 로 옮긴다', () => {
    const { prices, errors } = applyPriceChanges(
      empty(),
      { 'variant:ov-1+ov-2.basePrice': '15000' },
      new Map([['ov-1+ov-2', 'variant-a']]),
    );

    expect(errors).toEqual([]);
    expect(prices.variantOverrides.get('variant-a')).toEqual({ basePrice: 15000, membershipPrice: null });
  });

  it('빈칸은 그 축의 오버라이드를 해제한다', () => {
    const current: SimplePrices = {
      basePrice: 10000,
      membershipPrice: null,
      variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
    };
    const { prices } = applyPriceChanges(current, { 'variant:ov-1.basePrice': '' }, new Map([['ov-1', 'variant-a']]));

    expect(prices.variantOverrides.get('variant-a')?.basePrice).toBeNull();
  });

  it('조합을 variant 로 풀 수 없으면 행 오류다', () => {
    const { errors } = applyPriceChanges(empty(), { 'variant:없는조합.basePrice': '1' }, new Map());

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('없는조합');
  });
});

describe('toReplaceDto', () => {
  it('all_variants 룰을 order 1 로 두고 조합 룰을 뒤에 붙인다', () => {
    const dto = toReplaceDto({
      basePrice: 10000,
      membershipPrice: 9000,
      variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
    });

    expect(dto.basePriceRules).toEqual([
      { layer: 'base_price', order: 1, scopeType: 'all_variants', operationType: 'override', operationValue: 10000 },
      {
        layer: 'base_price',
        order: 2,
        scopeType: 'variants',
        scopeTargetIds: ['variant-a'],
        operationType: 'override',
        operationValue: 15000,
      },
    ]);
    expect(dto.membershipPriceRules).toHaveLength(1);
    expect(dto.tieredPriceRules).toEqual([]);
  });

  it('상품 판매가가 없으면 조합 룰만으로 DTO 를 만들지 않는다', () => {
    // pricingRulesSetSchema 제약: order 1 인 첫 base_price 룰은 all_variants 여야 한다
    // (product-import-pricing.builder.ts:9-10). 상품 판매가 없이 조합 룰만 있으면 그 제약을
    // 어기므로 여기서 막는다 — 안 막으면 replaceVersionRules 가 400 을 내고 행이 죽는다.
    expect(() =>
      toReplaceDto({
        basePrice: null,
        membershipPrice: null,
        variantOverrides: new Map([['variant-a', { basePrice: 15000, membershipPrice: null }]]),
      }),
    ).toThrow();
  });
});
