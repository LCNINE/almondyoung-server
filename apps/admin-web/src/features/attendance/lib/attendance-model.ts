import {
  halfDaySchedule,
  isWorkDate,
  LEAVE_LABELS,
  STATUS_LABELS,
  validatePlannedTimes,
  type AttendanceStatus,
  type LeaveInput,
  type LeaveType,
} from '@packages/domain-types/attendance';

export interface LeaveDraft extends LeaveInput {
  manualEnd?: boolean;
}

export function describeStatus(
  status: AttendanceStatus,
  leave?: LeaveType | null
): string {
  return STATUS_LABELS[status] + (leave ? ' · ' + LEAVE_LABELS[leave] : '');
}

export function changeLeaveType(
  day: LeaveDraft,
  type: LeaveType,
  normalStart: string,
  normalEnd: string
): LeaveDraft {
  const planned = halfDaySchedule(normalStart, type);

  return {
    date: day.date,
    type,
    start: planned.start,
    end: type === 'am' ? normalEnd : planned.end,
    manualEnd: false,
  };
}

export function changeStart(
  day: LeaveDraft,
  start: string,
  normalEnd: string
): LeaveDraft {
  return {
    ...day,
    start,
    end: day.type === 'am' && !day.manualEnd ? normalEnd : day.end,
  };
}

export function validateDraft(day: LeaveDraft): string | null {
  if (!isWorkDate(day.date)) {
    return '날짜를 확인해 주세요.';
  }

  return day.type === 'full'
    ? null
    : validatePlannedTimes(day.start ?? '', day.end ?? '');
}

export function dateRange(from: string, to: string): string[] {
  if (!isWorkDate(from) || !isWorkDate(to) || to < from) {
    return [];
  }

  const result: string[] = [];

  for (
    let date = new Date(from + 'T00:00:00Z');
    date <= new Date(to + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (result.length >= 366) {
      return [];
    }

    result.push(date.toISOString().slice(0, 10));
  }

  return result;
}

export function formatAttendanceTime(
  instant: string | null | undefined
): string {
  return instant
    ? new Date(instant).toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
}
