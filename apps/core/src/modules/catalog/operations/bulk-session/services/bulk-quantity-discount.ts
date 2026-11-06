import { BadRequestError } from '@app/shared';
import type { QuantityDiscountOverride, QuantityDiscountTier } from '../../../catalog.types';
import type { QuantityDiscountInput } from '../../../core/pricing/quantity-discount.manager';
import {
  describeQuantityDiscountViolation,
  isEmptyQuantityDiscount,
  sortTiers,
  validateQuantityDiscount,
} from '../../../core/pricing/quantity-discount.math';
import { QUANTITY_DISCOUNT_COLUMNS, QUANTITY_DISCOUNT_TIER_SLOTS, quantityDiscountTierKeys } from './form-export.sheets';
import type { PrefillRow } from './form-export.types';

// 수량할인 시트 한 상품의 행 묶음 = 표 하나. 조합이 빈 행이 기본 구간(+사용·기간), 조합이 있는 행이 그 옵션의 예외다.

const BP_PER_PERCENT = 100;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WHOLE_NUMBER = /^\d{1,9}$/;
const PERIOD_KEYS = ['enabled', 'startsOn', 'endsOn'] as const;

const labelOf = (key: string): string => QUANTITY_DISCOUNT_COLUMNS.find((c) => c.key === key)?.label ?? key;
const cell = (cells: PrefillRow, key: string): string => (cells[key] ?? '').trim();
const percentCell = (cells: PrefillRow, key: string): string => cell(cells, key).replace(/%$/, '').trim();
const combinationOf = (cells: PrefillRow): string => cell(cells, 'combination');
const nameOf = (cells: PrefillRow): string => cell(cells, 'combinationLabel') || combinationOf(cells);
/** 숫자면 앞 0 을 없앤 정수 문자열, 아니면 그대로(형식 검사가 막는다). */
const normalizeNumber = (value: string): string => (WHOLE_NUMBER.test(value) ? String(Number(value)) : value);

function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

interface RawTier {
  slot: number;
  minQuantity: string;
  regularRate: string;
  membershipRate: string;
}

function rawTiers(cells: PrefillRow): RawTier[] {
  return QUANTITY_DISCOUNT_TIER_SLOTS.map((slot) => {
    const keys = quantityDiscountTierKeys(slot);
    return {
      slot,
      minQuantity: cell(cells, keys.minQuantity),
      regularRate: percentCell(cells, keys.regularRate),
      membershipRate: percentCell(cells, keys.membershipRate),
    };
  }).filter((t) => t.minQuantity !== '' || t.regularRate !== '' || t.membershipRate !== '');
}

/** 한 행의 구간 칸. 수량이 있고 % 하나가 비면 0(그 대상 할인 없음), 둘 다 비면 오류. */
function readTierCells(cells: PrefillRow, errors: string[]): QuantityDiscountTier[] {
  const tiers: QuantityDiscountTier[] = [];
  for (const raw of rawTiers(cells)) {
    const keys = quantityDiscountTierKeys(raw.slot);
    if (raw.minQuantity === '') {
      errors.push(`구간${raw.slot}: 수량이 비었습니다.`);
      continue;
    }
    if (raw.regularRate === '' && raw.membershipRate === '') {
      errors.push(`구간${raw.slot}: 일반%·멤버십% 중 하나는 넣어 주세요.`);
      continue;
    }
    const parts = [
      { key: keys.minQuantity, value: raw.minQuantity },
      { key: keys.regularRate, value: raw.regularRate || '0' },
      { key: keys.membershipRate, value: raw.membershipRate || '0' },
    ];
    const notWhole = parts.filter((p) => !WHOLE_NUMBER.test(p.value));
    if (notWhole.length > 0) {
      for (const p of notWhole) errors.push(`${labelOf(p.key)}은 정수여야 합니다: ${p.value}`);
      continue;
    }
    tiers.push({
      minQuantity: Number(parts[0].value),
      regularRateBp: Number(parts[1].value) * BP_PER_PERCENT,
      membershipRateBp: Number(parts[2].value) * BP_PER_PERCENT,
    });
  }
  return sortTiers(tiers);
}

