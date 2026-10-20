import {
  DEFAULT_WAGE_RULES,
  type SettlementResult,
} from '@packages/domain-types/attendance-wage';
import {
  confirmBlockedReason,
  currentMonth,
  formatMinutes,
  formatWon,
} from './wage-format';

const result = (
  overrides: Partial<SettlementResult> = {}
): SettlementResult => ({
  groupId: 'group',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  payday: '2026-11-23',
  rules: DEFAULT_WAGE_RULES,
  people: [],
  issues: [],
  totals: { people: 0, total: 0, complete: true },
  ...overrides,
});

describe('wage format', () => {
  it.each([
    [0, '0분'],
    [45, '45분'],
    [480, '8시간'],
    [510, '8시간 30분'],
  ])('formats %i minutes as %s', (minutes, text) => {
    expect(formatMinutes(minutes)).toBe(text);
  });

  it('formats won with separators', () => {
    expect(formatWon(1234560)).toBe('1,234,560원');
  });

  it('takes the month in Korea', () => {
    expect(currentMonth(new Date('2026-10-31T16:00:00Z'))).toBe('2026-11');
  });
});

describe('confirm button', () => {
  it('waits until the period has ended', () => {
    expect(confirmBlockedReason(result(), '2026-10-31')).toContain(
      '끝난 다음 날'
    );
  });

  it('asks to clear the issues first', () => {
    expect(
      confirmBlockedReason(
        result({
          issues: [{ userId: 'u', workDate: '2026-10-02', kind: 'no_rate' }],
        }),
        '2026-11-01'
      )
    ).toContain('1건');
  });

  it('allows a finished period without issues', () => {
    expect(confirmBlockedReason(result(), '2026-11-01')).toBeNull();
  });
});
