import type { CalendarLeave } from '@packages/domain-types/attendance';
import {
  buildCalendarWeeks,
  calendarDays,
  resolveRangeDrafts,
  calendarLeavesForScope,
} from './calendar-layout';

function leave(
  date: string,
  userId = 'one',
  type: CalendarLeave['type'] = 'full'
): CalendarLeave {
  return {
    id: `${userId}-${date}`,
    userId,
    name: userId,
    date,
    type,
    start: null,
    end: null,
  };
}

describe('shared calendar ranges', () => {
  it('keeps personal view limited to the current employee and shows colleagues only in shared view', () => {
    const leaves = [leave('2026-10-16'), leave('2026-10-16', 'two')];

    expect(calendarLeavesForScope(leaves, 'one', 'personal')).toEqual([
      leaves[0],
    ]);
    expect(calendarLeavesForScope(leaves, 'one', 'shared')).toEqual(leaves);
    expect(calendarLeavesForScope(leaves, undefined, 'personal')).toEqual([]);
  });

  it('joins consecutive full leaves and continues them across a week boundary', () => {
    const weeks = buildCalendarWeeks('2026-10', [
      leave('2026-10-16'),
      leave('2026-10-17'),
      leave('2026-10-18'),
      leave('2026-10-19'),
    ]);

    expect(weeks[2].segments).toEqual([
      expect.objectContaining({
        column: 6,
        span: 2,
        continuesBefore: false,
        continuesAfter: true,
      }),
    ]);
    expect(weeks[3].segments).toEqual([
      expect.objectContaining({
        column: 1,
        span: 2,
        continuesBefore: true,
        continuesAfter: false,
      }),
    ]);
  });

  it('keeps overlapping employees in different lanes and does not join gaps or half days', () => {
    const weeks = buildCalendarWeeks('2026-10', [
      leave('2026-10-12'),
      leave('2026-10-13'),
      leave('2026-10-13', 'two'),
      leave('2026-10-15'),
      leave('2026-10-16', 'one', 'am'),
      leave('2026-10-17', 'one', 'am'),
    ]);
    const segments = weeks[2].segments;
    const first = segments.find((segment) => segment.from === '2026-10-12');
    const overlapping = segments.find((segment) => segment.userId === 'two');

    expect(first).toMatchObject({ column: 2, span: 2 });
    expect(overlapping?.lane).not.toBe(first?.lane);
    expect(segments.filter((segment) => segment.type === 'am')).toHaveLength(2);
    expect(
      segments.find((segment) => segment.from === '2026-10-15')?.span
    ).toBe(1);
  });

  it('includes adjacent month dates to fill complete weeks', () => {
    const days = calendarDays('2026-10');

    expect(days).toHaveLength(35);
    expect(days[0]).toBe('2026-09-27');
    expect(days[34]).toBe('2026-10-31');
    expect(calendarDays('2026-08')).toHaveLength(42);
  });

  it('applies one common type and time to new dates while preserving explicit exceptions', () => {
    const days = resolveRangeDrafts(
      ['2026-10-16', '2026-10-17', '2026-10-18'],
      { date: '2026-10-16', type: 'full' },
      {
        '2026-10-17': {
          date: '2026-10-17',
          type: 'am',
          start: '13:00',
          end: '18:00',
        },
      }
    );

    expect(days).toEqual([
      { date: '2026-10-16', type: 'full' },
      { date: '2026-10-17', type: 'am', start: '13:00', end: '18:00' },
      { date: '2026-10-18', type: 'full' },
    ]);
  });
});
