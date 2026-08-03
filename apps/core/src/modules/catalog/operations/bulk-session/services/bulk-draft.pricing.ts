import { BadRequestError } from '@app/shared';
import { parseFieldPath } from './bulk-session.fields';
import type { SimplePrices } from './form-export.pricing-judge';
import type { ReplacePricingRulesDto } from '../../../core/pricing/dto';
import type { FlatFields, RowError } from './bulk-session.types';

/**
 * 워크북 가격 칸 → 가격 룰 DTO 변환기. 순수 함수만 담는다 — DB 를 타지 않는다.
 *
 * 임포트가 표현할 수 있는 건 전체 가격 룰 축의 진부분집합이다: layer ∈ {base_price,
 * membership_price} × scopeType ∈ {all_variants, variants} × operationType = override.
 * `extractSimplePrices`(form-export.pricing-judge.ts) 가 그 부분집합을 `SimplePrices` 로
 * 뽑고, 여기서는 그 위에 워크북 변경분을 얹은 뒤(`applyPriceChanges`) 다시 룰 DTO 로
 * 조립한다(`toReplaceDto`).
 */

/** 가격 칸 값 파싱: 빈 문자열은 그 축의 오버라이드 해제(null), 그 외는 숫자. */
function parsePriceCell(raw: string): number | null {
  return raw === '' ? null : Number(raw);
}

/** `SimplePrices` 를 깊은 복사한다 — `variantOverrides` 는 Map 이라 얕은 복사로 부족하다. */
function cloneSimplePrices(current: SimplePrices): SimplePrices {
  const variantOverrides = new Map<string, { basePrice: number | null; membershipPrice: number | null }>();
  for (const [variantId, entry] of current.variantOverrides) {
    variantOverrides.set(variantId, { ...entry });
  }
  return { basePrice: current.basePrice, membershipPrice: current.membershipPrice, variantOverrides };
}

/**
 * 현재 가격(`current`)에 워크북 변경 칸(`fields`)을 얹어 새 `SimplePrices` 를 만든다.
 *
 * `current` 를 변형하지 않는다 — 복사에서 시작한다. 호출부가 이 행을 재시도할 때 같은
 * `current` 객체를 다시 넘기기 때문이다.
 *
 * `product.basePrice`/`product.membershipPrice` 는 상품 축을, `variant:<조합>.basePrice`/
 * `.membershipPrice` 는 `variantIdByCombo` 로 푼 variantId 축을 덮는다. 빈 문자열은 해제
 * (`null`), 그 외는 숫자로 담는다.
 */
export function applyPriceChanges(
  current: SimplePrices,
  fields: FlatFields,
  variantIdByCombo: ReadonlyMap<string, string>,
): { prices: SimplePrices; errors: RowError[] } {
  const prices = cloneSimplePrices(current);
  const errors: RowError[] = [];

  for (const path of Object.keys(fields)) {
    if (path === 'product.basePrice') {
      prices.basePrice = parsePriceCell(fields[path] ?? '');
      continue;
    }
    if (path === 'product.membershipPrice') {
      prices.membershipPrice = parsePriceCell(fields[path] ?? '');
      continue;
    }

    const parsed = parseFieldPath(path);
    if (!parsed || parsed.scope !== 'variant') continue;
    if (parsed.key !== 'basePrice' && parsed.key !== 'membershipPrice') continue;

    const variantId = variantIdByCombo.get(parsed.scopeKey);
    if (!variantId) {
      errors.push({
        sheet: '조합',
        rowNumber: 0,
        message: `조합에 해당하는 variant 를 찾을 수 없습니다: ${parsed.scopeKey}`,
      });
      continue;
    }

    const prev = prices.variantOverrides.get(variantId) ?? { basePrice: null, membershipPrice: null };
    const value = parsePriceCell(fields[path] ?? '');
    if (parsed.key === 'basePrice') {
      prices.variantOverrides.set(variantId, { ...prev, basePrice: value });
    } else {
      prices.variantOverrides.set(variantId, { ...prev, membershipPrice: value });
    }
  }

  return { prices, errors };
}

/**
 * `SimplePrices` → `ReplacePricingRulesDto`. `product-import-pricing.builder.ts:19-75` 의
 * 조립 순서를 그대로 따른다 — **이식이지 재사용이 아니다**(6단계가 그 파일을 통째로 지운다).
 *
 * `replaceVersionRules` 가 **replace** 이므로 변경분만 넘길 수 없다 — 매번 전체 룰셋을
 * 재조립해야 한다.
 *
 * `pricingRulesSetSchema` 제약: order 1 인 첫 base_price 룰은 scopeType 이 all_variants
 * 여야 한다. `basePrice` 가 null 인데 조합 오버라이드가 있으면(또는 오버라이드가 없어도)
 * all_variants 룰을 만들 수 없어 그 제약을 어기므로 여기서 막는다.
 */
export function toReplaceDto(prices: SimplePrices): ReplacePricingRulesDto {
  if (prices.basePrice === null) {
    throw new BadRequestError('상품 판매가가 없어 가격 규칙을 만들 수 없습니다.');
  }

  const basePriceRules: ReplacePricingRulesDto['basePriceRules'] = [
    {
      layer: 'base_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: prices.basePrice,
    },
  ];
  const membershipPriceRules: ReplacePricingRulesDto['membershipPriceRules'] = [];

  if (prices.membershipPrice !== null) {
    membershipPriceRules.push({
      layer: 'membership_price',
      order: 1,
      scopeType: 'all_variants',
      operationType: 'override',
      operationValue: prices.membershipPrice,
    });
  }

  let baseOrder = 2;
  let memberOrder = membershipPriceRules.length + 1;

  for (const [variantId, override] of prices.variantOverrides) {
    if (override.basePrice !== null) {
      basePriceRules.push({
        layer: 'base_price',
        order: baseOrder++,
        scopeType: 'variants',
        scopeTargetIds: [variantId],
        operationType: 'override',
        operationValue: override.basePrice,
      });
    }
    if (override.membershipPrice !== null) {
      membershipPriceRules.push({
        layer: 'membership_price',
        order: memberOrder++,
        scopeType: 'variants',
        scopeTargetIds: [variantId],
        operationType: 'override',
        operationValue: override.membershipPrice,
      });
    }
  }

  return { basePriceRules, membershipPriceRules, tieredPriceRules: [] };
}