/**
 * 한 상품의 수량할인 행 묶음을 구간표 입력으로 읽는다. 구간이 어디에도 없으면 `input: null`(= 표 없음)이다.
 * `knownCombinations` 를 주면(그 상품의 «조합» 시트 행) 거기 없는 조합을 오류로 낸다.
 * 가격과 무관한 규칙은 관리자 화면과 같은 검사기·같은 문장을 쓰고, «회원가 ≤ 일반가»는 초안을 만들 때 서버가 본다.
 */
export function readQuantityDiscountRows(
  rows: PrefillRow[],
  knownCombinations?: ReadonlySet<string>,
): { input: QuantityDiscountInput | null; errors: string[] } {
  const errors: string[] = [];
  const baseRows = rows.filter((r) => combinationOf(r) === '');
  const optionRows = rows.filter((r) => combinationOf(r) !== '');
  if (baseRows.length > 1) errors.push('조합이 빈 행(기본 구간)은 상품당 한 행만 쓸 수 있습니다.');
  const baseRow: PrefillRow = baseRows[0] ?? {};

  const enabledRaw = cell(baseRow, 'enabled');
  if (enabledRaw !== '' && enabledRaw !== 'Y' && enabledRaw !== 'N') {
    errors.push(`${labelOf('enabled')}은 Y 또는 N 이어야 합니다: ${enabledRaw}`);
  }
  const readDay = (key: 'startsOn' | 'endsOn'): string | null => {
    const value = cell(baseRow, key);
    if (value === '') return null;
    if (!isCalendarDay(value)) {
      errors.push(`${labelOf(key)}은 YYYY-MM-DD 형식의 실제 날짜여야 합니다: ${value}`);
      return null;
    }
    return value;
  };
  const startsOn = readDay('startsOn');
  const endsOn = readDay('endsOn');
  const tiers = readTierCells(baseRow, errors);

  const seen = new Set<string>();
  const variantOverrides: QuantityDiscountOverride[] = [];
  const names = new Map<string, string>();
  for (const row of optionRows) {
    const combination = combinationOf(row);
    const name = nameOf(row);
    names.set(combination, name);
    if (PERIOD_KEYS.some((key) => cell(row, key) !== '')) {
      errors.push(`${name}: 사용·시작일·종료일은 조합이 빈 행에만 넣습니다.`);
    }
    if (seen.has(combination)) {
      errors.push(`${name}: 같은 조합이 두 번 있습니다.`);
      continue;
    }
    seen.add(combination);
    if (knownCombinations && !knownCombinations.has(combination)) {
      errors.push(`${name}: 조합 시트에 없는 조합입니다. 조합 시트의 «조합» 값을 그대로 붙여 넣어 주세요.`);
      continue;
    }
    const rowErrors: string[] = [];
    const overrideTiers = readTierCells(row, rowErrors);
    errors.push(...rowErrors.map((m) => `${name}: ${m}`));
    variantOverrides.push({ combination, tiers: overrideTiers });
  }

  if (errors.length > 0) return { input: null, errors };

  const input: QuantityDiscountInput = { enabled: enabledRaw !== 'N', startsOn, endsOn, tiers, variantOverrides };
  if (isEmptyQuantityDiscount(input)) return { input: null, errors: [] };

  const ruleErrors = validateQuantityDiscount(input, []).map((v) =>
    describeQuantityDiscountViolation(v, input, (c) => names.get(c) ?? c),
  );
  if (ruleErrors.length > 0) return { input: null, errors: [...new Set(ruleErrors)] };
  return { input, errors: [] };
}

