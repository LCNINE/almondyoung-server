// 수량 할인 구간표 화면 모델. 계산·검증 식은 core `quantity-discount.math.ts` 와 같아야 하며
// core 쪽 `quantity-discount.parity.spec.ts` 가 둘을 같은 입력으로 대조한다. 그래서 이 파일은 아무것도 import 하지 않는다.

export const MAX_QUANTITY_DISCOUNT_TIERS = 5;
const BP_PER_PERCENT = 100;
const BP_WHOLE = 10000;

export interface QuantityDiscountTier {
  minQuantity: number;
  regularRateBp: number;
  membershipRateBp: number;
}

export interface QuantityDiscountDto {
  id: string;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
}

export interface UpsertQuantityDiscountDto {
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
}

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

export interface TierPrice {
  minQuantity: number;
  price: number;
}

export interface TierForm {
  minQuantity: string;
  regularPercent: string;
  membershipPercent: string;
}

export interface QuantityDiscountForm {
  enabled: boolean;
  periodMode: 'always' | 'period';
  startsOn: string;
  endsOn: string;
  tiers: TierForm[];
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
}): { regular: TierPrice[]; membership: TierPrice[] } {
  const tiers = sortTiers(input.tiers);
  return {
    regular: tiers.map((t) => ({ minQuantity: t.minQuantity, price: discountedPrice(input.basePrice, t.regularRateBp) })),
    membership: tiers.map((t) => ({
      minQuantity: t.minQuantity,
      price: discountedPrice(input.membershipPrice, t.membershipRateBp),
    })),
  };
}

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

export function emptyQuantityDiscountForm(): QuantityDiscountForm {
  return { enabled: true, periodMode: 'always', startsOn: '', endsOn: '', tiers: [] };
}

export function formFromResponse(dto: QuantityDiscountDto | null | undefined): QuantityDiscountForm {
  if (!dto) return emptyQuantityDiscountForm();
  return {
    enabled: dto.enabled,
    periodMode: dto.startsOn || dto.endsOn ? 'period' : 'always',
    startsOn: dto.startsOn ?? '',
    endsOn: dto.endsOn ?? '',
    tiers: sortTiers(dto.tiers).map((t) => ({
      minQuantity: String(t.minQuantity),
      regularPercent: String(t.regularRateBp / BP_PER_PERCENT),
      membershipPercent: String(t.membershipRateBp / BP_PER_PERCENT),
    })),
  };
}

// 빈칸·숫자 아님은 NaN 으로 넘겨 검증이 «정수 아님»으로 잡게 한다.
function toNumber(cell: string): number {
  const trimmed = cell.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

// 빈 최소 수량(NaN)은 뒤로 — 비교 결과가 NaN 이면 정렬 순서가 정해지지 않는다.
function byMinQuantityBlankLast(a: QuantityDiscountTier, b: QuantityDiscountTier): number {
  const aBlank = Number.isNaN(a.minQuantity);
  const bBlank = Number.isNaN(b.minQuantity);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  return a.minQuantity - b.minQuantity;
}

export function formToPayload(form: QuantityDiscountForm): UpsertQuantityDiscountDto {
  const period = form.periodMode === 'period';
  return {
    enabled: form.enabled,
    startsOn: period && form.startsOn ? form.startsOn : null,
    endsOn: period && form.endsOn ? form.endsOn : null,
    tiers: form.tiers
      .map((t) => ({
        minQuantity: toNumber(t.minQuantity),
        regularRateBp: toNumber(t.regularPercent) * BP_PER_PERCENT,
        membershipRateBp: toNumber(t.membershipPercent) * BP_PER_PERCENT,
      }))
      .sort(byMinQuantityBlankLast),
  };
}

const won = (n: number | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`;

export function violationMessage(v: QuantityDiscountViolation, variantName?: string): string {
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
      return '할인율은 1~99 사이 정수 %로 넣어 주세요.';
    case 'RATE_NOT_INCREASING':
      return '수량이 많은 구간일수록 일반 %와 멤버십 %가 모두 커야 합니다.';
    case 'MEMBER_PRICE_ABOVE_REGULAR':
      return `${variantName ?? v.variantId ?? '옵션'}: 멤버십 회원가 ${won(v.membershipPrice)}이 일반가 ${won(v.regularPrice)}보다 비쌉니다. 멤버십 %를 올려 주세요.`;
    case 'PERIOD_REVERSED':
      return '시작일이 종료일보다 늦습니다.';
    case 'PERIOD_INVALID_DATE':
      return '달력에 없는 날짜입니다.';
  }
}

const VIOLATION_CODES: ReadonlySet<string> = new Set<QuantityDiscountViolationCode>([
  'EMPTY_TIERS',
  'TOO_MANY_TIERS',
  'MIN_QUANTITY_INVALID',
  'MIN_QUANTITY_DUPLICATE',
  'RATE_OUT_OF_RANGE',
  'RATE_NOT_INCREASING',
  'MEMBER_PRICE_ABOVE_REGULAR',
  'PERIOD_REVERSED',
  'PERIOD_INVALID_DATE',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isViolation(value: unknown): value is QuantityDiscountViolation {
  return isRecord(value) && typeof value.code === 'string' && VIOLATION_CODES.has(value.code);
}

/**
 * 저장 400 의 `errors` 에서 구간표 위반만 꺼낸다(다른 오류면 빈 배열). API 클라이언트는 4xx 를
 * 응답 본문을 `response` 에 실은 오류로 바꿔 던진다.
 */
export function serverViolations(error: unknown): QuantityDiscountViolation[] {
  if (!isRecord(error) || !isRecord(error.response)) return [];
  const errors = error.response.errors;
  return Array.isArray(errors) ? errors.filter(isViolation) : [];
}
