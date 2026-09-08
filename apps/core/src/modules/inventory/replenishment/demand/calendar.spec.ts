import { addDays, dayDiff, isIsoDate, kstDateOf } from './calendar';

describe('calendar — YYYY-MM-DD 산술', () => {
  it('addDays 는 달 · 해 경계를 넘는다', () => {
    expect(addDays('2026-09-08', -90)).toBe('2026-06-10');
    expect(addDays('2026-09-08', -365)).toBe('2025-09-08');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-09-08', 0)).toBe('2026-09-08');
  });

  it('dayDiff 는 to − from 이고 같은 날은 0', () => {
    expect(dayDiff('2026-06-10', '2026-09-07')).toBe(89);
    expect(dayDiff('2026-09-07', '2026-09-07')).toBe(0);
    expect(dayDiff('2026-09-08', '2026-09-07')).toBe(-1);
  });

  it('kstDateOf 는 UTC 15:00 부터 다음 날이다', () => {
    expect(kstDateOf(new Date('2026-09-08T14:59:59Z'))).toBe('2026-09-08');
    expect(kstDateOf(new Date('2026-09-08T15:00:00Z'))).toBe('2026-09-09');
  });

  it('isIsoDate', () => {
    expect(isIsoDate('2026-09-08')).toBe(true);
    expect(isIsoDate('2026-9-8')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
});
