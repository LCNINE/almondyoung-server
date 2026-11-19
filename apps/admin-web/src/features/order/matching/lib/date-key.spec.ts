import { dateKeyOf, dateOfKey, kstToday } from './date-key';

describe('매칭 날짜', () => {
  it('고른 날을 그 달력일 그대로 쓴다', () => {
    expect(dateKeyOf(new Date(2026, 2, 2))).toBe('2026-03-02');
  });

  it('주소의 날짜를 선택기에 같은 날로 돌려준다', () => {
    const day = dateOfKey('2026-03-02');
    expect(dateKeyOf(day)).toBe('2026-03-02');
  });

  it('한국 오전 9시 전에도 오늘은 한국 날짜다', () => {
    expect(kstToday(new Date('2026-03-01T15:30:00.000Z'))).toBe('2026-03-02');
    expect(kstToday(new Date('2026-03-02T14:59:00.000Z'))).toBe('2026-03-02');
  });
});
