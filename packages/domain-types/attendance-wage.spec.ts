import { DEFAULT_WAGE_RULES, defaultWageRules, payPeriodFor } from './attendance-wage';

describe('pay period', () => {
  it('pays the previous calendar month on a day of the next month', () => {
    expect(payPeriodFor({ payday: 23, periodCloseDay: 0, payMonthOffset: 1 }, '2026-11')).toEqual({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payday: '2026-11-23',
    });
  });

  it('closes on a day of the month and pays in the same month', () => {
    expect(payPeriodFor({ payday: 25, periodCloseDay: 15, payMonthOffset: 0 }, '2026-11')).toEqual({
      periodStart: '2026-10-16',
      periodEnd: '2026-11-15',
      payday: '2026-11-25',
    });
  });

  it('moves a payday past the end of a short month to its last day', () => {
    expect(payPeriodFor({ payday: 31, periodCloseDay: 0, payMonthOffset: 1 }, '2026-02').payday).toBe('2026-02-28');
  });

  it('moves a close day past the end of a short month to its last day', () => {
    expect(payPeriodFor({ payday: 10, periodCloseDay: 30, payMonthOffset: 1 }, '2026-03')).toEqual({
      periodStart: '2026-01-31',
      periodEnd: '2026-02-28',
      payday: '2026-03-10',
    });
  });

  it('rejects a malformed payday month', () => {
    expect(() => payPeriodFor({ payday: 23, periodCloseDay: 0, payMonthOffset: 1 }, '2026-13')).toThrow();
  });
});

describe('default wage rules', () => {
  it('starts from the legal defaults', () => {
    expect(DEFAULT_WAGE_RULES).toEqual({
      breakDeduction: 'legal',
      rounding: { unitMinutes: 1, mode: 'floor' },
      workplaceFivePlus: true,
      schedule: { mode: 'auto' },
      overtime: { enabled: true, rate: 1.5, recognition: 'manual', unrecognized: 'unpaid' },
      night: { enabled: true, extraRate: 0.5, start: '22:00', end: '06:00' },
      weeklyHoliday: { enabled: true, minWeeklyHours: 15, weekStartsOn: 1 },
      leavePaidDefault: { full: false, am: false, pm: false },
      wageRounding: { unit: 1, mode: 'floor' },
    });
  });
});

describe('rules for a new group', () => {
  it('starts a small workplace with both premiums off', () => {
    const rules = defaultWageRules(false);

    expect(rules.workplaceFivePlus).toBe(false);
    expect(rules.overtime.enabled).toBe(false);
    expect(rules.night.enabled).toBe(false);
    expect(defaultWageRules(true)).toEqual(DEFAULT_WAGE_RULES);
  });
});
