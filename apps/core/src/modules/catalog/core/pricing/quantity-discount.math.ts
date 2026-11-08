import type { QuantityDiscountOverride, QuantityDiscountTier, TieredPriceInfo } from '../../catalog.types';

export const MAX_QUANTITY_DISCOUNT_TIERS = 5;
const BP_PER_PERCENT = 100;
const BP_WHOLE = 10000;

export type QuantityDiscountViolationCode =
  | 'EMPTY_TIERS'
  | 'TOO_MANY_TIERS'
  | 'MIN_QUANTITY_INVALID'
  | 'MIN_QUANTITY_DUPLICATE'
  | 'RATE_OUT_OF_RANGE'
  | 'RATE_BOTH_ZERO'
  | 'RATE_NOT_INCREASING'
  | 'OVERRIDE_DUPLICATE'
  | 'MEMBER_PRICE_ABOVE_REGULAR'
  | 'PERIOD_REVERSED'
  | 'PERIOD_INVALID_DATE';

export interface QuantityDiscountViolation {
  code: QuantityDiscountViolationCode;
  tierIndex?: number;
  variantId?: string;
  /** 위반이 옵션 예외 표에서 났으면 그 옵션의 조합 키. */
  combination?: string;
  regularPrice?: number;
  membershipPrice?: number;
}

export interface VariantPriceBasis {
  variantId: string;
  basePrice: number;
  membershipPrice: number;
  /** 옵션값 id 정렬 «+» 결합. 없으면 기본 표만 본다. */
  combination?: string;
}

/** 표의 모양만(기간·켜기 제외). 옵션별 실제 표를 고르고 문장을 만들 때 쓴다. */
export interface QuantityDiscountTable {
  tiers: QuantityDiscountTier[];
  variantOverrides?: QuantityDiscountOverride[];
}

export function floor10(x: number): number {
  return Math.floor(x / 10) * 10;
}

export function discountedPrice(price: number, rateBp: number): number {
  return floor10(Math.floor((price * (BP_WHOLE - rateBp)) / BP_WHOLE));
}

export function sortTiers(tiers: QuantityDiscountTier[]): QuantityDiscountTier[] {
  return [...tiers].sort((a, b) => a.minQuantity - b.minQuantity);
}

/** 그 옵션이 실제로 쓰는 구간. 예외가 있으면 예외(비었으면 할인 없음), 없으면 기본 표. */
export function tiersForCombination(table: QuantityDiscountTable, combination: string | undefined): QuantityDiscountTier[] {
  if (combination === undefined) return table.tiers;
  const override = table.variantOverrides?.find((o) => o.combination === combination);
  return override ? override.tiers : table.tiers;
}

/** 기본 표도 비었고 할인을 주는 예외도 없으면 «표 없음»이다. */
export function isEmptyQuantityDiscount(table: QuantityDiscountTable): boolean {
  return table.tiers.length === 0 && !(table.variantOverrides ?? []).some((o) => o.tiers.length > 0);
}

export function buildTierPrices(input: {
  basePrice: number;
  membershipPrice: number;
  tiers: QuantityDiscountTier[];
}): { regular: TieredPriceInfo[]; membership: TieredPriceInfo[] } {
  const tiers = sortTiers(input.tiers);
  return {
    regular: tiers.map((t) => ({ minQuantity: t.minQuantity, price: discountedPrice(input.basePrice, t.regularRateBp) })),
    membership: tiers.map((t) => ({
      minQuantity: t.minQuantity,
      price: discountedPrice(input.membershipPrice, t.membershipRateBp),
    })),
  };
}

/** 쇼핑몰에 내보낼 구간가. 0% 인 대상은 그 구간가를 만들지 않는다 — 한쪽 대상만 할인하는 구간이다. */
export function buildSaleTierPrices(input: {
  basePrice: number;
  membershipPrice: number;
  tiers: QuantityDiscountTier[];
}): { regular: TieredPriceInfo[]; membership: TieredPriceInfo[] } {
  const regular = input.tiers.filter((t) => t.regularRateBp > 0);
  const membership = input.tiers.filter((t) => t.membershipRateBp > 0);
  return {
    regular: buildTierPrices({ ...input, tiers: regular }).regular,
    membership: buildTierPrices({ ...input, tiers: membership }).membership,
  };
}

/** YYYY-MM-DD 이고 달력에 실제로 있는 날인가(2월 30일·13월 거부, 윤년 2월 29일 허용). */
function isCalendarDate(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isWholePercentRate(bp: number): boolean {
  return Number.isInteger(bp) && bp % BP_PER_PERCENT === 0 && bp >= 0 && bp < BP_WHOLE;
}

/** 열 하나에서 0 이 아닌 값은 앞의 0 이 아닌 값보다 커야 한다. 0 은 첫 양수 앞에만 올 수 있다. */
function breaksIncrease(previous: number[], current: number): boolean {
  const lastPositive = [...previous].reverse().find((r) => r > 0);
  if (lastPositive === undefined) return false;
  return current <= lastPositive;
}

function validateTierList(
  list: QuantityDiscountTier[],
  combination: string | undefined,
  push: (v: QuantityDiscountViolation) => void,
): void {
  const at = (v: QuantityDiscountViolation): QuantityDiscountViolation =>
    combination === undefined ? v : { ...v, combination };
  const tiers = sortTiers(list);

  if (tiers.length > MAX_QUANTITY_DISCOUNT_TIERS) push(at({ code: 'TOO_MANY_TIERS' }));

  tiers.forEach((t, tierIndex) => {
    if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2) push(at({ code: 'MIN_QUANTITY_INVALID', tierIndex }));
    if (tierIndex > 0 && tiers[tierIndex - 1].minQuantity === t.minQuantity) {
      push(at({ code: 'MIN_QUANTITY_DUPLICATE', tierIndex }));
    }
    const ratesValid = isWholePercentRate(t.regularRateBp) && isWholePercentRate(t.membershipRateBp);
    if (!ratesValid) push(at({ code: 'RATE_OUT_OF_RANGE', tierIndex }));
    else if (t.regularRateBp === 0 && t.membershipRateBp === 0) push(at({ code: 'RATE_BOTH_ZERO', tierIndex }));
    const before = tiers.slice(0, tierIndex);
    if (
      breaksIncrease(before.map((p) => p.regularRateBp), t.regularRateBp) ||
      breaksIncrease(before.map((p) => p.membershipRateBp), t.membershipRateBp)
    ) {
      push(at({ code: 'RATE_NOT_INCREASING', tierIndex }));
    }
  });
}

