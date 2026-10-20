import type {
  AbsenceKind,
  PayBasis,
  ScheduleDay,
  SettlementAmounts,
  SettlementDay,
  SettlementIssue,
  SettlementIssueKind,
  SettlementPerson,
  SettlementResult,
  SettlementWarning,
  WageRules,
  Weekday,
} from '@packages/domain-types/attendance-wage';

export interface EffectiveWage {
  effectiveFrom: string;
  hourlyWage: number;
}

export interface ScheduleRange {
  effectiveFrom: string;
  effectiveTo: string | null;
  days: ScheduleDay[];
}

export interface SettlementPersonInput {
  userId: string;
  name: string;
  onRoster: boolean;
  hireDate: string | null;
  leaveDate: string | null;
  rates: EffectiveWage[];
  schedules: ScheduleRange[];
  /** 기간 시작 6일 전부터 기간 끝까지 — 기간 첫 주의 주휴·주 40시간 판정에 앞 날짜가 필요하다. */
  sessions: { workDate: string; checkIn: Date; checkOut: Date | null }[];
  overtime: { workDate: string; status: 'recognized' | 'rejected'; recognizedMinutes: number }[];
  absences: { workDate: string; kind: AbsenceKind }[];
}

export interface SettlementInput {
  group: { id: string; payBasis: PayBasis };
  period: { periodStart: string; periodEnd: string; payday: string };
  /** 한국 날짜. 오늘 이후는 결근·퇴근 누락을 따지지 않고, 끝나지 않은 주의 주휴는 계산하지 않는다. */
  today: string;
  rules: WageRules;
  minimumWages: EffectiveWage[];
  people: SettlementPersonInput[];
}

const DAY_MS = 24 * 3600000;
const KST_OFFSET_MINUTES = 9 * 60;
const DAILY_LIMIT = 8 * 60;
const WEEKLY_LIMIT = 40 * 60;
const WEEKLY_WARNING = 52 * 60;
/** 배율은 천분율 정수로 곱해 부동소수 금액 연산을 피한다. */
const PERMILLE = 1000;

const ISSUE_ORDER: SettlementIssueKind[] = [
  'not_on_roster',
  'outside_employment',
  'no_rate',
  'missing_checkout',
  'overtime_undecided',
  'absence_undecided',
];

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = [7, 1, 2, 3, 4, 5, 6];

function weekdayOf(date: string): Weekday {
  return WEEKDAY_BY_UTC_DAY[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? 7;
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }

  return dates;
}

function clockMinutes(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number);

  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** 근로기준법 제54조 — 4시간이면 30분, 8시간이면 1시간. 체류 시간으로 판정한다. */
function legalBreak(stayMinutes: number): number {
  if (stayMinutes >= DAILY_LIMIT + 60) {
    return 60;
  }

  if (stayMinutes >= 4 * 60 + 30) {
    return 30;
  }

  return 0;
}

function roundMinutes(minutes: number, rounding: WageRules['rounding']): number {
  const units = minutes / rounding.unitMinutes;
  const rounded =
    rounding.mode === 'floor' ? Math.floor(units) : rounding.mode === 'ceil' ? Math.ceil(units) : Math.round(units);

  return rounded * rounding.unitMinutes;
}

function effectiveOn<T extends { effectiveFrom: string }>(history: readonly T[], date: string): T | null {
  let found: T | null = null;

  for (const entry of history) {
    if (entry.effectiveFrom <= date && (!found || entry.effectiveFrom > found.effectiveFrom)) {
      found = entry;
    }
  }

  return found;
}

function scheduleOn(schedules: readonly ScheduleRange[], date: string): ScheduleRange | null {
  return effectiveOn(
    schedules.filter((schedule) => schedule.effectiveTo === null || date <= schedule.effectiveTo),
    date,
  );
}

function scheduledLength(day: ScheduleDay): number {
  const start = clockMinutes(day.start);
  const end = clockMinutes(day.end);
  const span = end > start ? end - start : end + 24 * 60 - start;

  return Math.max(0, span - (day.breakMinutes ?? legalBreak(span)));
}

/** 근무 구간이 야간 창(KST 벽시계)과 겹치는 분. */
function nightOverlap(checkIn: Date, checkOut: Date, night: WageRules['night']): number {
  const from = Math.floor(checkIn.getTime() / 60000) + KST_OFFSET_MINUTES;
  const to = Math.floor(checkOut.getTime() / 60000) + KST_OFFSET_MINUTES;
  const start = clockMinutes(night.start);
  const end = clockMinutes(night.end);
  let overlap = 0;

  for (let day = Math.floor(from / 1440) - 1; day <= Math.floor(to / 1440); day++) {
    const windowStart = day * 1440 + start;
    const windowEnd = end > start ? day * 1440 + end : (day + 1) * 1440 + end;

    overlap += Math.max(0, Math.min(to, windowEnd) - Math.max(from, windowStart));
  }

  return overlap;
}

