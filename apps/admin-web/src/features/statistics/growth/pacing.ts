import { addDays, daysBetweenInclusive, daysInMonth, maxDay, minDay } from './calendar';

/**
 * 연간 매출 목표 페이싱.
 *
 * 기준은 «어제까지 끝난 날»이다 — 오늘은 아직 팔고 있는 중이라 오늘을 넣으면 아침마다 페이스가 뒤처져 보인다.
 * 오늘 실적은 «오늘까지 실적»으로 따로 보여 준다.
 *
 * 달성액 = 목표 범위의 순매출(집계 표) − wallet 상품 주문 환불(화면에서 병합) + 집계 시작 전 실적(관리자 입력).
 * wallet 환불을 못 받으면 차감하지 않고 그 사실을 `refundDeducted=false` 로 알린다(0 으로 뭉개지 않는다).
 */

export interface DailyNet {
  date: string;
  /** 전 채널 순매출 */
  allChannels: number;
  /** 자사몰 순매출 */
  ownMall: number;
}

export interface GoalInput {
  annualTarget: number;
  /** 1~12월 */
  monthlyTargets: number[];
  preCoverageActual: number | null;
}

export interface PacingInput {
  today: string;
  year: number;
  goal: GoalInput;
  /** 집계 첫날(전 채널). null 이면 집계 데이터가 없다. */
  coverageStart: string | null;
  /** 올해 1월 1일(또는 집계 첫날)부터 오늘까지 */
  ytdDaily: DailyNet[];
  /** 날짜별 wallet 상품 주문 환불. null = 조회 실패/미제공 */
  orderRefundsByDay: Map<string, number> | null;
  /** «현재 일평균»을 낼 최근 완료일 수 */
  runRateDays?: number;
}

export type PaceTone = 'ahead' | 'behind' | 'unknown';

export interface Pacing {
  asOf: string; // 어제
  annualTarget: number;
  /** 어제까지 달성액 */
  actualToDate: number;
  /** 오늘(진행 중)까지 포함한 달성액 */
  actualIncludingToday: number;
  /** 어제까지 계획 누적 */
  planToDate: number;
  /** 연간 달성률 = 어제까지 달성액 ÷ 연간 목표 */
  annualAchievement: number;
  /** 계획 대비 진척률 = 어제까지 달성액 ÷ 계획 누적. 계획 누적이 0 이면 null */
  paceRatio: number | null;
  /** 어제까지 달성액 − 계획 누적. 음수면 그만큼 뒤처졌다 */
  paceGap: number;
  paceTone: PaceTone;
  /** 남은 목표(음수면 0) */
  remainingAmount: number;
  exceeded: boolean;
  /** 오늘을 포함해 연말까지 남은 날 */
  remainingDays: number;
  /** 남은 목표 ÷ 남은 날 */
  requiredDaily: number;
  /** 최근 완료일 runRateDays 일의 일평균 달성액 */
  currentDaily: number;
  currentDailyOwnMall: number;
  currentDailyExternal: number;
  runRateDaysUsed: number;
  /** 필요 일평균 ÷ 현재 일평균 − 1. 현재 일평균이 0 이면 null */
  requiredLift: number | null;
  /** 이대로 가면 연말 = 어제까지 + 현재 일평균 × 남은 날 */
  landing: number;
  landingRatio: number;
  /** 계획 기산일. 집계가 연중에 시작했고 그 이전 실적 입력이 없으면 집계 첫날이다 */
  planStart: string;
  /** 집계 시작 전 실적이 빠져 있다(입력 없음) — 연간 달성률이 과소 계산된다 */
  missingPreCoverage: boolean;
  refundDeducted: boolean;
  refundDeductedAmount: number;
}

const DEFAULT_RUN_RATE_DAYS = 28;

