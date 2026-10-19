import { leaveReminderStart, dueLeaveReminders, validateLeaveReminderMinutes } from './leave-reminders';

describe('vacation reminder scheduling', () => {
  const leave = {
    date: '2026-10-19',
    type: 'full' as const,
    end: null,
    reminderMinutes: [10, 60],
    reminderSetAt: new Date('2026-10-18T00:00:00Z'),
  };

  it.each([
    ['full', null, '09:30', '2026-10-19T00:00:00.000Z'],
    ['am', '18:00', '09:30', '2026-10-19T00:30:00.000Z'],
    ['pm', '13:30', '09:30', '2026-10-19T04:30:00.000Z'],
  ])('uses vacation start for %s leave, never the half-day working start', (type, end, normalStart, expected) => {
    expect(leaveReminderStart({ ...leave, type: type as 'full' | 'am' | 'pm', end }, normalStart)?.toISOString()).toBe(
      expected,
    );
  });

  it('converts a Seoul vacation start into its advance reminder instant', () => {
    const triggers = dueLeaveReminders(leave, '09:00', new Date('2026-10-18T23:50:30Z'));

    expect(triggers).toEqual([
      { minutes: 10, startAt: '2026-10-19T00:00:00.000Z', scheduledFor: '2026-10-18T23:50:00.000Z' },
    ]);
  });

  it('recovers a missed poll within five minutes but never delivers an expired reminder', () => {
    expect(dueLeaveReminders(leave, '09:00', new Date('2026-10-18T23:53:00Z'))).toHaveLength(1);
    expect(dueLeaveReminders(leave, '09:00', new Date('2026-10-18T23:55:00Z'))).toEqual([]);
  });

  it('never delivers an alert that was already due when the user enabled it', () => {
    expect(
      dueLeaveReminders(
        { ...leave, reminderSetAt: new Date('2026-10-18T23:51:00Z') },
        '09:00',
        new Date('2026-10-18T23:52:00Z'),
      ),
    ).toEqual([]);
    expect(dueLeaveReminders({ ...leave, reminderMinutes: [] }, '09:00', new Date('2026-10-18T23:50:00Z'))).toEqual([]);
  });

  it.each([[1.5], [-1], [525601], [10, 10], [0, 1, 2, 3, 4, 5], null].map((minutes) => [minutes]))(
    'rejects invalid reminder configuration: %j',
    (minutes) => {
      expect(() => validateLeaveReminderMinutes(minutes)).toThrow();
    },
  );

  it('accepts no reminder, at-start, and a custom reminder within a year', () => {
    expect(() => validateLeaveReminderMinutes([])).not.toThrow();
    expect(() => validateLeaveReminderMinutes([0, 10, 60, 525600])).not.toThrow();
  });
});