interface DayLine extends SettlementDay {
  checkIn: Date | null;
  checkOut: Date | null;
  fixed: boolean;
  regularMinutes: number;
  missingCheckout: boolean;
  employed: boolean;
}

interface PersonContext {
  input: SettlementInput;
  person: SettlementPersonInput;
  weekStartOf: (date: string) => string;
}

function buildDay(context: PersonContext, date: string): DayLine {
  const { input, person } = context;
  const { rules, today } = input;

  const employed = (!person.hireDate || date >= person.hireDate) && (!person.leaveDate || date <= person.leaveDate);
  const schedule = scheduleOn(person.schedules, date);
  const fixed = rules.schedule.mode === 'fixed' || (rules.schedule.mode === 'auto' && schedule !== null);
  const scheduleDay = fixed ? schedule?.days.find((entry) => entry.weekday === weekdayOf(date)) : undefined;
  const scheduledMinutes = employed && scheduleDay ? scheduledLength(scheduleDay) : 0;

  const session = person.sessions.find((entry) => entry.workDate === date);
  let workedMinutes = 0;
  let nightMinutes = 0;

  if (session?.checkOut) {
    const stay = Math.max(0, Math.floor((session.checkOut.getTime() - session.checkIn.getTime()) / 60000));
    const deduction =
      rules.breakDeduction === 'none'
        ? 0
        : rules.breakDeduction === 'schedule'
          ? (scheduleDay?.breakMinutes ?? legalBreak(stay))
          : legalBreak(stay);

    workedMinutes = roundMinutes(Math.max(0, stay - deduction), rules.rounding);
    // 휴게는 낮 시간에서 먼저 뺀다 — 야간분이 실근로를 넘지 않게만 자른다.
    nightMinutes = Math.min(nightOverlap(session.checkIn, session.checkOut, rules.night), workedMinutes);
  }

  let absence: SettlementDay['absence'] = 'none';

  if (scheduledMinutes > 0 && !session && date < today) {
    absence = person.absences.find((entry) => entry.workDate === date)?.kind ?? 'undecided';
  }

  const overtimeRecordedMinutes = fixed ? Math.max(0, workedMinutes - scheduledMinutes) : 0;

  return {
    workDate: date,
    workedMinutes,
    scheduledMinutes,
    overtimeRecordedMinutes,
    overtimeRecognizedMinutes: null,
    nightMinutes,
    hourlyWage: effectiveOn(person.rates, date)?.hourlyWage ?? null,
    absence,
    fixed,
    checkIn: session?.checkIn ?? null,
    checkOut: session?.checkOut ?? null,
    regularMinutes: workedMinutes - overtimeRecordedMinutes,
    missingCheckout: !!session && !session.checkOut && date < today,
    employed,
  };
}

/** 시간표가 없는 날은 하루 8시간·주 40시간을 넘는 몫이 연장이다(주 초과는 주 끝 쪽 날에 붙는다). */
function applyFlexibleLimits(context: PersonContext, lines: DayLine[]) {
  let week = '';
  let regularSoFar = 0;

  for (const line of lines) {
    const start = context.weekStartOf(line.workDate);

    if (start !== week) {
      week = start;
      regularSoFar = 0;
    }

    if (!line.fixed) {
      const daily = Math.max(0, line.workedMinutes - DAILY_LIMIT);
      const candidate = line.workedMinutes - daily;
      const weekly = Math.max(0, regularSoFar + candidate - WEEKLY_LIMIT) - Math.max(0, regularSoFar - WEEKLY_LIMIT);

      line.overtimeRecordedMinutes = daily + weekly;
      line.regularMinutes = line.workedMinutes - line.overtimeRecordedMinutes;
    }

    regularSoFar += line.regularMinutes;
  }
}

function recognize(context: PersonContext, line: DayLine) {
  if (line.overtimeRecordedMinutes === 0) {
    line.overtimeRecognizedMinutes = 0;

    return;
  }

  if (context.input.rules.overtime.recognition === 'auto') {
    line.overtimeRecognizedMinutes = line.overtimeRecordedMinutes;

    return;
  }

  const decision = context.person.overtime.find((entry) => entry.workDate === line.workDate);

  if (decision) {
    line.overtimeRecognizedMinutes =
      decision.status === 'recognized' ? Math.min(decision.recognizedMinutes, line.overtimeRecordedMinutes) : 0;
  }
}