/** 계획 누적 — 월 목표를 그 달 일수로 나눈 하루치를 [start, end] 날짜만큼 더한다. */
export function planBetween(year: number, monthlyTargets: number[], start: string, end: string): number {
  if (end < start) return 0;
  let total = 0;
  for (let month = 1; month <= 12; month += 1) {
    const mm = String(month).padStart(2, '0');
    const monthStart = `${year}-${mm}-01`;
    const monthEnd = `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`;
    const s = maxDay(start, monthStart);
    const e = minDay(end, monthEnd);
    if (e < s) continue;
    total += (monthlyTargets[month - 1] ?? 0) * (daysBetweenInclusive(s, e) / daysInMonth(year, month));
  }
  return total;
}

export function computePacing(input: PacingInput): Pacing {
  const { today, year, goal } = input;
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const asOf = addDays(today, -1);
  const runRateDays = input.runRateDays ?? DEFAULT_RUN_RATE_DAYS;

  const coverageLate = input.coverageStart != null && input.coverageStart > yearStart;
  const missingPreCoverage = coverageLate && goal.preCoverageActual == null;
  const planStart = missingPreCoverage && input.coverageStart ? input.coverageStart : yearStart;

  const refund = (date: string) => input.orderRefundsByDay?.get(date) ?? 0;
  const net = (d: DailyNet) => d.allChannels - refund(d.date);
  const inYear = input.ytdDaily.filter((d) => d.date >= yearStart && d.date <= yearEnd);
  const done = inYear.filter((d) => d.date <= asOf);
  const pre = goal.preCoverageActual ?? 0;

  const actualToDate = pre + done.reduce((sum, d) => sum + net(d), 0);
  const actualIncludingToday = pre + inYear.filter((d) => d.date <= today).reduce((sum, d) => sum + net(d), 0);
  const refundDeductedAmount = input.orderRefundsByDay
    ? inYear.filter((d) => d.date <= today).reduce((sum, d) => sum + refund(d.date), 0)
    : 0;

  const planToDate = planBetween(year, goal.monthlyTargets, planStart, minDay(asOf, yearEnd));
  const paceRatio = planToDate > 0 ? actualToDate / planToDate : null;
  const paceGap = actualToDate - planToDate;

  const remainingDays = today > yearEnd ? 0 : daysBetweenInclusive(maxDay(today, yearStart), yearEnd);
  const remainingAmount = Math.max(goal.annualTarget - actualToDate, 0);
  const requiredDaily = remainingDays > 0 ? remainingAmount / remainingDays : 0;

  const recent = done.slice(-runRateDays);
  const avg = (pick: (d: DailyNet) => number) => (recent.length > 0 ? recent.reduce((s, d) => s + pick(d), 0) / recent.length : 0);
  const currentDaily = avg(net);
  const currentDailyOwnMall = avg((d) => d.ownMall - refund(d.date));
  const currentDailyExternal = avg((d) => d.allChannels - d.ownMall);
  const landing = actualToDate + currentDaily * remainingDays;

  return {
    asOf,
    annualTarget: goal.annualTarget,
    actualToDate,
    actualIncludingToday,
    planToDate,
    annualAchievement: goal.annualTarget > 0 ? actualToDate / goal.annualTarget : 0,
    paceRatio,
    paceGap,
    paceTone: paceRatio == null ? 'unknown' : paceRatio >= 1 ? 'ahead' : 'behind',
    remainingAmount,
    exceeded: actualToDate >= goal.annualTarget,
    remainingDays,
    requiredDaily,
    currentDaily,
    currentDailyOwnMall,
    currentDailyExternal,
    runRateDaysUsed: recent.length,
    requiredLift: currentDaily > 0 ? requiredDaily / currentDaily - 1 : null,
    landing,
    landingRatio: goal.annualTarget > 0 ? landing / goal.annualTarget : 0,
    planStart,
    missingPreCoverage,
    refundDeducted: input.orderRefundsByDay != null,
    refundDeductedAmount,
  };
}
