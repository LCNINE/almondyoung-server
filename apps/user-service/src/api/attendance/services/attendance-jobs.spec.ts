import { AttendanceJobsService, reminderDue } from './attendance-jobs.service';
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

  it('schedules both reminders for a user who has not saved preferences yet', () => {
    expect(
      reminderDue('in', {
        ...context,
        settings: DEFAULT_ATTENDANCE_SETTINGS,
        clock: '09:00',
        hasTodayRecord: false,
        hasOpenSession: false,
      }),
    ).toBe(true);

    expect(reminderDue('out', { ...context, settings: DEFAULT_ATTENDANCE_SETTINGS })).toBe(true);
  });

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

describe('attendance job recipients', () => {
  it('skips the run while the permission copy is missing', async () => {
    const repo = {
      get db(): never {
        throw new Error('this test does not touch the database');
      },
      permissionsLoaded: () => false,
      staff: () => Promise.reject(new Error('this test must not resolve staff')),
      holdersOf: () => Promise.reject(new Error('this test must not resolve recipients')),
      settings: () => Promise.reject(new Error('this test does not read settings')),
      withUserLock: () => Promise.reject(new Error('this test does not lock')),
    };
    const service = new AttendanceJobsService(repo);

    await expect(service.tick()).resolves.toBeUndefined();
  });
});
