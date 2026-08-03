import type { PricingRulesResponseDto } from '../../../core/pricing/dto';

type PricingRule = PricingRulesResponseDto['basePriceRules'][number];

export interface SimplePrices {
  basePrice: number | null;
  membershipPrice: number | null;
  /** variantId → 조합별 오버라이드. 값이 없는 축은 null 이다. */
  variantOverrides: Map<string, { basePrice: number | null; membershipPrice: number | null }>;
}

/**
 * 임포트가 표현할 수 있는 가격 룰의 부분집합인지 판정한다.
 *
 * 임포트는 layer ∈ {base_price, membership_price} × scopeType ∈ {all_variants, variants}
 * × operationType = override 만 만든다(form-export.pricing-judge 와 2단계 빌더가 같은
 * 집합을 쓴다). 그 밖의 룰이 걸린 상품을 프리필해 판매가 한 칸만 고쳐 올리면,
 * ReplacePricingRulesDto 가 **replace** 라 가격 체계가 통째로 뭉개진다.
 * 그래서 밖이면 워크북에 센티넬을 넣어 수정을 막는다.
 */
export function isPricingEditable(rules: PricingRulesResponseDto): boolean {
  if (rules.tieredPriceRules.length > 0) return false;

  const flat = [...rules.basePriceRules, ...rules.membershipPriceRules];
  return flat.every(
    (r) => r.operationType === 'override' && (r.scopeType === 'all_variants' || r.scopeType === 'variants'),
  );
}

/**
 * 표현 가능한 룰에서 워크북에 채울 숫자를 뽑는다. `isPricingEditable` 이 true 인 룰셋에만
 * 부르는 것을 전제한다 — false 인 룰셋에 부르면, with_option 스코프의 option id 들이
 * variant id 로 잘못 기록되고, offset/scale 연산의 값이 override 가격처럼 저장되어,
 * 잘못된 데이터가 워크북에 채워진다.
 */
export function extractSimplePrices(rules: PricingRulesResponseDto): SimplePrices {
  const out: SimplePrices = { basePrice: null, membershipPrice: null, variantOverrides: new Map() };

  const apply = (list: PricingRule[], axis: 'basePrice' | 'membershipPrice'): void => {
    // order 순으로 훑어 뒤 룰이 앞 룰을 덮게 한다 — 계산기의 적용 순서와 같다.
    for (const r of [...list].sort((a, b) => a.order - b.order)) {
      if (r.scopeType === 'all_variants') {
        out[axis] = r.operationValue;
        // all_variants 룰은 모든 variant 에 매칭하므로, 앞서 적용된 per-variant 오버라이드를
        // 모두 무효화한다 — all_variants 가 뒤의 variant 값들을 덮는다.
        for (const entry of out.variantOverrides.values()) {
          entry[axis] = null;
        }
        continue;
      }
      for (const variantId of r.scopeTargetIds ?? []) {
        const prev = out.variantOverrides.get(variantId) ?? { basePrice: null, membershipPrice: null };
        out.variantOverrides.set(variantId, { ...prev, [axis]: r.operationValue });
      }
    }
  };

  apply(rules.basePriceRules, 'basePrice');
  apply(rules.membershipPriceRules, 'membershipPrice');
  return out;
}