export function validateQuantityDiscount(
  input: QuantityDiscountTable & { startsOn: string | null; endsOn: string | null },
  variants: VariantPriceBasis[],
): QuantityDiscountViolation[] {
  if (isEmptyQuantityDiscount(input)) {
    return [{ code: 'EMPTY_TIERS' }];
  }

  const violations: QuantityDiscountViolation[] = [];
  const push = (v: QuantityDiscountViolation) => violations.push(v);
  const overrides = input.variantOverrides ?? [];

  validateTierList(input.tiers, undefined, push);

  const seen = new Set<string>();
  for (const override of overrides) {
    if (seen.has(override.combination)) {
      push({ code: 'OVERRIDE_DUPLICATE', combination: override.combination });
      continue;
    }
    seen.add(override.combination);
    validateTierList(override.tiers, override.combination, push);
  }

  const invalidDay = [input.startsOn, input.endsOn].some((day) => day !== null && !isCalendarDate(day));
  if (invalidDay) {
    push({ code: 'PERIOD_INVALID_DATE' });
  } else if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    push({ code: 'PERIOD_REVERSED' });
  }

  for (const v of variants) {
    const overridden = v.combination !== undefined && overrides.some((o) => o.combination === v.combination);
    const tiers = sortTiers(tiersForCombination(input, v.combination));
    tiers.forEach((t, tierIndex) => {
      const regularPrice = discountedPrice(v.basePrice, t.regularRateBp);
      const membershipPrice = discountedPrice(v.membershipPrice, t.membershipRateBp);
      if (membershipPrice > regularPrice) {
        push({
          code: 'MEMBER_PRICE_ABOVE_REGULAR',
          tierIndex,
          variantId: v.variantId,
          ...(overridden ? { combination: v.combination } : {}),
          regularPrice,
          membershipPrice,
        });
      }
    });
  }

  return violations;
}

const won = (n: number | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

export function describeQuantityDiscountViolation(
  v: QuantityDiscountViolation,
  table: QuantityDiscountTable,
  optionName: (combination: string) => string = () => '옵션 예외',
): string {
  const sortedTiers = sortTiers(tiersForCombination(table, v.combination));
  const at = v.tierIndex === undefined ? undefined : sortedTiers[v.tierIndex]?.minQuantity;
  const tierLabel = at === undefined ? '한 구간' : `${at}개 이상 구간`;
  const prefix = v.combination === undefined ? '' : `${optionName(v.combination)}: `;
  return prefix + violationSentence(v, tierLabel);
}

function violationSentence(v: QuantityDiscountViolation, tierLabel: string): string {
  switch (v.code) {
    case 'EMPTY_TIERS':
      return '구간을 하나 이상 넣어 주세요.';
    case 'TOO_MANY_TIERS':
      return `구간은 최대 ${MAX_QUANTITY_DISCOUNT_TIERS}개까지 넣을 수 있습니다.`;
    case 'MIN_QUANTITY_INVALID':
      return '최소 수량은 2 이상 정수로 넣어 주세요.';
    case 'MIN_QUANTITY_DUPLICATE':
      return '같은 최소 수량이 두 번 있습니다.';
    case 'RATE_OUT_OF_RANGE':
      return `${tierLabel}의 할인율은 0~99 사이 정수 %로 넣어 주세요.`;
    case 'RATE_BOTH_ZERO':
      return `${tierLabel}은 일반·멤버십 중 하나는 할인율이 있어야 합니다.`;
    case 'RATE_NOT_INCREASING':
      return `${tierLabel}의 %가 앞 구간보다 커야 합니다.`;
    case 'OVERRIDE_DUPLICATE':
      return '같은 옵션의 예외가 두 번 있습니다.';
    case 'MEMBER_PRICE_ABOVE_REGULAR':
      return `${tierLabel}에서 멤버십 회원가 ${won(v.membershipPrice)}이 일반가 ${won(v.regularPrice)}보다 비쌉니다. 멤버십 %를 올리거나 정가·멤버십가를 확인해 주세요.`;
    case 'PERIOD_REVERSED':
      return '시작일이 종료일보다 늦습니다.';
    case 'PERIOD_INVALID_DATE':
      return '달력에 없는 날짜입니다.';
  }
}

/** 관리자 화면·일괄 발행 결과에 그대로 보여 줄 한 문장. 첫 이유를 쓰고 나머지는 건수로 붙인다. */
export function quantityDiscountErrorMessage(
  violations: QuantityDiscountViolation[],
  table: QuantityDiscountTable,
  optionName?: (combination: string) => string,
): string {
  const [first, ...rest] = violations;
  const head = `수량 할인 표와 맞지 않습니다: ${describeQuantityDiscountViolation(first, table, optionName)}`;
  return rest.length > 0 ? `${head} (외 ${rest.length}건)` : head;
}
