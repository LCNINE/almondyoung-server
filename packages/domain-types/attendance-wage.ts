/**
 * 근태 시급·급여 정산의 공유 타입과 규칙.
 *
 * 금액은 정수 원, 시간은 정수 분, 날짜는 한국 날짜(YYYY-MM-DD) 문자열이다.
 * 계산 규칙은 전부 급여 그룹의 설정값이고, 여기 있는 것은 처음 만들 때의 기본값이다.
 */

export type PayBasis = 'hourly' | 'salaried';

export interface WageRules {
  breakDeduction: 'legal' | 'schedule' | 'none';
  rounding: { unitMinutes: 1 | 5 | 10 | 15 | 30; mode: 'floor' | 'nearest' | 'ceil' };
  workplaceFivePlus: boolean;
  schedule: { mode: 'auto' | 'fixed' | 'flexible' };
  overtime: { enabled: boolean; rate: number; recognition: 'manual' | 'auto'; unrecognized: 'unpaid' | 'base' };
  night: { enabled: boolean; extraRate: number; start: string; end: string };
  weeklyHoliday: { enabled: boolean; minWeeklyHours: number; weekStartsOn: 1 | 7 };
  leavePaidDefault: { full: boolean; am: boolean; pm: boolean };
  wageRounding: { unit: 1 | 10; mode: 'floor' };
}

export const DEFAULT_WAGE_RULES: WageRules = {
  breakDeduction: 'legal',
  rounding: { unitMinutes: 1, mode: 'floor' },
  workplaceFivePlus: true,
  schedule: { mode: 'auto' },
  overtime: { enabled: true, rate: 1.5, recognition: 'manual', unrecognized: 'unpaid' },
  night: { enabled: true, extraRate: 0.5, start: '22:00', end: '06:00' },
  weeklyHoliday: { enabled: true, minWeeklyHours: 15, weekStartsOn: 1 },
  leavePaidDefault: { full: false, am: false, pm: false },
  wageRounding: { unit: 1, mode: 'floor' },
};

/** 처음 만들 때의 규칙. 상시 5인 미만이면 연장·야간 가산을 끈 채 시작한다(약정하면 켠다). */
export function defaultWageRules(workplaceFivePlus: boolean): WageRules {
  return {
    ...DEFAULT_WAGE_RULES,
    workplaceFivePlus,
    overtime: { ...DEFAULT_WAGE_RULES.overtime, enabled: workplaceFivePlus },
    night: { ...DEFAULT_WAGE_RULES.night, enabled: workplaceFivePlus },
  };
}

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ScheduleDay {
  weekday: Weekday;
  start: string;
  end: string;
  breakMinutes?: number;
}

export type AbsenceKind = 'excused_paid' | 'excused_unpaid' | 'absent';

export type SettlementIssueKind =
  | 'missing_checkout'
  | 'no_rate'
  | 'overtime_undecided'
  | 'absence_undecided'
  | 'not_on_roster'
  | 'outside_employment';

export interface SettlementIssue {
  userId: string;
  workDate: string | null;
  kind: SettlementIssueKind;
}

export interface SettlementDay {
  workDate: string;
  workedMinutes: number;
  scheduledMinutes: number;
  overtimeRecordedMinutes: number;
  overtimeRecognizedMinutes: number | null;
  nightMinutes: number;
  hourlyWage: number | null;
  absence: 'none' | AbsenceKind | 'undecided';
}

export type SettlementWarning = 'below_minimum_wage' | 'rounding_unit' | 'over_52_hours';

export interface SettlementAmounts {
  regular: number;
  overtime: number;
  night: number;
  weeklyHoliday: number;
  paidLeave: number;
  total: number;
}

export interface SettlementPerson {
  userId: string;
  name: string;
  days: SettlementDay[];
  weeklyHolidayMinutes: number;
  /** 월급제 그룹은 null — 근무시간 통계만 낸다. */
  amounts: SettlementAmounts | null;
  complete: boolean;
  warnings: SettlementWarning[];
}

export interface SettlementResult {
  groupId: string;
  periodStart: string;
  periodEnd: string;
  payday: string;
  rules: WageRules;
  people: SettlementPerson[];
  issues: SettlementIssue[];
  totals: { people: number; total: number; complete: boolean };
}

