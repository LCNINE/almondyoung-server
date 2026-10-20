import { BadRequestException } from '@nestjs/common';
import { clockMinutes, isWorkDate, type LeaveType } from '@packages/domain-types/attendance';

export const LEAVE_REMINDER_GRACE_MS = 5 * 60000;
export const MAX_LEAVE_REMINDER_MINUTES = 525600;

interface ReminderLeave {
  date: string;
  type: LeaveType;
  end: string | null;
  reminderMinutes: number[];
  reminderSetAt: Date | null;
}

interface LeaveReminderTrigger {
  minutes: number;
  startAt: string;
  scheduledFor: string;
}

export function leaveReminderStart(
  leave: Pick<ReminderLeave, 'date' | 'type' | 'end'>,
  normalStart: string,
): Date | null {
  const time = leave.type === 'full' ? '09:00' : leave.type === 'am' ? normalStart : leave.end;

  if (!isWorkDate(leave.date) || !time || clockMinutes(time) === null) {
    return null;
  }

  return new Date(`${leave.date}T${time}:00+09:00`);
}

export function dueLeaveReminders(leave: ReminderLeave, normalStart: string, now: Date): LeaveReminderTrigger[] {
  const start = leaveReminderStart(leave, normalStart);

  if (!start || !leave.reminderSetAt) {
    return [];
  }

  const configuredAt = leave.reminderSetAt.getTime();

  return leave.reminderMinutes.flatMap((minutes) => {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_LEAVE_REMINDER_MINUTES) {
      return [];
    }

    const scheduledFor = start.getTime() - minutes * 60000;
    const age = now.getTime() - scheduledFor;

    if (scheduledFor < configuredAt || age < 0 || age >= LEAVE_REMINDER_GRACE_MS) {
      return [];
    }

    return [{ minutes, startAt: start.toISOString(), scheduledFor: new Date(scheduledFor).toISOString() }];
  });
}

export function validateLeaveReminderMinutes(value: unknown): asserts value is number[] {
  if (
    !Array.isArray(value) ||
    value.length > 5 ||
    value.some((minutes) => !Number.isInteger(minutes) || minutes < 0 || minutes > MAX_LEAVE_REMINDER_MINUTES) ||
    new Set(value).size !== value.length
  ) {
    throw new BadRequestException('휴가 알림은 0~525600분 전으로 최대 5개까지 중복 없이 선택해 주세요.');
  }
}
