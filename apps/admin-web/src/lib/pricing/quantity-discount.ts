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

/** 한 옵션(조합 키)만 기본 표 대신 쓰는 구간. tiers 가 비면 그 옵션은 할인 없음. */
export interface QuantityDiscountOverride {
  combination: string;
  tiers: QuantityDiscountTier[];
}

export interface QuantityDiscountDto {
  id: string;
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
  variantOverrides?: QuantityDiscountOverride[];
}

export interface UpsertQuantityDiscountDto {
  enabled: boolean;
  startsOn: string | null;
  endsOn: string | null;
  tiers: QuantityDiscountTier[];
  variantOverrides: QuantityDiscountOverride[];
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

/** 같은 표를 쓰는 옵션 묶음 하나. 저장할 때 옵션(조합)마다 한 줄로 펼친다. */
export interface OverrideForm {
  key: string;
  combinations: string[];
  mode: 'tiers' | 'none';
  tiers: TierForm[];
}

export interface QuantityDiscountForm {
  enabled: boolean;
  periodMode: 'always' | 'period';
  startsOn: string;
  endsOn: string;
  tiers: TierForm[];
  overrides: OverrideForm[];
}

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

export function emptyQuantityDiscountForm(): QuantityDiscountForm {
  return { enabled: true, periodMode: 'always', startsOn: '', endsOn: '', tiers: [], overrides: [] };
}

/** 옵션의 조합 키 = 옵션값 id 를 정렬해 «+» 로 잇는다(core 계산기·엑셀 «조합» 칸과 같은 식). */
export function combinationOf(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('+');
}

let overrideKeySeq = 0;
export function newOverrideKey(): string {
  overrideKeySeq += 1;
  return `override-${overrideKeySeq}`;
}

function tierRowsFrom(tiers: QuantityDiscountTier[]): TierForm[] {
  return sortTiers(tiers).map((t) => ({
    minQuantity: String(t.minQuantity),
    regularPercent: String(t.regularRateBp / BP_PER_PERCENT),
    membershipPercent: String(t.membershipRateBp / BP_PER_PERCENT),
  }));
}

/** 같은 구간 목록을 가진 예외는 한 카드로 모은다(저장 순서를 따른다). */
function overrideCards(overrides: QuantityDiscountOverride[]): OverrideForm[] {
  const cards = new Map<string, OverrideForm>();
  for (const o of overrides) {
    const signature = JSON.stringify(sortTiers(o.tiers));
    const card = cards.get(signature);
    if (card) {
      card.combinations.push(o.combination);
    } else {
      cards.set(signature, {
        key: newOverrideKey(),
        combinations: [o.combination],
        mode: o.tiers.length === 0 ? 'none' : 'tiers',
        tiers: tierRowsFrom(o.tiers),
      });
    }
  }
  return [...cards.values()];
}

export function formFromResponse(dto: QuantityDiscountDto | null | undefined): QuantityDiscountForm {
  if (!dto) return emptyQuantityDiscountForm();
  return {
    enabled: dto.enabled,
    periodMode: dto.startsOn || dto.endsOn ? 'period' : 'always',
    startsOn: dto.startsOn ?? '',
    endsOn: dto.endsOn ?? '',
    tiers: tierRowsFrom(dto.tiers),
    overrides: overrideCards(dto.variantOverrides ?? []),
  };
}

// 빈칸·숫자 아님은 NaN 으로 넘겨 검증이 «정수 아님»으로 잡게 한다.
function toNumber(cell: string): number {
  const trimmed = cell.trim();
  return trimmed === '' ? Number.NaN : Number(trimmed);
}

// 할인율 빈칸은 0 — 그 대상은 이 구간 할인이 없다(한쪽 대상만 할인하는 구간).
function toRate(cell: string): number {
  return cell.trim() === '' ? 0 : Number(cell.trim());
}

// 빈 최소 수량(NaN)은 뒤로 — 비교 결과가 NaN 이면 정렬 순서가 정해지지 않는다.
function byMinQuantityBlankLast(a: QuantityDiscountTier, b: QuantityDiscountTier): number {
  const aBlank = Number.isNaN(a.minQuantity);
  const bBlank = Number.isNaN(b.minQuantity);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1;
  return a.minQuantity - b.minQuantity;
}

export function tiersFromRows(rows: TierForm[]): QuantityDiscountTier[] {
  return rows
    .map((t) => ({
      minQuantity: toNumber(t.minQuantity),
      regularRateBp: toRate(t.regularPercent) * BP_PER_PERCENT,
      membershipRateBp: toRate(t.membershipPercent) * BP_PER_PERCENT,
    }))
    .sort(byMinQuantityBlankLast);
}

export function formToPayload(form: QuantityDiscountForm): UpsertQuantityDiscountDto {
  const period = form.periodMode === 'period';
  return {
    enabled: form.enabled,
    startsOn: period && form.startsOn ? form.startsOn : null,
    endsOn: period && form.endsOn ? form.endsOn : null,
    tiers: tiersFromRows(form.tiers),
    variantOverrides: form.overrides.flatMap((card) => {
      const tiers = card.mode === 'none' ? [] : tiersFromRows(card.tiers);
      return card.combinations.map((combination) => ({ combination, tiers }));
    }),
  };
}

export interface OverrideProblem {
  key: string;
  message: string;
}

/** 서버 규칙 밖의, 화면에서만 생기는 빈 카드. 있으면 저장을 막는다. */
export function overrideProblems(form: QuantityDiscountForm): OverrideProblem[] {
  return form.overrides.flatMap((card): OverrideProblem[] => {
    if (card.combinations.length === 0) {
      return [{ key: card.key, message: '이 예외를 적용할 옵션을 하나 이상 골라 주세요.' }];
    }
    if (card.mode === 'tiers' && card.tiers.length === 0) {
      return [{ key: card.key, message: '구간을 넣거나 «할인 없음»을 골라 주세요.' }];
    }
    return [];
  });
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
      return '할인율은 0~99 사이 정수 %로 넣어 주세요. 비우면 0(그 대상은 할인 없음)입니다.';
    case 'RATE_BOTH_ZERO':
      return '일반 할인과 멤버십 할인이 모두 0 인 구간이 있습니다. 둘 중 하나는 넣어 주세요.';
    case 'OVERRIDE_DUPLICATE':
      return '같은 옵션의 예외가 두 번 있습니다.';
    case 'RATE_NOT_INCREASING':
      return '수량이 많은 구간일수록 할인율이 커야 합니다. 0(할인 없음)은 앞쪽 구간에만 둘 수 있습니다.';
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
  'RATE_BOTH_ZERO',
  'RATE_NOT_INCREASING',
  'OVERRIDE_DUPLICATE',
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
