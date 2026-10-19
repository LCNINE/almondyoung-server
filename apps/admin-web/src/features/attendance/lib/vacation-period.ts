import {
  type CalendarLeave,
  type LeaveInput,
} from '@packages/domain-types/attendance';
import { dateRange } from './attendance-model';

export function vacationDdayLabel(date: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000
  );

  return days === 0 ? 'D-day' : days > 0 ? `D-${days}` : `D+${Math.abs(days)}`;
}

export function vacationPeriodDays({
  from,
  to,
  allDay,
  startTime,
  endTime,
  normalStart,
  normalEnd,
  existingDay,
  periodChanged = false,
}: {
  from: string;
  to: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  normalStart: string;
  normalEnd: string;
  existingDay?: Pick<CalendarLeave, 'date' | 'type' | 'start' | 'end'>;
  periodChanged?: boolean;
}): LeaveInput[] {
  const dates = dateRange(from, to);

  if (!dates.length) {
    throw new Error('시작과 종료 날짜를 확인해 주세요.');
  }

  if (
    existingDay &&
    !periodChanged &&
    from === existingDay.date &&
    to === from
  ) {
    return [
      {
        date: existingDay.date,
        type: existingDay.type,
        ...(existingDay.type === 'full'
          ? {}
          : {
              start: existingDay.start ?? undefined,
              end: existingDay.end ?? undefined,
            }),
      },
    ];
  }

  if (allDay) {
    return dates.map((date) => ({ date, type: 'full' }));
  }

  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  if (
    ![startTime, endTime, normalStart, normalEnd].every(validClock) ||
    startTime < normalStart ||
    startTime >= normalEnd ||
    endTime <= normalStart ||
    endTime > normalEnd ||
    (from === to && startTime >= endTime)
  ) {
    throw new Error(
      '휴가 시작과 종료 시각을 평소 근무 시간 안에서 확인해 주세요.'
    );
  }

  return dates.map((date): LeaveInput => {
    const starts = date === from ? startTime : normalStart;
    const ends = date === to ? endTime : normalEnd;

    if (starts === normalStart && ends === normalEnd) {
      return { date, type: 'full' };
    }

    if (starts === normalStart) {
      return { date, type: 'am', start: ends, end: normalEnd };
    }

    if (ends === normalEnd) {
      return { date, type: 'pm', start: normalStart, end: starts };
    }

    throw new Error(
      '반차는 근무 시작 또는 종료에 이어지는 시간으로 선택해 주세요.'
    );
  });
}
