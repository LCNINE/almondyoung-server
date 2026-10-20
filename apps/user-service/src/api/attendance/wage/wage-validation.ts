import { BadRequestError } from '@app/shared';
import type { ScheduleDay, WageRules } from '@packages/domain-types/attendance-wage';

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

type Field = Record<string, unknown>;

function isField(value: unknown): value is Field {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, name: string): Field {
  if (!isField(value)) {
    throw new BadRequestError(`계산 규칙의 ${name} 항목이 비어 있어요.`);
  }

  return value;
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], name: string): T {
  const found = allowed.find((candidate) => candidate === value);

  if (found === undefined) {
    throw new BadRequestError(`계산 규칙의 ${name} 값이 올바르지 않아요.`);
  }

  return found;
}

function flag(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadRequestError(`계산 규칙의 ${name} 값이 올바르지 않아요.`);
  }

  return value;
}

function ratio(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestError(`계산 규칙의 ${name} 은(는) ${min}~${max} 사이여야 해요.`);
  }

  // 천분율 정수로 계산하므로 소수 셋째 자리까지만 받는다(부동소수 오차는 허용하고 정규화한다).
  const permille = Math.round(value * 1000);

  if (Math.abs(permille - value * 1000) > 1e-6) {
    throw new BadRequestError(`계산 규칙의 ${name} 은(는) 소수 셋째 자리까지 넣어 주세요.`);
  }

  return permille / 1000;
}

function clock(value: unknown, name: string): string {
  if (typeof value !== 'string' || !CLOCK.test(value)) {
    throw new BadRequestError(`${name} 시각은 HH:mm 형식으로 넣어 주세요.`);
  }

  return value;
}

export function isCalendarDate(value: string): boolean {
  return DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function requireDate(value: string, name: string): string {
  if (!isCalendarDate(value)) {
    throw new BadRequestError(`${name}을(를) YYYY-MM-DD 형식으로 넣어 주세요.`);
  }

  return value;
}

/** 저장할 계산 규칙. 알 수 없는 항목은 버리고 아는 항목만 검증해 다시 만든다. */
export function parseWageRules(input: unknown): WageRules {
  const rules = field(input, '전체');
  const rounding = field(rules.rounding, '반올림');
  const schedule = field(rules.schedule, '시간표');
  const overtime = field(rules.overtime, '연장');
  const night = field(rules.night, '야간');
  const weeklyHoliday = field(rules.weeklyHoliday, '주휴');
  const leave = field(rules.leavePaidDefault, '휴가');
  const wageRounding = field(rules.wageRounding, '금액 절사');

  return {
    breakDeduction: oneOf(rules.breakDeduction, ['legal', 'schedule', 'none'] as const, '휴게'),
    rounding: {
      unitMinutes: oneOf(rounding.unitMinutes, [1, 5, 10, 15, 30] as const, '반올림 단위'),
      mode: oneOf(rounding.mode, ['floor', 'nearest', 'ceil'] as const, '반올림 방식'),
    },
    workplaceFivePlus: flag(rules.workplaceFivePlus, '5인 이상'),
    schedule: { mode: oneOf(schedule.mode, ['auto', 'fixed', 'flexible'] as const, '시간표 방식') },
    overtime: {
      enabled: flag(overtime.enabled, '연장 가산'),
      rate: ratio(overtime.rate, 1, 3, '연장 배율'),
      recognition: oneOf(overtime.recognition, ['manual', 'auto'] as const, '연장 인정 방식'),
      unrecognized: oneOf(overtime.unrecognized, ['unpaid', 'base'] as const, '불인정 연장 처리'),
    },
    night: {
      enabled: flag(night.enabled, '야간 가산'),
      extraRate: ratio(night.extraRate, 0, 2, '야간 가산율'),
      start: clock(night.start, '야간 시작'),
      end: clock(night.end, '야간 끝'),
    },
    weeklyHoliday: {
      enabled: flag(weeklyHoliday.enabled, '주휴'),
      minWeeklyHours: ratio(weeklyHoliday.minWeeklyHours, 0, 40, '주휴 최소 시간'),
      weekStartsOn: oneOf(weeklyHoliday.weekStartsOn, [1, 7] as const, '주 시작 요일'),
    },
    leavePaidDefault: {
      full: flag(leave.full, '종일 휴가'),
      am: flag(leave.am, '오전 휴가'),
      pm: flag(leave.pm, '오후 휴가'),
    },
    wageRounding: {
      unit: oneOf(wageRounding.unit, [1, 10] as const, '금액 절사 단위'),
      mode: oneOf(wageRounding.mode, ['floor'] as const, '금액 절사 방식'),
    },
  };
}

/** 근무 시간표의 요일 목록. 같은 요일이 두 번 나오면 그날 소정근로가 모호해진다. */
export function parseScheduleDays(days: readonly ScheduleDay[]): ScheduleDay[] {
  const seen = new Set<number>();

  return days.map((day) => {
    if (seen.has(day.weekday)) {
      throw new BadRequestError('같은 요일이 두 번 들어 있어요.');
    }

    seen.add(day.weekday);

    const start = clock(day.start, '근무 시작');
    const end = clock(day.end, '근무 끝');

    if (start === end) {
      throw new BadRequestError('근무 시작과 끝 시각이 같아요.');
    }

    return day.breakMinutes === undefined
      ? { weekday: day.weekday, start, end }
      : { weekday: day.weekday, start, end, breakMinutes: day.breakMinutes };
  });
}
