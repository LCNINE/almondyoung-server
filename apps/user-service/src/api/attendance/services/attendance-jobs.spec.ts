import { reminderDue } from './attendance-jobs.service';
import { DEFAULT_ATTENDANCE_SETTINGS } from '@packages/domain-types/attendance';

describe('attendance reminder conditions', () => {
  const settings = { ...DEFAULT_ATTENDANCE_SETTINGS, inEnabled: true, outEnabled: true };
  const now = new Date('2026-10-16T09:00:00Z');
  const context = {
    now,
    date: '2026-10-16',
    clock: '18:00',
    settings,
    leave: null,
    hasTodayRecord: true,
    hasOpenSession: true,
  };

  it('uses the normal end for AM leave instead of adding hours to actual arrival', () => {
    expect(reminderDue('out', { ...context, leave: { type: 'am', start: '13:00', end: '18:00' } })).toBe(true);

    expect(
      reminderDue('out', { ...context, clock: '17:30', leave: { type: 'am', start: '13:00', end: '18:00' } }),
    ).toBe(false);
  });

  it('skips full leave, completed records and disabled or skipped days', () => {
    expect(reminderDue('out', { ...context, leave: { type: 'full', start: null, end: null } })).toBe(false);

    expect(reminderDue('out', { ...context, hasOpenSession: false })).toBe(false);

    expect(reminderDue('in', context)).toBe(false);

    expect(reminderDue('out', { ...context, settings: { ...settings, outEnabled: false } })).toBe(false);

    expect(reminderDue('out', { ...context, settings: { ...settings, skipDate: '2026-10-16' } })).toBe(false);
  });

  it('does not send a reminder after its scheduled minute', () => {
    expect(reminderDue('out', { ...context, clock: '18:01' })).toBe(false);
  });
});
