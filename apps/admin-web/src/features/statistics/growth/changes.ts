import { addDays, isoWeekday } from './calendar';

/**
 * 변화 감지 — «어제(또는 지난주)가 평소와 다른가».
 *
 * 기준선은 «같은 요일»의 최근 몇 주다(쇼핑몰은 요일 패턴이 크다 — 월요일과 토요일을 비교하면 다 이상해 보인다).
 * 두 가지가 다 넘을 때만 피드에 올린다 — 경보 피로를 막는 업계 관행이다.
 *   ① 통계적 유의: 금액·건수는 MAD 기반 robust z(|z| ≥ 3.5, Iglewicz–Hoaglin),
 *      비율은 기준 비율 대비 두 비율 z(|z| ≥ 2.58, 99%). 비율 검정은 정규근사 조건 n·p ≥ 10 일 때만.
 *   ② 실무 유의: 상대 변화 15% 이상.
 * 표본이 모자라면 판정하지 않고 «표본 부족»으로 남긴다. 지속 변화(수준 이동)는 7일 합끼리 같은 방식으로 본다 —
 * CUSUM 은 이력이 짧으면 기준 평균·허용폭을 정할 근거가 약해 쓰지 않았다(이력이 쌓이면 승격).
 *
 * 이 모듈은 «무엇이 바뀌었나»만 말한다. «왜»는 말하지 않는다.
 */

export const ROBUST_Z = 3.5;
export const RATE_Z = 2.58;
export const MIN_RELATIVE_CHANGE = 0.15;
export const MIN_EXPECTED_SUCCESSES = 10;
const MIN_BASELINE_SAMPLES = 4;
const MAX_BASELINE_WEEKS = 8;

export interface ValuePoint {
  date: string;
  value: number;
}

export interface RatePoint {
  date: string;
  numerator: number;
  denominator: number;
}

export type ChangeVerdict = 'up' | 'down' | 'normal' | 'insufficient';

