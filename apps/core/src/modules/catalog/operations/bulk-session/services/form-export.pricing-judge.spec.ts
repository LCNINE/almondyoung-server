import { isPricingEditable, extractSimplePrices } from './form-export.pricing-judge';
import type { PricingRulesResponseDto } from '../../../core/pricing/dto';

type Rule = PricingRulesResponseDto['basePriceRules'][number];

const rule = (over: Partial<Rule>): Rule =>
  ({
    id: 'r1',
    layer: 'base_price',
    order: 1,
    scopeType: 'all_variants',
    scopeTargetIds: null,
    operationType: 'override',
    operationValue: 29000,
    ...over,
  }) as Rule;

const rules = (over: Partial<PricingRulesResponseDto> = {}): PricingRulesResponseDto => ({
  basePriceRules: [],
  membershipPriceRules: [],
  tieredPriceRules: [],
  ...over,
});

describe('isPricingEditable', () => {
  it('룰이 하나도 없으면 표현 가능하다', () => {
    expect(isPricingEditable(rules())).toBe(true);
  });

  it('all_variants override 하나면 표현 가능하다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({})] }))).toBe(true);
  });

  it('variants override 가 섞여도 표현 가능하다', () => {
    const r = rules({
      basePriceRules: [rule({}), rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1'] })],
    });
    expect(isPricingEditable(r)).toBe(true);
  });

  it('tiered_price 룰이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ tieredPriceRules: [rule({ layer: 'tiered_price' })] }))).toBe(false);
  });

  it('with_option 스코프가 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({ scopeType: 'with_option' })] }))).toBe(false);
  });

  it('scale 연산이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ basePriceRules: [rule({ operationType: 'scale' })] }))).toBe(false);
  });

  it('offset 연산이 있으면 표현 불가다', () => {
    expect(isPricingEditable(rules({ membershipPriceRules: [rule({ operationType: 'offset' })] }))).toBe(false);
  });
});

describe('extractSimplePrices', () => {
  it('all_variants override 를 기본가로 뽑는다', () => {
    const r = rules({
      basePriceRules: [rule({ operationValue: 29000 })],
      membershipPriceRules: [rule({ layer: 'membership_price', operationValue: 26000 })],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.membershipPrice).toBe(26000);
  });

  it('variants 스코프는 variantId 별 오버라이드로 뽑는다', () => {
    const r = rules({
      basePriceRules: [
        rule({ operationValue: 29000 }),
        rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1', 'v2'], operationValue: 31000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.variantOverrides.get('v1')?.basePrice).toBe(31000);
    expect(out.variantOverrides.get('v2')?.basePrice).toBe(31000);
  });

  it('기본가 룰이 없으면 null 이다', () => {
    expect(extractSimplePrices(rules()).basePrice).toBeNull();
  });

  it('all_variants 룰이 later order 에서 variants 를 덮는다', () => {
    // Repro: all_variants 가 나중에 오면 앞서 적용된 per-variant 를 무효화한다.
    // Calculator 는 order 순으로 규칙을 적용하므로:
    // 1. order:1 variants v1=31000
    // 2. order:2 all_variants=29000 (v1 에도 매칭, 따라서 31000 을 덮음)
    // v1 의 최종 가격은 29000 이어야 한다.
    const r = rules({
      basePriceRules: [
        rule({ id: 'r1', order: 1, scopeType: 'variants', scopeTargetIds: ['v1'], operationValue: 31000 }),
        rule({ id: 'r2', order: 2, scopeType: 'all_variants', operationValue: 29000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.variantOverrides.get('v1')?.basePrice).toBeNull();
  });

  it('variants 규칙 어레이 순서가 order 를 따르지 않아도 order 로 정렬한다', () => {
    // Array 순서와 무관하게 order field 로 정렬해야 한다.
    const r = rules({
      basePriceRules: [
        // Array: v2=order:2 먼저, then all_variants order:1
        rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v2'], operationValue: 32000 }),
        rule({ id: 'r1', order: 1, scopeType: 'all_variants', operationValue: 29000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    // order 로 정렬되므로: order:1 (all_variants=29000) → order:2 (v2=32000)
    // v2 는 뒤의 variants 규칙 (order:2) 으로 덮여 32000 이다.
    expect(out.variantOverrides.get('v2')?.basePrice).toBe(32000);
  });

  it('all_variants 이후의 variants 룰은 여전히 오버라이드한다', () => {
    // all_variants (order:1) 후 variants (order:2) 이면 variants 가 이기는가?
    // order 가 정렬의 기준이므로 order:1 → order:2 순이다.
    // order:2 가 v1 을 다시 매칭한다면 v1 의 가격을 바꾼다.
    const r = rules({
      basePriceRules: [
        rule({ id: 'r1', order: 1, scopeType: 'all_variants', operationValue: 29000 }),
        rule({ id: 'r2', order: 2, scopeType: 'variants', scopeTargetIds: ['v1'], operationValue: 31000 }),
      ],
    });
    const out = extractSimplePrices(r);
    expect(out.basePrice).toBe(29000);
    expect(out.variantOverrides.get('v1')?.basePrice).toBe(31000);
  });
});
