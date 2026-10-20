import { DEFAULT_WAGE_RULES } from '@packages/domain-types/attendance-wage';
import { settlementSheetRows } from './wage-sheet';

it('builds one readable row per person without identifiers', () => {
  const [row] = settlementSheetRows({
    groupId: 'group',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    payday: '2026-11-23',
    rules: DEFAULT_WAGE_RULES,
    people: [
      {
        userId: 'u-1',
        name: '근무자',
        days: [
          {
            workDate: '2026-10-05',
            workedMinutes: 480,
            scheduledMinutes: 480,
            overtimeRecordedMinutes: 0,
            overtimeRecognizedMinutes: 0,
            nightMinutes: 0,
            hourlyWage: 10000,
            absence: 'none',
          },
          {
            workDate: '2026-10-06',
            workedMinutes: 540,
            scheduledMinutes: 480,
            overtimeRecordedMinutes: 60,
            overtimeRecognizedMinutes: null,
            nightMinutes: 0,
            hourlyWage: 12000,
            absence: 'none',
          },
        ],
        weeklyHolidayMinutes: 0,
        amounts: {
          regular: 176000,
          overtime: 0,
          night: 0,
          weeklyHoliday: 0,
          paidLeave: 0,
          total: 176000,
        },
        complete: false,
        warnings: [],
      },
    ],
    issues: [
      { userId: 'u-1', workDate: '2026-10-06', kind: 'overtime_undecided' },
    ],
    totals: { people: 1, total: 176000, complete: false },
  });

  expect(row).toMatchObject({
    이름: '근무자',
    근무시간: '17시간',
    시급: '10,000 → 12,000',
    '세전 지급액': 176000,
    '계산 못 함': '2026-10-06 연장 미판정',
  });
  expect(Object.keys(row ?? {})).not.toContain('userId');
});
