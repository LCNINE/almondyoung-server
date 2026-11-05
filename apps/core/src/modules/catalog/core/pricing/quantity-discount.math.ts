import type { QuantityDiscountTier, TieredPriceInfo } from '../../catalog.types';

export const MAX_QUANTITY_DISCOUNT_TIERS = 5;
const BP_PER_PERCENT = 100;
const BP_WHOLE = 10000;

export type QuantityDiscountViolationCode =
  | 'EMPTY_TIERS'
  | 'TOO_MANY_TIERS'
  | 'MIN_QUANTITY_INVALID'
  | 'MIN_QUANTITY_DUPLICATE'
  | 'RATE_OUT_OF_RANGE'
  | 'RATE_NOT_INCREASING'
  | 'MEMBER_PRICE_ABOVE_REGULAR'
  | 'PERIOD_REVERSED'
  | 'PERIOD_INVALID_DATE';

export interface QuantityDiscountViolation {
  code: QuantityDiscountViolationCode;
  tierIndex?: number;
  variantId?: string;
  regularPrice?: number;
  membershipPrice?: number;
}

export interface VariantPriceBasis {
  variantId: string;
  basePrice: number;
  membershipPrice: number;
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

/** YYYY-MM-DD 이고 달력에 실제로 있는 날인가(2월 30일·13월 거부, 윤년 2월 29일 허용). */
function isCalendarDate(day: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isWholePercentRate(bp: number): boolean {
  return Number.isInteger(bp) && bp % BP_PER_PERCENT === 0 && bp > 0 && bp < BP_WHOLE;
}

export function validateQuantityDiscount(
  input: { tiers: QuantityDiscountTier[]; startsOn: string | null; endsOn: string | null },
  variants: VariantPriceBasis[],
): QuantityDiscountViolation[] {
  if (input.tiers.length === 0) {
    return [{ code: 'EMPTY_TIERS' }];
  }

  const violations: QuantityDiscountViolation[] = [];
  const tiers = sortTiers(input.tiers);

  if (tiers.length > MAX_QUANTITY_DISCOUNT_TIERS) {
    violations.push({ code: 'TOO_MANY_TIERS' });
  }

  tiers.forEach((t, tierIndex) => {
    if (!Number.isInteger(t.minQuantity) || t.minQuantity < 2) {
      violations.push({ code: 'MIN_QUANTITY_INVALID', tierIndex });
    }
    if (tierIndex > 0 && tiers[tierIndex - 1].minQuantity === t.minQuantity) {
      violations.push({ code: 'MIN_QUANTITY_DUPLICATE', tierIndex });
    }
    if (!isWholePercentRate(t.regularRateBp) || !isWholePercentRate(t.membershipRateBp)) {
      violations.push({ code: 'RATE_OUT_OF_RANGE', tierIndex });
    }
    if (tierIndex > 0) {
      const prev = tiers[tierIndex - 1];
      if (t.regularRateBp <= prev.regularRateBp || t.membershipRateBp <= prev.membershipRateBp) {
        violations.push({ code: 'RATE_NOT_INCREASING', tierIndex });
      }
    }
  });

  const invalidDay = [input.startsOn, input.endsOn].some((day) => day !== null && !isCalendarDate(day));
  if (invalidDay) {
    violations.push({ code: 'PERIOD_INVALID_DATE' });
  } else if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    violations.push({ code: 'PERIOD_REVERSED' });
  }

  for (const v of variants) {
    tiers.forEach((t, tierIndex) => {
      const regularPrice = discountedPrice(v.basePrice, t.regularRateBp);
      const membershipPrice = discountedPrice(v.membershipPrice, t.membershipRateBp);
      if (membershipPrice > regularPrice) {
        violations.push({ code: 'MEMBER_PRICE_ABOVE_REGULAR', tierIndex, variantId: v.variantId, regularPrice, membershipPrice });
      }
    });
  }

  return violations;
}

const won = (n: number | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

function describeViolation(v: QuantityDiscountViolation, sortedTiers: QuantityDiscountTier[]): string {
  const at = v.tierIndex === undefined ? undefined : sortedTiers[v.tierIndex]?.minQuantity;
  const tierLabel = at === undefined ? '한 구간' : `${at}개 이상 구간`;
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
      return `${tierLabel}의 할인율은 1~99 사이 정수 %로 넣어 주세요.`;
    case 'RATE_NOT_INCREASING':
      return `${tierLabel}의 %가 앞 구간보다 커야 합니다.`;
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
  tiers: QuantityDiscountTier[],
): string {
  const [first, ...rest] = violations;
  const head = `수량 할인 표와 맞지 않습니다: ${describeViolation(first, sortTiers(tiers))}`;
  return rest.length > 0 ? `${head} (외 ${rest.length}건)` : head;
}