function toWon(numerator: number, rules: WageRules): number {
  const unit = rules.wageRounding.unit;

  return Math.floor(numerator / (60 * PERMILLE) / unit) * unit;
}

function computePerson(
  input: SettlementInput,
  person: SettlementPersonInput,
  issues: SettlementIssue[],
): SettlementPerson {
  const { rules, period, today } = input;
  const hourly = input.group.payBasis === 'hourly';
  const fivePlus = rules.workplaceFivePlus;

  const weekStartOf = (date: string) => {
    const weekday = weekdayOf(date);
    const back = rules.weeklyHoliday.weekStartsOn === 1 ? weekday - 1 : weekday % 7;

    return addDays(date, -back);
  };
  const context: PersonContext = { input, person, weekStartOf };

  const lines = datesBetween(weekStartOf(period.periodStart), period.periodEnd).map((date) => buildDay(context, date));

  applyFlexibleLimits(context, lines);

  for (const line of lines) {
    recognize(context, line);
  }

  const inPeriod = (date: string) => date >= period.periodStart && date <= period.periodEnd;
  const personIssues = new Map<string, SettlementIssue>();
  const raise = (workDate: string | null, kind: SettlementIssueKind) => {
    personIssues.set(`${workDate}:${kind}`, { userId: person.userId, workDate, kind });
  };

  // 가산은 켜짐 여부만 본다 — 5인 미만이라도 약정했으면 켠다(5인 여부는 처음 기본값과 경고에만 쓴다).
  const overtimeRate = rules.overtime.enabled ? Math.round(rules.overtime.rate * PERMILLE) : PERMILLE;
  const nightRate = rules.night.enabled ? Math.round(rules.night.extraRate * PERMILLE) : 0;
  const numerators = { regular: 0, overtime: 0, night: 0, weeklyHoliday: 0, paidLeave: 0 };
  const warnings = new Set<SettlementWarning>();

  for (const line of lines.filter((entry) => inPeriod(entry.workDate))) {
    if (line.missingCheckout) {
      raise(line.workDate, 'missing_checkout');
    }

    if (!hourly) {
      continue;
    }

    // 명단의 입사·퇴사일 밖 기록은 금액에 넣지 않고 확인을 요구한다.
    if (!line.employed && line.workedMinutes > 0) {
      raise(line.workDate, 'outside_employment');

      continue;
    }

    if (line.overtimeRecognizedMinutes === null) {
      raise(line.workDate, 'overtime_undecided');
    }

    if (line.absence === 'undecided') {
      raise(line.workDate, 'absence_undecided');
    }

    const recognized = line.overtimeRecognizedMinutes ?? 0;
    const unrecognized = line.overtimeRecognizedMinutes === null ? 0 : line.overtimeRecordedMinutes - recognized;
    const basePaid = rules.overtime.unrecognized === 'base' ? unrecognized : 0;
    const leaveMinutes = line.absence === 'excused_paid' ? line.scheduledMinutes : 0;
    const wage = line.hourlyWage;

    if (line.workedMinutes + leaveMinutes === 0) {
      continue;
    }

    if (wage === null) {
      raise(line.workDate, 'no_rate');

      continue;
    }

    const minimum = effectiveOn(input.minimumWages, line.workDate);

    if (minimum && wage < minimum.hourlyWage) {
      warnings.add('below_minimum_wage');
    }

    const paidMinutes = line.regularMinutes + recognized + basePaid;
    // 지급하지 않는(불인정·미판정) 초과 시간은 그날 마지막 시간으로 본다 — 그 몫의 야간은 가산하지 않는다.
    const unpaidMinutes = line.overtimeRecordedMinutes - recognized - basePaid;
    const nightPaid =
      line.checkIn && line.checkOut
        ? Math.min(
            nightOverlap(line.checkIn, new Date(line.checkOut.getTime() - unpaidMinutes * 60000), rules.night),
            line.nightMinutes,
            paidMinutes,
          )
        : 0;

    numerators.regular += (line.regularMinutes + basePaid) * wage * PERMILLE;
    numerators.overtime += recognized * wage * overtimeRate;
    numerators.night += nightPaid * wage * nightRate;
    numerators.paidLeave += leaveMinutes * wage * PERMILLE;
  }

  let weeklyHolidayMinutes = 0;
  const weekStarts = [...new Set(lines.map((line) => weekStartOf(line.workDate)))];

  for (const start of weekStarts) {
    const end = addDays(start, 6);
    const week = lines.filter((line) => weekStartOf(line.workDate) === start);
    const worked = week.reduce((sum, line) => sum + line.workedMinutes, 0);

    if (fivePlus && worked > WEEKLY_WARNING && week.some((line) => inPeriod(line.workDate))) {
      warnings.add('over_52_hours');
    }

    if (!hourly || !rules.weeklyHoliday.enabled || !inPeriod(end) || end >= today) {
      continue;
    }

    const employedDays = week.filter((line) => line.employed);
    // 시간표가 있는 날은 소정시간, 없는 날은 인정한 실근로(정상 + 인정 연장)로 센다.
    const base = employedDays.reduce(
      (sum, line) =>
        sum + (line.fixed ? line.scheduledMinutes : line.regularMinutes + (line.overtimeRecognizedMinutes ?? 0)),
      0,
    );

    if (base < rules.weeklyHoliday.minWeeklyHours * 60 || employedDays.some((line) => line.absence === 'absent')) {
      continue;
    }

    // 앞 기간 날짜라도 그 주의 기록이 덜 끝났으면 주휴를 정할 수 없다.
    const pending: [DayLine, SettlementIssueKind][] = employedDays.flatMap((line): [DayLine, SettlementIssueKind][] => [
      ...(line.missingCheckout ? [[line, 'missing_checkout'] satisfies [DayLine, SettlementIssueKind]] : []),
      ...(line.absence === 'undecided' ? [[line, 'absence_undecided'] satisfies [DayLine, SettlementIssueKind]] : []),
      ...(!line.fixed && line.overtimeRecognizedMinutes === null
        ? [[line, 'overtime_undecided'] satisfies [DayLine, SettlementIssueKind]]
        : []),
    ]);

    if (pending.length > 0) {
      for (const [line, kind] of pending) {
        raise(line.workDate, kind);
      }

      continue;
    }

    const wage = effectiveOn(person.rates, end)?.hourlyWage ?? null;

    if (wage === null) {
      raise(end, 'no_rate');

      continue;
    }

    const minutes = Math.floor(Math.min(base, WEEKLY_LIMIT) / 5);

    weeklyHolidayMinutes += minutes;
    numerators.weeklyHoliday += minutes * wage * PERMILLE;
  }

  if (hourly && rules.rounding.unitMinutes !== 1) {
    warnings.add('rounding_unit');
  }

  let amounts: SettlementAmounts | null = null;

  if (hourly) {
    const regular = toWon(numerators.regular, rules);
    const overtime = toWon(numerators.overtime, rules);
    const night = toWon(numerators.night, rules);
    const weeklyHoliday = toWon(numerators.weeklyHoliday, rules);
    const paidLeave = toWon(numerators.paidLeave, rules);

    amounts = {
      regular,
      overtime,
      night,
      weeklyHoliday,
      paidLeave,
      total: regular + overtime + night + weeklyHoliday + paidLeave,
    };
  }

  issues.push(...personIssues.values());

  return {
    userId: person.userId,
    name: person.name,
    days: lines
      .filter(
        (line) =>
          inPeriod(line.workDate) &&
          (line.workedMinutes > 0 || line.missingCheckout || line.scheduledMinutes > 0 || line.absence !== 'none'),
      )
      .map(
        (line): SettlementDay => ({
          workDate: line.workDate,
          workedMinutes: line.workedMinutes,
          scheduledMinutes: line.scheduledMinutes,
          overtimeRecordedMinutes: line.overtimeRecordedMinutes,
          overtimeRecognizedMinutes: line.overtimeRecognizedMinutes,
          nightMinutes: line.nightMinutes,
          hourlyWage: line.hourlyWage,
          absence: line.absence,
        }),
      ),
    weeklyHolidayMinutes,
    amounts,
    complete: personIssues.size === 0,
    warnings: [...warnings],
  };
}

/** 한 급여 기간의 사람별 세전 지급 기준액. 계산 못 한 몫은 0 으로 넣지 않고 `issues` 로 돌려준다. */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const issues: SettlementIssue[] = [];
  const people: SettlementPerson[] = [];

  for (const person of input.people) {
    if (!person.onRoster) {
      issues.push({ userId: person.userId, workDate: null, kind: 'not_on_roster' });

      continue;
    }

    people.push(computePerson(input, person, issues));
  }

  const order = new Map(input.people.map((person, index) => [person.userId, index]));

  issues.sort(
    (a, b) =>
      (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0) ||
      (a.workDate ?? '').localeCompare(b.workDate ?? '') ||
      ISSUE_ORDER.indexOf(a.kind) - ISSUE_ORDER.indexOf(b.kind),
  );

  return {
    groupId: input.group.id,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    payday: input.period.payday,
    rules: input.rules,
    people,
    issues,
    totals: {
      people: people.length,
      total: people.reduce((sum, person) => sum + (person.amounts?.total ?? 0), 0),
      complete: issues.length === 0,
    },
  };
}
