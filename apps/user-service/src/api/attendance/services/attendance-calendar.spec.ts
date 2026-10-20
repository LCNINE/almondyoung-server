import { validateLeaveBatch, assertLeaveOwner } from './attendance-calendar.service';
import type { LeaveInput } from '@packages/domain-types/attendance';

describe('shared leave calendar boundaries', () => {
  it('accepts mixed full-day and half-day schedules', () => {
    expect(() =>
      validateLeaveBatch([
        { date: '2026-10-16', type: 'full' },
        { date: '2026-10-17', type: 'am', start: '14:00', end: '19:00' },
      ]),
    ).not.toThrow();
  });

  it.each(
    [
      [],
      [{ date: '2026-02-30', type: 'full' }],
      [{ date: '2026-10-16', type: 'am', start: '18:00', end: '13:00' }],
      [
        { date: '2026-10-16', type: 'full' },
        { date: '2026-10-16', type: 'pm', start: '09:00', end: '13:00' },
      ],
      [{ date: '2026-10-16', type: 'other' }],
    ].map((batch) => [batch]),
  )('blocks malformed and conflicting batch %#', (batch) => {
    expect(() => validateLeaveBatch(batch as unknown as LeaveInput[])).toThrow();
  });

  it('does not apply a deferred strict half-day time boundary', () => {
    expect(() => validateLeaveBatch([{ date: '2026-10-16', type: 'am', start: '14:00', end: '18:00' }])).not.toThrow();
  });

  it('does not let another admin edit someone else’s leave', () => {
    expect(() => assertLeaveOwner('owner', 'other')).toThrow();

    expect(() => assertLeaveOwner('owner', 'owner')).not.toThrow();
  });
});