export interface ChangeSignal {
  metric: string;
  label: string;
  /** 비교한 날(일) 또는 7일 창의 마지막 날(주) */
  window: 'day' | 'week';
  date: string;
  actual: number;
  baseline: number | null;
  relativeChange: number | null;
  z: number | null;
  verdict: ChangeVerdict;
  /** 기준선에 쓴 표본 수 */
  samples: number;
  /** 판정 안 한 이유 */
  note?: string;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function verdictOf(z: number | null, rel: number | null, threshold: number): ChangeVerdict {
  if (z == null || rel == null) return 'normal';
  if (Math.abs(z) >= threshold && Math.abs(rel) >= MIN_RELATIVE_CHANGE) return z > 0 ? 'up' : 'down';
  return 'normal';
}

/** 금액·건수: 같은 요일 최근 주들의 중앙값과 MAD. */
export function detectValueChange(metric: string, label: string, points: ValuePoint[], target: string): ChangeSignal {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const actual = byDate.get(target);
  const baselineValues: number[] = [];
  for (let w = 1; w <= MAX_BASELINE_WEEKS; w += 1) {
    const v = byDate.get(addDays(target, -7 * w));
    if (v != null) baselineValues.push(v);
  }
  const base: ChangeSignal = { metric, label, window: 'day', date: target, actual: actual ?? 0, baseline: null, relativeChange: null, z: null, verdict: 'insufficient', samples: baselineValues.length };
  if (actual == null || baselineValues.length < MIN_BASELINE_SAMPLES) {
    return { ...base, note: `같은 요일 기준이 ${baselineValues.length}주뿐입니다(최소 ${MIN_BASELINE_SAMPLES}주)` };
  }
  const med = median(baselineValues);
  const mad = median(baselineValues.map((v) => Math.abs(v - med)));
  const rel = med !== 0 ? (actual - med) / Math.abs(med) : null;
  if (mad === 0) {
    // MAD 가 0 이면(기준의 절반 이상이 같은 값) 평균 절대편차로 척도를 잡는다 — Iglewicz–Hoaglin 의 대안식.
    const meanAd = baselineValues.reduce((sum, v) => sum + Math.abs(v - med), 0) / baselineValues.length;
    if (meanAd === 0) {
      // 기준이 완전히 일정하면 흔들림 폭이 없다 — 실무 유의(상대 변화)만으로 본다.
      const verdict: ChangeVerdict = rel != null && Math.abs(rel) >= MIN_RELATIVE_CHANGE ? (rel > 0 ? 'up' : 'down') : 'normal';
      return { ...base, baseline: med, relativeChange: rel, verdict, note: '기준 주들이 모두 같은 값이라 상대 변화로만 판정했습니다' };
    }
    const z = (actual - med) / (1.253314 * meanAd);
    return { ...base, baseline: med, relativeChange: rel, z, verdict: verdictOf(z, rel, ROBUST_Z) };
  }
  const z = (0.6745 * (actual - med)) / mad;
  return { ...base, baseline: med, relativeChange: rel, z, verdict: verdictOf(z, rel, ROBUST_Z) };
}

/** 비율: 같은 요일 기준 주들을 합친 비율 p₀ 대비 어제 비율의 z. */
export function detectRateChange(metric: string, label: string, points: RatePoint[], target: string): ChangeSignal {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const today = byDate.get(target);
  let num = 0;
  let den = 0;
  let samples = 0;
  for (let w = 1; w <= MAX_BASELINE_WEEKS; w += 1) {
    const p = byDate.get(addDays(target, -7 * w));
    if (p && p.denominator > 0) {
      num += p.numerator;
      den += p.denominator;
      samples += 1;
    }
  }
  const actualRate = today && today.denominator > 0 ? today.numerator / today.denominator : 0;
  const base: ChangeSignal = { metric, label, window: 'day', date: target, actual: actualRate, baseline: null, relativeChange: null, z: null, verdict: 'insufficient', samples };
  if (!today || today.denominator <= 0 || samples < MIN_BASELINE_SAMPLES || den <= 0) {
    return { ...base, note: '비교할 표본이 부족합니다' };
  }
  const p0 = num / den;
  const rel = p0 > 0 ? (actualRate - p0) / p0 : null;
  if (today.denominator * p0 < MIN_EXPECTED_SUCCESSES || p0 <= 0 || p0 >= 1) {
    return { ...base, baseline: p0, relativeChange: rel, note: `하루 표본이 작아(기대 건수 ${(today.denominator * p0).toFixed(1)} < ${MIN_EXPECTED_SUCCESSES}) 판정하지 않습니다` };
  }
  const z = (actualRate - p0) / Math.sqrt((p0 * (1 - p0)) / today.denominator);
  return { ...base, baseline: p0, relativeChange: rel, z, verdict: verdictOf(z, rel, RATE_Z) };
}

/** 7일 합으로 접는다(target 을 끝으로 하는 7일, 그 앞의 겹치지 않는 7일들). 금액·건수용. */
export function weeklyTotals(points: ValuePoint[], target: string, weeks: number): ValuePoint[] {
  const byDate = new Map(points.map((p) => [p.date, p.value]));
  const out: ValuePoint[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const end = addDays(target, -7 * w);
    let sum = 0;
    let complete = true;
    for (let d = 0; d < 7; d += 1) {
      const v = byDate.get(addDays(end, -d));
      if (v == null) complete = false;
      else sum += v;
    }
    if (complete) out.push({ date: end, value: sum });
  }
  return out;
}

/** 주간 수준 변화 — 최근 7일 합을 그 앞 7일 합들과 비교한다. 같은 요일 구성이라 요일 보정이 필요 없다. */
export function detectWeeklyValueChange(metric: string, label: string, points: ValuePoint[], target: string): ChangeSignal {
  const weekly = weeklyTotals(points, target, MAX_BASELINE_WEEKS + 1);
  const [latest, ...rest] = weekly;
  if (!latest || latest.date !== target) {
    return { metric, label, window: 'week', date: target, actual: 0, baseline: null, relativeChange: null, z: null, verdict: 'insufficient', samples: 0, note: '최근 7일이 다 차지 않았습니다' };
  }
  // 같은 요일 간격(7일)으로 이미 접었으므로 detectValueChange 를 «주» 점들에 그대로 쓴다.
  const signal = detectValueChange(metric, label, [latest, ...rest], target);
  return { ...signal, window: 'week' };
}

export function detectWeeklyRateChange(metric: string, label: string, points: RatePoint[], target: string): ChangeSignal {
  const fold = (pick: (p: RatePoint) => number) =>
    weeklyTotals(points.map((p) => ({ date: p.date, value: pick(p) })), target, MAX_BASELINE_WEEKS + 1);
  const nums = fold((p) => p.numerator);
  const dens = fold((p) => p.denominator);
  const denByDate = new Map(dens.map((d) => [d.date, d.value]));
  const rates: RatePoint[] = nums
    .filter((n) => denByDate.has(n.date))
    .map((n) => ({ date: n.date, numerator: n.value, denominator: denByDate.get(n.date) ?? 0 }));
  const signal = detectRateChange(metric, label, rates, target);
  return { ...signal, window: 'week' };
}

/** 어제 날짜 — 오늘은 아직 끝나지 않았다. */
export function lastCompleteDay(today: string): string {
  return addDays(today, -1);
}

export function weekdayLabel(day: string): string {
  return ['월', '화', '수', '목', '금', '토', '일'][isoWeekday(day)];
}