export interface PayCalendar {
  payday: number;
  /** 정산 마감일. 0 이면 말일. */
  periodCloseDay: number;
  /** 마감 달에서 지급 달까지의 개월 수(0 = 같은 달, 1 = 다음 달). */
  payMonthOffset: 0 | 1;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function lastDay(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function closeDate(year: number, monthIndex: number, closeDay: number): Date {
  const day = closeDay === 0 ? lastDay(year, monthIndex) : Math.min(closeDay, lastDay(year, monthIndex));

  return new Date(Date.UTC(year, monthIndex, day));
}

/** 지급 달(YYYY-MM)의 정산 기간과 지급일. 그 달에 없는 날짜는 말일로 당긴다. */
export function payPeriodFor(
  calendar: PayCalendar,
  paydayMonth: string,
): { periodStart: string; periodEnd: string; payday: string } {
  const match = MONTH.exec(paydayMonth);

  if (!match) {
    throw new Error(`invalid payday month: ${paydayMonth}`);
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  const payday = isoDate(year, monthIndex, Math.min(calendar.payday, lastDay(year, monthIndex)));

  const closeMonth = monthIndex - calendar.payMonthOffset;
  const end = closeDate(year, closeMonth, calendar.periodCloseDay);
  const previousEnd = closeDate(year, closeMonth - 1, calendar.periodCloseDay);

  const start = new Date(previousEnd.getTime() + 24 * 3600000);

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    payday,
  };
}

export interface PayGroup extends PayCalendar {
  id: string;
  name: string;
  payBasis: PayBasis;
  active: boolean;
  version: number;
}

export interface PayPolicy {
  id: string;
  groupId: string;
  effectiveFrom: string;
  rules: WageRules;
  createdAt: string;
}

export interface WageRate {
  id: string;
  effectiveFrom: string;
  hourlyWage: number;
}

export interface WorkSchedule {
  id: string;
  effectiveFrom: string;
  /** 기간 한정 시간표의 마지막 날. null 이면 다음 시간표가 시작될 때까지. */
  effectiveTo: string | null;
  days: ScheduleDay[];
}

export interface MinimumWage {
  effectiveFrom: string;
  hourlyWage: number;
}

export interface WageWorker {
  userId: string;
  name: string;
  /** 근태 직원(출퇴근을 찍을 수 있는 사람)인가. */
  isStaff: boolean;
  /** 근무자 명단에 있는가. 명단에 없는 근태 직원은 정산에서 «명단 없음»이 된다. */
  onRoster: boolean;
  groupId: string | null;
  hireDate: string | null;
  leaveDate: string | null;
  label: string | null;
  note: string | null;
  version: number | null;
  currentRate: number | null;
  currentSchedule: WorkSchedule | null;
}

export interface WageWorkerDetail extends WageWorker {
  rates: WageRate[];
  schedules: WorkSchedule[];
}

export interface WagePeriod {
  paydayMonth: string;
  periodStart: string;
  periodEnd: string;
  payday: string;
}

/** 판정할 날 — 시간표보다 길게 일한 날(연장)과 시간표상 근무일인데 기록이 없는 날(부재). */
export interface WageDecisionItem {
  userId: string;
  name: string;
  workDate: string;
  kind: 'overtime' | 'absence';
  recordedMinutes: number;
  overtime: {
    status: 'recognized' | 'rejected';
    recognizedMinutes: number;
    reason: string | null;
    version: number;
  } | null;
  absence: { kind: AbsenceKind; reason: string | null; version: number } | null;
  /** 부재일에 본인이 등록한 휴가(그대로 믿지 않고 판정의 참고로만 쓴다). */
  leave: 'full' | 'am' | 'pm' | null;
  /** 계산 규칙의 휴가 기본값으로 고른 추천 판정. */
  suggested: AbsenceKind | null;
}

export interface WageDecisions extends WagePeriod {
  items: WageDecisionItem[];
}

export interface SettlementSummary {
  id: string;
  groupId: string;
  periodStart: string;
  periodEnd: string;
  payday: string;
  status: 'confirmed' | 'reopened';
  total: number;
  confirmedAt: string;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface SettlementRecord extends SettlementSummary {
  snapshot: SettlementResult;
}

export interface MyWage extends WagePeriod {
  /** 확정본이면 confirmed, 아니면 지금 기록으로 계산한 예상. */
  status: 'confirmed' | 'estimate';
  person: SettlementPerson | null;
  /** 예상 금액에서 계산하지 못한 내 항목. 확정본은 항상 비어 있다. */
  issues: SettlementIssue[];
}