/** 한 행의 구간을 «수량:일반:멤버십,…»로. 빈 % 는 0, `%` 기호·앞 0 은 지운다. 형식이 깨진 칸은 원문 그대로. */
function canonicalTiers(cells: PrefillRow): string {
  return rawTiers(cells)
    .map((t, index) => ({
      index,
      minQuantity: normalizeNumber(t.minQuantity),
      regularRate: t.minQuantity !== '' && t.regularRate === '' ? '0' : normalizeNumber(t.regularRate),
      membershipRate: t.minQuantity !== '' && t.membershipRate === '' ? '0' : normalizeNumber(t.membershipRate),
    }))
    .sort((a, b) => {
      const qa = Number(a.minQuantity);
      const qb = Number(b.minQuantity);
      if (Number.isFinite(qa) && Number.isFinite(qb) && qa !== qb) return qa - qb;
      return a.index - b.index;
    })
    .map((t) => `${t.minQuantity}:${t.regularRate}:${t.membershipRate}`)
    .join(',');
}

/**
 * 차분·충돌 비교용 한 줄 값 `사용|시작|종료|기본구간|조합=구간;…`(예외는 조합순, 조합은 URI 인코딩 — 작업자가 지은 키에 구분자가 있어도 깨지지 않게). 구간이 어디에도 없으면 `''` 이라
 * «표 없는 상품의 빈 행»과 «이 시트가 없던 옛 양식 스냅샷»이 같은 값이 된다. 칸 자리·행 순서·`%` 표기·참고용 이름과 무관하다.
 */
export function canonicalQuantityDiscount(rows: PrefillRow[]): string {
  const baseRow = rows.find((r) => combinationOf(r) === '') ?? {};
  const overrides = rows
    .filter((r) => combinationOf(r) !== '')
    .map((r) => ({ combination: encodeURIComponent(combinationOf(r)), tiers: canonicalTiers(r) }))
    .sort((a, b) => (a.combination < b.combination ? -1 : a.combination > b.combination ? 1 : 0));
  const baseTiers = canonicalTiers(baseRow);
  if (baseTiers === '' && overrides.every((o) => o.tiers === '')) return '';

  const enabled = cell(baseRow, 'enabled') || 'Y';
  const overridePart = overrides.map((o) => `${o.combination}=${o.tiers}`).join(';');
  return `${enabled}|${cell(baseRow, 'startsOn')}|${cell(baseRow, 'endsOn')}|${baseTiers}|${overridePart}`;
}

function parseTierList(part: string): QuantityDiscountTier[] {
  if (part === '') return [];
  return part.split(',').map((t) => {
    const [q, r, m] = t.split(':').map(Number);
    return { minQuantity: q, regularRateBp: r * BP_PER_PERCENT, membershipRateBp: m * BP_PER_PERCENT };
  });
}

/** 검사를 통과한 정규형만 들어온다. 읽을 수 없으면 그 행을 실패시킨다(조용히 표를 지우지 않는다). */
export function parseCanonicalQuantityDiscount(canonical: string): QuantityDiscountInput | null {
  if (canonical === '') return null;
  const [enabled, startsOn, endsOn, basePart, overridePart] = canonical.split('|');
  const variantOverrides = (overridePart ?? '')
    .split(';')
    .filter((p) => p !== '')
    .map((p) => {
      const [combination, tiers] = p.split('=');
      return { combination: decodeURIComponent(combination ?? ''), tiers: parseTierList(tiers ?? '') };
    });
  const input = {
    enabled: enabled !== 'N',
    startsOn: startsOn || null,
    endsOn: endsOn || null,
    tiers: parseTierList(basePart ?? ''),
    variantOverrides,
  };
  const all = [...input.tiers, ...variantOverrides.flatMap((o) => o.tiers)];
  const broken =
    overridePart === undefined ||
    variantOverrides.some((o) => o.combination === '') ||
    all.some((t) => [t.minQuantity, t.regularRateBp, t.membershipRateBp].some((n) => !Number.isInteger(n)));
  if (broken) throw new BadRequestError('수량할인 값을 읽지 못했습니다. 양식을 다시 받아 주세요.');
  return input;
}

