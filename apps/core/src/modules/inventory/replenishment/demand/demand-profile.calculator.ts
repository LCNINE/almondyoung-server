import { addDays, dayDiff } from './calendar';
import { classifyPattern, ClassificationThresholds, DemandPattern } from '../policy/classification';

/**
 * 시계열 → 프로필 통계 (스펙 §4.3). 순수 함수 — Nest · drizzle 을 모른다.
 *
 * - 분류 창 = 오늘 − classification_window_days ~ 어제. 시계열 최초 날짜보다 앞은 창에서 뺀다.
 * - 파라미터 창은 패턴이 정한다(smooth · erratic · insufficient · none → frequent, intermittent · lumpy → sparse).
 *   같은 최초 날짜 규칙을 적용한다 — 신상품을 "1년 내내 0" 으로 읽지 않기 위해서.
 * - daily_mean_90 은 항상 frequent 창 — 레거시 재주문점(μ_D(90)·μ_L) 전용.
 * - 표준편차는 표본(n−1). n < 2 면 size_std · interval_mean 은 null, daily_std 는 0.
 */
export interface DemandPoint {
  date: string;
  qty: number;
}

export interface ProfileWindows {
  today: string;
  classificationWindowDays: number;
  paramWindowDaysFrequent: number;
  paramWindowDaysSparse: number;
}

export interface DemandProfileStats {
  pattern: DemandPattern;
  adi: number | null;
  cv2: number | null;
  dailyMean: number;
  dailyStd: number;
  dailyMean90: number;
  sizeMean: number | null;
  sizeStd: number | null;
  intervalMean: number | null;
  historyDays: number;
  demandEvents: number;
  classificationFrom: string;
  classificationTo: string;
  paramFrom: string;
  paramTo: string;
}

export type DemandGrade = 'A' | 'B' | 'C';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sampleStd(xs: number[]): number {
  const m = mean(xs);
  const ss = xs.reduce((s, x) => s + (x - m) * (x - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

/** [from, to] 창의 모든 날(0 포함) 평균 · 표본 표준편차. from > to 면 0 · 0. */
function windowStats(byDate: Map<string, number>, from: string, to: string): { mean: number; std: number } {
  if (from > to) return { mean: 0, std: 0 };
  const n = dayDiff(from, to) + 1;
  let sum = 0;
  let sumSq = 0;
  for (const [date, qty] of byDate) {
    if (date < from || date > to) continue;
    sum += qty;
    sumSq += qty * qty;
  }
  const avg = sum / n;
  const variance = n >= 2 ? Math.max(0, (sumSq - n * avg * avg) / (n - 1)) : 0;
  return { mean: avg, std: Math.sqrt(variance) };
}

function laterOf(a: string, b: string | null): string {
  return b !== null && b > a ? b : a;
}

export function computeDemandProfile(
  points: DemandPoint[],
  firstDate: string | null,
  windows: ProfileWindows,
  thresholds: ClassificationThresholds,
): DemandProfileStats {
  const classificationTo = addDays(windows.today, -1);
  const classificationFrom = addDays(windows.today, -windows.classificationWindowDays);

  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.date, (byDate.get(p.date) ?? 0) + p.qty);

  const effectiveFrom = firstDate === null ? null : laterOf(classificationFrom, firstDate);
  const historyDays =
    effectiveFrom === null || effectiveFrom > classificationTo ? 0 : dayDiff(effectiveFrom, classificationTo) + 1;

  const eventDates = [...byDate.entries()]
    .filter(([date, qty]) => qty > 0 && effectiveFrom !== null && date >= effectiveFrom && date <= classificationTo)
    .map(([date]) => date)
    .sort();
  const sizes = eventDates.map((date) => byDate.get(date) ?? 0);
  const demandEvents = eventDates.length;

  const sizeMean = demandEvents > 0 ? mean(sizes) : null;
  const sizeStd = demandEvents >= 2 ? sampleStd(sizes) : null;
  const cv2 = sizeMean !== null && sizeStd !== null && sizeMean > 0 ? (sizeStd / sizeMean) ** 2 : null;
  const adi = demandEvents > 0 ? historyDays / demandEvents : null;
  const intervalMean =
    demandEvents >= 2 ? dayDiff(eventDates[0], eventDates[demandEvents - 1]) / (demandEvents - 1) : null;

  const pattern = classifyPattern({ adi, cv2, demandEvents, historyDays }, thresholds);

  const paramDays =
    pattern === 'intermittent' || pattern === 'lumpy' ? windows.paramWindowDaysSparse : windows.paramWindowDaysFrequent;
  const paramFrom = laterOf(addDays(windows.today, -paramDays), firstDate);
  const paramTo = classificationTo;
  const param = windowStats(byDate, paramFrom, paramTo);
  const frequentFrom = laterOf(addDays(windows.today, -windows.paramWindowDaysFrequent), firstDate);
  const frequent = windowStats(byDate, frequentFrom, paramTo);

  return {
    pattern,
    adi,
    cv2,
    dailyMean: param.mean,
    dailyStd: param.std,
    dailyMean90: frequent.mean,
    sizeMean,
    sizeStd,
    intervalMean,
    historyDays,
    demandEvents,
    classificationFrom,
    classificationTo,
    paramFrom,
    paramTo,
  };
}

/**
 * 등급 (스펙 §4.3): 매출 내림차순 누적. 품목을 더하기 **전** 누적 비율이 A컷 미만이면 A, B컷 미만이면 B, 아니면 C.
 * 그래서 경계를 넘는 품목은 앞 등급이고, 한 품목이 90% 여도 A 다. 매출 0 은 C.
 */
export function assignGrades(
  amountBySku: Map<string, number>,
  cuts: { gradeACut: number; gradeBCut: number },
): Map<string, DemandGrade> {
  const result = new Map<string, DemandGrade>();
  const sorted = [...amountBySku.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, amount]) => s + Math.max(0, amount), 0);
  let cumulative = 0;
  for (const [skuId, amount] of sorted) {
    if (amount <= 0 || total <= 0) {
      result.set(skuId, 'C');
      continue;
    }
    const shareBefore = cumulative / total;
    cumulative += amount;
    result.set(skuId, shareBefore < cuts.gradeACut ? 'A' : shareBefore < cuts.gradeBCut ? 'B' : 'C');
  }
  return result;
}
