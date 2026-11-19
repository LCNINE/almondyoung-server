import { matchingDateFromParams, matchingDateQuery } from './matching-url';

const read = (query: string) =>
  matchingDateFromParams(new URLSearchParams(query));

describe('matchingDateFromParams', () => {
  it('오늘', () => {
    expect(read('date=today')).toEqual({
      dateType: 'today',
      startDate: undefined,
      endDate: undefined,
    });
  });

  it('기간과 한쪽 끝만 있는 기간', () => {
    expect(read('from=2026-01-01&to=2026-01-31')).toEqual({
      dateType: 'custom',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(read('from=2026-01-01')).toEqual({
      dateType: 'custom',
      startDate: '2026-01-01',
      endDate: undefined,
    });
  });

  it.each([
    '',
    'from=2026-02-30',
    'from=20260101&to=20260131',
    'from=2026-01-31&to=2026-01-01',
    'date=yesterday',
  ])('읽을 수 없는 값은 날짜 조건 없음: %p', (query) => {
    const date = read(query);
    expect(date.dateType).toBe('custom');
    expect(date.startDate).toBeUndefined();
    expect(date.endDate).toBeUndefined();
  });
});

describe('matchingDateQuery', () => {
  it.each([
    [{ dateType: 'today' as const, startDate: '2026-01-01' }, 'date=today'],
    [
      {
        dateType: 'custom' as const,
        startDate: '2026-01-01',
        endDate: '2026-01-31',
      },
      'from=2026-01-01&to=2026-01-31',
    ],
    [
      { dateType: 'custom' as const, startDate: '2026-01-01' },
      'from=2026-01-01',
    ],
    [{ dateType: 'custom' as const }, ''],
  ])('%p → %p', (date, query) => {
    expect(matchingDateQuery(date)).toBe(query);
    expect(matchingDateQuery(read(query))).toBe(query);
  });
});
