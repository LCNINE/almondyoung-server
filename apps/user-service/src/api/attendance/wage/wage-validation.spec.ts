import { BadRequestError } from '@app/shared';
import { DEFAULT_WAGE_RULES } from '@packages/domain-types/attendance-wage';
import { isCalendarDate, parseScheduleDays, parseWageRules } from './wage-validation';

describe('wage rules', () => {
  it('accepts the default rules unchanged', () => {
    expect(parseWageRules(DEFAULT_WAGE_RULES)).toEqual(DEFAULT_WAGE_RULES);
  });

  it('accepts a rate with three decimals despite floating point error', () => {
    expect(
      parseWageRules({ ...DEFAULT_WAGE_RULES, overtime: { ...DEFAULT_WAGE_RULES.overtime, rate: 1.001 } }).overtime
        .rate,
    ).toBe(1.001);
  });

  it('drops fields it does not know', () => {
    expect(parseWageRules({ ...DEFAULT_WAGE_RULES, extra: true })).toEqual(DEFAULT_WAGE_RULES);
  });

  it.each([
    ['an overtime rate below one', { overtime: { ...DEFAULT_WAGE_RULES.overtime, rate: 0.9 } }],
    ['a rounding unit outside the list', { rounding: { unitMinutes: 7, mode: 'floor' } }],
    ['a malformed night start', { night: { ...DEFAULT_WAGE_RULES.night, start: '25:00' } }],
    ['a rate with too many decimals', { overtime: { ...DEFAULT_WAGE_RULES.overtime, rate: 1.0001 } }],
    ['a missing section', { weeklyHoliday: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(() => parseWageRules({ ...DEFAULT_WAGE_RULES, ...change })).toThrow(BadRequestError);
  });
});

describe('schedule days', () => {
  it('rejects the same weekday twice', () => {
    expect(() =>
      parseScheduleDays([
        { weekday: 1, start: '09:00', end: '13:00' },
        { weekday: 1, start: '14:00', end: '18:00' },
      ]),
    ).toThrow(BadRequestError);
  });

  it('accepts an overnight day', () => {
    expect(parseScheduleDays([{ weekday: 5, start: '22:00', end: '06:00', breakMinutes: 30 }])).toEqual([
      { weekday: 5, start: '22:00', end: '06:00', breakMinutes: 30 },
    ]);
  });
});

describe('calendar dates', () => {
  it.each([
    ['2026-02-28', true],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['20261001', false],
  ])('%s → %s', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected);
  });
});
