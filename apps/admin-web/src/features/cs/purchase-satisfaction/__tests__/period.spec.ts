import { periodRange, formatKstTime } from '../period';

describe('periodRange', () => {
  const now = new Date('2026-10-27T16:30:00Z');

  it('KST 날짜로 오늘을 계산한다 (UTC 로는 전날)', () => {
    expect(periodRange('today', now)).toEqual({ from: '2026-10-28', to: '2026-10-28' });
  });
  it('최근 7일은 오늘 포함 7일이다', () => {
    expect(periodRange('week', now)).toEqual({ from: '2026-10-22', to: '2026-10-28' });
  });
  it('최근 30일은 오늘 포함 30일이다', () => {
    expect(periodRange('month', now)).toEqual({ from: '2026-09-29', to: '2026-10-28' });
  });
});

describe('formatKstTime', () => {
  it('UTC ISO 를 KST MM-DD HH:mm 으로 보여준다', () => {
    expect(formatKstTime('2026-10-27T16:05:00.000Z')).toBe('10-28 01:05');
  });
});
