import type { CalendarLeave } from '@packages/domain-types/attendance';
import type { LeaveDraft } from './attendance-model';

export function shiftCalendarDate(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);

  result.setUTCDate(result.getUTCDate() + days);

  return result.toISOString().slice(0, 10);
}

export function calendarDays(month: string): string[] {
  const first = `${month}-01`;
  const date = new Date(`${first}T00:00:00Z`);
  const offset = date.getUTCDay();
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const count = Math.ceil((offset + last) / 7) * 7;

  return Array.from({ length: count }, (_, index) =>
    shiftCalendarDate(first, index - offset)
  );
}

interface CalendarEvent {
  id: string;
  userId: string;
  name: string;
  type: CalendarLeave['type'];
  from: string;
  to: string;
}

export interface CalendarSegment extends CalendarEvent {
  column: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function buildCalendarWeeks(month: string, leaves: CalendarLeave[]) {
  const days = calendarDays(month);
  const events: CalendarEvent[] = [];
  const sorted = [...leaves].sort(
    (a, b) => a.userId.localeCompare(b.userId) || a.date.localeCompare(b.date)
  );

  for (const leave of sorted) {
    const previous = events.at(-1);
    const joinsPrevious =
      leave.type === 'full' &&
      previous?.type === 'full' &&
      previous.userId === leave.userId &&
      shiftCalendarDate(previous.to, 1) === leave.date;

    if (joinsPrevious && previous) {
      previous.to = leave.date;
    } else {
      events.push({
        id: leave.id,
        userId: leave.userId,
        name: leave.name,
        type: leave.type,
        from: leave.date,
        to: leave.date,
      });
    }
  }

  const weeks: { days: string[]; segments: CalendarSegment[] }[] = [];

  for (let index = 0; index < days.length; index += 7) {
    const week = days.slice(index, index + 7);
    const overlapping = events.filter(
      (event) => event.from <= week[6] && event.to >= week[0]
    );

    overlapping.sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        b.to.localeCompare(a.to) ||
        a.userId.localeCompare(b.userId)
    );

    const occupied: number[] = [];
    const segments = overlapping.map((event) => {
      const from = event.from < week[0] ? week[0] : event.from;
      const to = event.to > week[6] ? week[6] : event.to;
      const column = week.indexOf(from) + 1;
      const span = week.indexOf(to) - column + 2;
      let lane = occupied.findIndex((end) => end < column);

      if (lane === -1) {
        lane = occupied.length;
      }

      occupied[lane] = column + span - 1;

      return {
        ...event,
        column,
        span,
        lane,
        continuesBefore: event.from < week[0],
        continuesAfter: event.to > week[6],
      };
    });

    weeks.push({ days: week, segments });
  }

  return weeks;
}

export function resolveRangeDrafts(
  dates: string[],
  common: LeaveDraft,
  exceptions: Record<string, LeaveDraft>
): LeaveDraft[] {
  return dates.map((date) => exceptions[date] ?? { ...common, date });
}
