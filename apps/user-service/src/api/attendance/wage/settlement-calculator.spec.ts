import {
  DEFAULT_WAGE_RULES,
  defaultWageRules,
  type ScheduleDay,
  type WageRules,
} from '@packages/domain-types/attendance-wage';
import { computeSettlement, type SettlementInput, type SettlementPersonInput } from './settlement-calculator';

const at = (date: string, clock: string) => new Date(`${date}T${clock}:00+09:00`);

const session = (date: string, start: string, end: string | null, endDate = date) => ({
  workDate: date,
  checkIn: at(date, start),
  checkOut: end === null ? null : at(endDate, end),
});

const weekdays = (start: string, end: string, breakMinutes?: number): ScheduleDay[] =>
  ([1, 2, 3, 4, 5] as const).map((weekday) => ({ weekday, start, end, breakMinutes }));

const october = { periodStart: '2026-10-01', periodEnd: '2026-10-31', payday: '2026-11-23' };

const person = (overrides: Partial<SettlementPersonInput> = {}): SettlementPersonInput => ({
  userId: 'worker',
  name: '근무자',
  onRoster: true,
  hireDate: null,
  leaveDate: null,
  rates: [{ effectiveFrom: '2026-01-01', hourlyWage: 10000 }],
  schedules: [],
  sessions: [],
  overtime: [],
  absences: [],
  ...overrides,
});

const rules = (overrides: Partial<WageRules> = {}): WageRules => ({ ...DEFAULT_WAGE_RULES, ...overrides });

const input = (people: SettlementPersonInput[], overrides: Partial<SettlementInput> = {}): SettlementInput => ({
  group: { id: 'group', payBasis: 'hourly' },
  period: october,
  today: '2026-11-10',
  rules: rules(),
  minimumWages: [{ effectiveFrom: '2026-01-01', hourlyWage: 10320 }],
  people,
  ...overrides,
});

const only = (result: ReturnType<typeof computeSettlement>) => {
  const [first] = result.people;

  if (!first) {
    throw new Error('expected one person');
  }

  return first;
};

const day = (result: ReturnType<typeof computeSettlement>, workDate: string) => {
  const found = only(result).days.find((entry) => entry.workDate === workDate);

  if (!found) {
    throw new Error(`expected a line for ${workDate}`);
  }

  return found;
};

const autoOvertime = rules({ overtime: { ...DEFAULT_WAGE_RULES.overtime, recognition: 'auto' } });

