import { describeSubjects, isAfterHours, monthRange, PII_ACTION_LABELS } from './pii-access-format';

describe('pii access log format', () => {
  it('shows subjects as ids with the true count', () => {
    expect(describeSubjects([{ type: 'user', id: 'u1' }], 1)).toBe('회원 u1');
    expect(
      describeSubjects(
        [
          { type: 'sales_order', id: 'so1' },
          { type: 'sales_order', id: 'so2' },
          { type: 'sales_order', id: 'so3' },
        ],
        1500,
      ),
    ).toBe('주문 so1, 주문 so2 외 1,498건');
    expect(describeSubjects([], 0)).toBe('대상 식별자 없음');
  });

  it('marks after-hours rows in Korean time', () => {
    expect(isAfterHours('2026-10-19T00:30:00.000Z')).toBe(false); // 09:30 KST
    expect(isAfterHours('2026-10-18T23:59:00.000Z')).toBe(true); // 08:59 KST
    expect(isAfterHours('2026-10-19T10:00:00.000Z')).toBe(true); // 19:00 KST
  });

  it('names every action', () => {
    expect(PII_ACTION_LABELS).toEqual({ view: '열람', reveal: '보기(원문)', export: '내려받기' });
  });

  it('gives the Korean month containing a day as a half-open range', () => {
    expect(monthRange('2026-10-19')).toEqual({
      period: '2026-10',
      from: '2026-09-30T15:00:00.000Z',
      to: '2026-10-31T15:00:00.000Z',
    });
  });
});
