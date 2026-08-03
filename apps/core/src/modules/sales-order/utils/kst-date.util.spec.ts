import { kstDayStart, kstDayEndInclusive, kstTodayRange } from './kst-date.util';

describe('kst-date.util', () => {
  it('KST 달력일 시작을 UTC-9h instant 로 변환한다', () => {
    expect(kstDayStart('2026-07-22').toISOString()).toBe('2026-07-21T15:00:00.000Z');
  });

  it('KST 달력일 종료(inclusive)를 UTC 로 변환한다', () => {
    expect(kstDayEndInclusive('2026-07-22').toISOString()).toBe('2026-07-22T14:59:59.999Z');
  });

  it('KST 00:30 주문은 그 날짜 범위에 포함된다', () => {
    const order = new Date('2026-07-22T00:30:00+09:00');
    expect(order >= kstDayStart('2026-07-22')).toBe(true);
    expect(order <= kstDayEndInclusive('2026-07-22')).toBe(true);
  });

  it('kstTodayRange 는 서버 TZ 와 무관하게 KST 달력일 경계를 낸다', () => {
    // now = 2026-07-22T01:00:00Z (= 10:00 KST) 로 고정
    jest.useFakeTimers().setSystemTime(new Date('2026-07-22T01:00:00Z'));
    const { start, end, backStart } = kstTodayRange(13);
    expect(start.toISOString()).toBe('2026-07-21T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-22T14:59:59.999Z');
    expect(backStart.toISOString()).toBe('2026-07-08T15:00:00.000Z');
    jest.useRealTimers();
  });
});