describe('settlement calculator', () => {
  it('deducts legal breaks by the length of the stay', () => {
    const result = computeSettlement(
      input([
        person({
          sessions: [
            session('2026-10-05', '09:00', '18:00'),
            session('2026-10-06', '09:00', '13:00'),
            session('2026-10-07', '09:00', '13:30'),
          ],
        }),
      ]),
    );

    expect(day(result, '2026-10-05').workedMinutes).toBe(480);
    expect(day(result, '2026-10-06').workedMinutes).toBe(240);
    expect(day(result, '2026-10-07').workedMinutes).toBe(240);
  });

  it('counts overtime by length, not by window', () => {
    const result = computeSettlement(
      input(
        [
          person({
            schedules: [{ effectiveFrom: '2026-10-01', effectiveTo: null, days: weekdays('09:00', '18:00', 60) }],
            sessions: [session('2026-10-05', '10:00', '19:00'), session('2026-10-06', '09:00', '20:00')],
          }),
        ],
        { today: '2026-10-06', period: { ...october, periodStart: '2026-10-05' }, rules: autoOvertime },
      ),
    );

    expect(day(result, '2026-10-05')).toMatchObject({ scheduledMinutes: 480, overtimeRecordedMinutes: 0 });
    expect(day(result, '2026-10-06')).toMatchObject({ scheduledMinutes: 480, overtimeRecordedMinutes: 120 });
  });

  describe('overtime decisions', () => {
    const scheduled = (decision: { status: 'recognized' | 'rejected'; recognizedMinutes: number }) =>
      person({
        schedules: [{ effectiveFrom: '2026-10-01', effectiveTo: null, days: weekdays('09:00', '18:00', 60) }],
        sessions: [session('2026-10-05', '09:00', '18:00'), session('2026-10-06', '09:00', '20:00')],
        overtime: [{ workDate: '2026-10-06', ...decision }],
      });
    const window = { today: '2026-10-06', period: { ...october, periodStart: '2026-10-05' } };

    it('pays nothing for rejected overtime by default and base pay when configured', () => {
      const unpaid = computeSettlement(input([scheduled({ status: 'rejected', recognizedMinutes: 0 })], window));
      const base = computeSettlement(
        input([scheduled({ status: 'rejected', recognizedMinutes: 0 })], {
          ...window,
          rules: rules({ overtime: { ...DEFAULT_WAGE_RULES.overtime, unrecognized: 'base' } }),
        }),
      );

      expect(only(unpaid).amounts).toMatchObject({ regular: 160000, overtime: 0, total: 160000 });
      expect(only(base).amounts).toMatchObject({ regular: 180000, overtime: 0, total: 180000 });
      expect(only(unpaid).complete).toBe(true);
    });

    it('adds the overtime premium only while it is switched on', () => {
      const recognized = scheduled({ status: 'recognized', recognizedMinutes: 120 });
      const on = computeSettlement(input([recognized], window));
      const off = computeSettlement(input([recognized], { ...window, rules: rules(defaultWageRules(false)) }));
      const agreed = computeSettlement(
        input([recognized], {
          ...window,
          rules: rules({ ...defaultWageRules(false), overtime: { ...DEFAULT_WAGE_RULES.overtime, enabled: true } }),
        }),
      );

      expect(only(on).amounts?.overtime).toBe(30000);
      expect(only(off).amounts?.overtime).toBe(20000);
      expect(only(agreed).amounts?.overtime).toBe(30000);
    });

    it('never recognizes more than was recorded', () => {
      const result = computeSettlement(input([scheduled({ status: 'recognized', recognizedMinutes: 300 })], window));

      expect(day(result, '2026-10-06').overtimeRecognizedMinutes).toBe(120);
    });
  });

  it('attributes an overnight shift to the check-in date with night minutes', () => {
    const result = computeSettlement(
      input([person({ sessions: [session('2026-10-05', '22:00', '02:00', '2026-10-06')] })]),
    );

    expect(only(result).days.map((entry) => entry.workDate)).toEqual(['2026-10-05']);
    expect(day(result, '2026-10-05')).toMatchObject({ workedMinutes: 240, nightMinutes: 240 });
    expect(only(result).amounts).toMatchObject({ regular: 40000, night: 20000 });
  });

  it('takes the break out of daytime hours before night hours', () => {
    const result = computeSettlement(input([person({ sessions: [session('2026-10-05', '14:00', '23:00')] })]));

    expect(day(result, '2026-10-05')).toMatchObject({ workedMinutes: 480, nightMinutes: 60 });
  });

  it('never counts more night minutes than were worked', () => {
    const result = computeSettlement(
      input([person({ sessions: [session('2026-10-05', '22:00', '06:00', '2026-10-06')] })]),
    );

    expect(day(result, '2026-10-05')).toMatchObject({ workedMinutes: 450, nightMinutes: 450 });
  });

  it('prices each day with the rate in effect that day', () => {
    const result = computeSettlement(
      input([
        person({
          rates: [
            { effectiveFrom: '2026-01-01', hourlyWage: 10000 },
            { effectiveFrom: '2026-10-06', hourlyWage: 12000 },
          ],
          sessions: [session('2026-10-05', '09:00', '13:00'), session('2026-10-06', '09:00', '13:00')],
        }),
      ]),
    );

    expect(day(result, '2026-10-05').hourlyWage).toBe(10000);
    expect(day(result, '2026-10-06').hourlyWage).toBe(12000);
    expect(only(result).amounts?.regular).toBe(88000);
  });

  describe('weekly holiday pay', () => {
    const partTime = { effectiveFrom: '2026-10-05', effectiveTo: '2026-10-11', days: weekdays('09:00', '13:00', 0) };
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

    it('pays weekly holiday hours for a full week of at least 15 hours', () => {
      const result = computeSettlement(
        input([person({ schedules: [partTime], sessions: week.map((date) => session(date, '09:00', '13:00')) })]),
      );

      expect(only(result).weeklyHolidayMinutes).toBe(240);
      expect(only(result).amounts?.weeklyHoliday).toBe(40000);
      expect(only(result).complete).toBe(true);
    });

    it('skips a week under the weekly minimum', () => {
      const short = { ...partTime, days: weekdays('09:00', '11:00', 0) };
      const result = computeSettlement(
        input([person({ schedules: [short], sessions: week.map((date) => session(date, '09:00', '11:00')) })]),
      );

      expect(only(result).weeklyHolidayMinutes).toBe(0);
    });

    it.each([
      ['absent', 0, 0],
      ['excused_unpaid', 240, 0],
      ['excused_paid', 240, 40000],
    ] as const)('decides weekly holiday pay for a day judged %s', (kind, holidayMinutes, paidLeave) => {
      const result = computeSettlement(
        input([
          person({
            schedules: [partTime],
            sessions: week.filter((date) => date !== '2026-10-07').map((date) => session(date, '09:00', '13:00')),
            absences: [{ workDate: '2026-10-07', kind }],
          }),
        ]),
      );

      expect(day(result, '2026-10-07').absence).toBe(kind);
      expect(only(result).weeklyHolidayMinutes).toBe(holidayMinutes);
      expect(only(result).amounts?.paidLeave).toBe(paidLeave);
    });

    it('marks the week undecided while an absence is undecided', () => {
      const result = computeSettlement(
        input([
          person({
            schedules: [partTime],
            sessions: week.filter((date) => date !== '2026-10-07').map((date) => session(date, '09:00', '13:00')),
          }),
        ]),
      );

      expect(day(result, '2026-10-07').absence).toBe('undecided');
      expect(result.issues).toEqual([{ userId: 'worker', workDate: '2026-10-07', kind: 'absence_undecided' }]);
      expect(only(result).weeklyHolidayMinutes).toBe(0);
      expect(only(result).complete).toBe(false);
    });

    it("puts a straddling week's holiday pay into the period holding its last day", () => {
      const straddling = {
        effectiveFrom: '2026-10-26',
        effectiveTo: '2026-11-01',
        days: weekdays('09:00', '13:00', 0),
      };
      const worker = person({
        schedules: [straddling],
        sessions: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((date) =>
          session(date, '09:00', '13:00'),
        ),
      });

      const octoberResult = computeSettlement(input([worker]));
      const novemberResult = computeSettlement(
        input([worker], { period: { periodStart: '2026-11-01', periodEnd: '2026-11-30', payday: '2026-12-23' } }),
      );

      expect(only(octoberResult).weeklyHolidayMinutes).toBe(0);
      expect(only(novemberResult).weeklyHolidayMinutes).toBe(240);
    });

    it('waits for a week that has not ended yet', () => {
      const result = computeSettlement(
        input([person({ schedules: [partTime], sessions: week.map((date) => session(date, '09:00', '13:00')) })], {
          today: '2026-10-10',
        }),
      );

      expect(only(result).weeklyHolidayMinutes).toBe(0);
    });
  });

  describe('a person without a schedule', () => {
    it('treats daily hours over eight as overtime', () => {
      const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
      const result = computeSettlement(
        input([person({ sessions: days.map((date) => session(date, '09:00', '19:00')) })], { rules: autoOvertime }),
      );

      expect(day(result, '2026-10-05')).toMatchObject({ workedMinutes: 540, overtimeRecordedMinutes: 60 });
      expect(only(result).days.reduce((sum, entry) => sum + entry.overtimeRecordedMinutes, 0)).toBe(300);
    });

    it('treats weekly hours over forty as overtime at the end of the week', () => {
      const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
      const result = computeSettlement(
        input([person({ sessions: days.map((date) => session(date, '09:00', '17:00')) })], { rules: autoOvertime }),
      );

      expect(day(result, '2026-10-09').overtimeRecordedMinutes).toBe(0);
      expect(day(result, '2026-10-10')).toMatchObject({ workedMinutes: 450, overtimeRecordedMinutes: 300 });
    });

    it('bases weekly holiday hours on the regular hours worked', () => {
      const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
      const result = computeSettlement(
        input([person({ sessions: days.map((date) => session(date, '09:00', '13:00')) })]),
      );

      expect(only(result).weeklyHolidayMinutes).toBe(240);
    });
  });

  it('holds the first week while a checkout from the previous period is missing', () => {
    const straddling = { effectiveFrom: '2026-10-26', effectiveTo: '2026-11-01', days: weekdays('09:00', '13:00', 0) };
    const result = computeSettlement(
      input(
        [
          person({
            schedules: [straddling],
            sessions: [
              session('2026-10-26', '09:00', null),
              ...['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((date) =>
                session(date, '09:00', '13:00'),
              ),
            ],
          }),
        ],
        { period: { periodStart: '2026-11-01', periodEnd: '2026-11-30', payday: '2026-12-23' } },
      ),
    );

    expect(result.issues).toEqual([{ userId: 'worker', workDate: '2026-10-26', kind: 'missing_checkout' }]);
    expect(only(result).weeklyHolidayMinutes).toBe(0);
    expect(only(result).complete).toBe(false);
  });

  it('counts recognized overtime toward the weekly holiday of a person without a schedule', () => {
    const result = computeSettlement(
      input(
        [
          person({
            sessions: ['2026-10-05', '2026-10-06'].map((date) => session(date, '09:00', '19:00')),
          }),
        ],
        {
          rules: rules({ ...autoOvertime, weeklyHoliday: { ...DEFAULT_WAGE_RULES.weeklyHoliday, minWeeklyHours: 15 } }),
        },
      ),
    );

    // 이틀 각 9시간(정상 8 + 인정 연장 1) = 18시간 → 18 × 60 ÷ 5 = 216분
    expect(only(result).weeklyHolidayMinutes).toBe(216);
  });

  it('pays no night premium on overtime that is not paid', () => {
    const result = computeSettlement(
      input(
        [
          person({
            schedules: [{ effectiveFrom: '2026-10-01', effectiveTo: null, days: weekdays('14:00', '22:00', 60) }],
            sessions: [session('2026-10-05', '14:00', '23:00')],
            overtime: [{ workDate: '2026-10-05', status: 'rejected', recognizedMinutes: 0 }],
          }),
        ],
        { today: '2026-10-06', period: { ...october, periodStart: '2026-10-05' } },
      ),
    );

    expect(only(result).amounts).toMatchObject({ regular: 70000, overtime: 0, night: 0 });
  });

  it('keeps the night premium on recognized overtime', () => {
    const result = computeSettlement(
      input(
        [
          person({
            schedules: [{ effectiveFrom: '2026-10-01', effectiveTo: null, days: weekdays('14:00', '22:00', 60) }],
            sessions: [session('2026-10-05', '14:00', '23:00')],
            overtime: [{ workDate: '2026-10-05', status: 'recognized', recognizedMinutes: 60 }],
          }),
        ],
        { today: '2026-10-06', period: { ...october, periodStart: '2026-10-05' } },
      ),
    );

    expect(only(result).amounts).toMatchObject({ regular: 70000, overtime: 15000, night: 5000 });
  });

  it('reports work outside the employment dates instead of paying it', () => {
    const result = computeSettlement(
      input([
        person({
          hireDate: '2026-10-10',
          leaveDate: '2026-10-20',
          sessions: ['2026-10-05', '2026-10-12', '2026-10-23'].map((date) => session(date, '09:00', '13:00')),
        }),
      ]),
    );

    expect(result.issues).toEqual([
      { userId: 'worker', workDate: '2026-10-05', kind: 'outside_employment' },
      { userId: 'worker', workDate: '2026-10-23', kind: 'outside_employment' },
    ]);
    expect(only(result).amounts?.regular).toBe(40000);
  });

  it('reports missing checkouts, missing rates and undecided overtime instead of zero', () => {
    const result = computeSettlement(
      input(
        [
          person({
            rates: [{ effectiveFrom: '2026-10-06', hourlyWage: 10000 }],
            schedules: [
              { effectiveFrom: '2026-10-05', effectiveTo: '2026-10-06', days: weekdays('09:00', '18:00', 60) },
            ],
            sessions: [
              session('2026-10-02', '09:00', '13:00'),
              session('2026-10-05', '09:00', null),
              session('2026-10-06', '09:00', '20:00'),
            ],
          }),
        ],
        { today: '2026-10-07' },
      ),
    );

    expect(result.issues).toEqual([
      { userId: 'worker', workDate: '2026-10-02', kind: 'no_rate' },
      { userId: 'worker', workDate: '2026-10-05', kind: 'missing_checkout' },
      { userId: 'worker', workDate: '2026-10-06', kind: 'overtime_undecided' },
    ]);
    expect(day(result, '2026-10-06').overtimeRecognizedMinutes).toBeNull();
    expect(only(result).complete).toBe(false);
    expect(only(result).amounts?.total).toBe(80000);
    expect(result.totals).toEqual({ people: 1, total: 80000, complete: false });
  });

  it('leaves a session still open today out of the issues', () => {
    const result = computeSettlement(
      input([person({ sessions: [session('2026-10-07', '09:00', null)] })], { today: '2026-10-07' }),
    );

    expect(result.issues).toEqual([]);
  });

  it('lists staff missing from the roster as an issue without pricing them', () => {
    const result = computeSettlement(
      input([person({ onRoster: false, sessions: [session('2026-10-05', '09:00', '13:00')] })]),
    );

    expect(result.people).toEqual([]);
    expect(result.issues).toEqual([{ userId: 'worker', workDate: null, kind: 'not_on_roster' }]);
  });

  it('ignores days outside the employment dates', () => {
    const partTime = { effectiveFrom: '2026-10-01', effectiveTo: null, days: weekdays('09:00', '13:00', 0) };
    const result = computeSettlement(
      input([
        person({
          hireDate: '2026-10-26',
          leaveDate: '2026-10-27',
          schedules: [partTime],
          sessions: [session('2026-10-26', '09:00', '13:00'), session('2026-10-27', '09:00', '13:00')],
        }),
      ]),
    );

    expect(result.issues).toEqual([]);
    expect(only(result).days.map((entry) => entry.workDate)).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('warns below the minimum wage in effect', () => {
    const result = computeSettlement(
      input([
        person({
          rates: [{ effectiveFrom: '2026-01-01', hourlyWage: 9000 }],
          sessions: [session('2026-10-05', '09:00', '13:00')],
        }),
      ]),
    );

    expect(only(result).warnings).toContain('below_minimum_wage');
  });

  it('warns about rounding units other than a minute', () => {
    const result = computeSettlement(
      input([person({ sessions: [session('2026-10-05', '09:00', '13:07')] })], {
        rules: rules({ rounding: { unitMinutes: 15, mode: 'floor' } }),
      }),
    );

    expect(day(result, '2026-10-05').workedMinutes).toBe(240);
    expect(only(result).warnings).toContain('rounding_unit');
  });

  it('warns about more than 52 hours in a week', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    const result = computeSettlement(
      input([person({ sessions: days.map((date) => session(date, '08:00', '18:00')) })], { rules: autoOvertime }),
    );

    expect(only(result).warnings).toContain('over_52_hours');
  });

  it('rounds the total once per item', () => {
    const days = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const sessions = days.map((date) => session(date, '09:00', '09:01'));
    const result = computeSettlement(
      input([person({ rates: [{ effectiveFrom: '2026-01-01', hourlyWage: 10005 }], sessions })]),
    );
    const tens = computeSettlement(
      input([person({ rates: [{ effectiveFrom: '2026-01-01', hourlyWage: 10005 }], sessions })], {
        rules: rules({ wageRounding: { unit: 10, mode: 'floor' } }),
      }),
    );

    // 날마다 자르면 166 × 4 = 664 — 합계에서 한 번 자른다.
    expect(only(result).amounts?.regular).toBe(667);
    expect(only(tens).amounts?.regular).toBe(660);
  });

  it('reports hours only for a salaried group', () => {
    const result = computeSettlement(
      input([person({ sessions: [session('2026-10-05', '09:00', '18:00')] })], {
        group: { id: 'group', payBasis: 'salaried' },
      }),
    );

    expect(only(result).amounts).toBeNull();
    expect(day(result, '2026-10-05').workedMinutes).toBe(480);
    expect(result.totals.total).toBe(0);
  });
});