function describeTiers(part: string): string {
  if (part === '') return '할인 없음';
  const rate = (r: string) => (r === '0' ? '할인 없음' : `${r}%`);
  return part
    .split(',')
    .map((t) => {
      const [q, r, m] = t.split(':');
      return `${q}개 이상 ${rate(r)}/${rate(m)}`;
    })
    .join(', ');
}

/** 미리보기·충돌 화면의 문장. 옵션 이름은 호출부가 준다(없으면 «옵션»). */
export function formatQuantityDiscount(canonical: string, optionName: (combination: string) => string | undefined): string {
  if (canonical === '') return '(없음)';
  const [enabled, startsOn, endsOn, basePart, overridePart] = canonical.split('|');
  const period =
    startsOn && endsOn ? `${startsOn} ~ ${endsOn}` : startsOn ? `${startsOn}부터` : endsOn ? `${endsOn}까지` : '상시';
  const overrides = (overridePart ?? '')
    .split(';')
    .filter((p) => p !== '')
    .map((p) => {
      const [combination, tiers] = p.split('=');
      return `${optionName(decodeURIComponent(combination ?? '')) ?? '옵션'} ${describeTiers(tiers ?? '')}`;
    });
  return [enabled === 'N' ? '사용 안 함' : '사용', period, `기본 ${describeTiers(basePart ?? '')}`, ...overrides].join(' · ');
}

function tierCells(tiers: QuantityDiscountTier[]): PrefillRow {
  const out: PrefillRow = {};
  const sorted = sortTiers(tiers);
  for (const slot of QUANTITY_DISCOUNT_TIER_SLOTS) {
    const keys = quantityDiscountTierKeys(slot);
    const tier = sorted[slot - 1];
    out[keys.minQuantity] = tier ? String(tier.minQuantity) : '';
    out[keys.regularRate] = tier ? String(tier.regularRateBp / BP_PER_PERCENT) : '';
    out[keys.membershipRate] = tier ? String(tier.membershipRateBp / BP_PER_PERCENT) : '';
  }
  return out;
}

/**
 * 저장된 구간표를 시트 행들(상품키 제외)로: 기본 행 하나 + 예외마다 한 행. 표가 없으면 모든 칸이 빈 기본 행 하나다.
 * `labels` 는 이 버전의 조합 → «조합» 시트의 조합명(참고용). 여기 없는 조합(옵션을 뺀 뒤 남은 예외)은 내보내지 않는다 —
 * 계산에서도 이미 무시되고, 내보내면 손대지 않은 양식이 «조합 시트에 없는 조합»으로 올라가지 않는다.
 */
export function quantityDiscountPrefillRows(
  saved: {
    enabled: boolean;
    startsOn: string | null;
    endsOn: string | null;
    tiers: QuantityDiscountTier[];
    variantOverrides: QuantityDiscountOverride[];
  } | null,
  labels: ReadonlyMap<string, string>,
): PrefillRow[] {
  const baseRow: PrefillRow = {
    combination: '',
    combinationLabel: '',
    enabled: saved ? (saved.enabled ? 'Y' : 'N') : '',
    startsOn: saved?.startsOn ?? '',
    endsOn: saved?.endsOn ?? '',
    ...tierCells(saved?.tiers ?? []),
  };
  const overrideRows = (saved?.variantOverrides ?? []).filter((o) => labels.has(o.combination)).map((o) => ({
    combination: o.combination,
    combinationLabel: labels.get(o.combination) ?? '',
    enabled: '',
    startsOn: '',
    endsOn: '',
    ...tierCells(o.tiers),
  }));
  return [baseRow, ...overrideRows];
}
