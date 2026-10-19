import { expandLeaveRecurrence } from './leave-recurrence';

describe('finite vacation recurrence', () => {
  it('repeats the whole selected period weekly without changing working times', () => {
    const result = expandLeaveRecurrence(
      [
        { date: '2026-10-16', type: 'am', start: '13:00', end: '18:00' },
        { date: '2026-10-17', type: 'full' },
      ],
      { frequency: 'weekly', until: '2026-10-30' },
    );

    expect(result.map((day) => day.date)).toEqual([
      '2026-10-16',
      '2026-10-17',
      '2026-10-23',
      '2026-10-24',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(result[2]).toEqual({ date: '2026-10-23', type: 'am', start: '13:00', end: '18:00' });
  });

  it('skips invalid monthly dates instead of drifting into the following month', () => {
    expect(
      expandLeaveRecurrence([{ date: '2027-01-31', type: 'full' }], { frequency: 'monthly', until: '2027-04-30' }).map(
        (day) => day.date,
      ),
    ).toEqual(['2027-01-31', '2027-03-31']);
  });

  it('supports several future years and skips a non-leap anniversary', () => {
    expect(
      expandLeaveRecurrence([{ date: '2028-02-29', type: 'full' }], { frequency: 'yearly', until: '2032-02-29' }).map(
        (day) => day.date,
      ),
    ).toEqual(['2028-02-29', '2032-02-29']);
  });

  it.each([
    { frequency: 'weekly' },
    { frequency: 'weekly', until: '2026-02-30' },
    { frequency: 'weekly', until: '2025-01-01' },
    { frequency: 'monthly', until: '2037-01-01' },
    { frequency: 'other', until: '2027-01-01' },
  ])('rejects an unbounded or invalid repeat rule: %j', (recurrence) => {
    expect(() =>
      expandLeaveRecurrence(
        [{ date: '2026-01-01', type: 'full' }],
        recurrence as Parameters<typeof expandLeaveRecurrence>[1],
      ),
    ).toThrow();
  });

  it('rejects overlapping repeated periods rather than generating conflicting leave', () => {
    expect(() =>
      expandLeaveRecurrence(
        [
          { date: '2026-10-16', type: 'full' },
          { date: '2026-10-23', type: 'full' },
        ],
        { frequency: 'weekly', until: '2026-11-01' },
      ),
    ).toThrow();
  });

  it('limits expanded dates to 366 before any database write', () => {
    expect(() =>
      expandLeaveRecurrence([{ date: '2026-01-01', type: 'full' }], { frequency: 'weekly', until: '2036-01-01' }),
    ).toThrow();
  });

  it('leaves non-recurring input unchanged', () => {
    const input = [{ date: '2026-10-16', type: 'full' as const }];

    expect(expandLeaveRecurrence(input)).toEqual(input);
    expect(expandLeaveRecurrence(input, { frequency: 'none' })).toEqual(input);
  });
});
