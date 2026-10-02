import { kstDayStart, kstNextDayStart } from './kst-day-range';

describe('KST 날짜 경계', () => {
  it('시작은 그날 한국 0시, 끝은 다음 날 한국 0시(미포함)다', () => {
    expect(kstDayStart('2026-09-30').toISOString()).toBe('2026-09-29T15:00:00.000Z');
    expect(kstNextDayStart('2026-09-30').toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('끝날 한국 시간 23시에 갱신된 건도 범위 안에 든다', () => {
    const updatedAt = new Date('2026-09-30T23:00:00+09:00');
    expect(updatedAt < kstNextDayStart('2026-09-30')).toBe(true);
    expect(updatedAt <= new Date('2026-09-30')).toBe(false); // 예전 방식은 이 건을 뺐다
  });
});
