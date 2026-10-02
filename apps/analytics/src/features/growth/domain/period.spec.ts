import { bucketLabelOf, bucketLabels, bucketStartOf, previousRange } from './period';

describe('growth period', () => {
  it('주는 월요일 시작 — 일요일은 앞 주, 월요일은 그 주의 첫날', () => {
    expect(bucketStartOf('2032-03-07', 'week')).toBe('2032-03-01'); // 일
    expect(bucketStartOf('2032-03-08', 'week')).toBe('2032-03-08'); // 월
    expect(bucketStartOf('2026-01-01', 'week')).toBe('2025-12-29'); // 목 — 해를 넘는 주
  });

  it('월은 YYYY-MM 라벨, 일·주는 첫날 라벨', () => {
    expect(bucketLabelOf('2026-02-28', 'month')).toBe('2026-02');
    expect(bucketLabelOf('2026-02-28', 'day')).toBe('2026-02-28');
  });

  it('기간 안의 버킷을 빠짐없이, 중복 없이 낸다', () => {
    expect(bucketLabels('2032-03-01', '2032-03-14', 'week')).toEqual(['2032-03-01', '2032-03-08']);
    expect(bucketLabels('2026-01-30', '2026-03-02', 'month')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(bucketLabels('2026-02-27', '2026-03-01', 'day')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('직전 기간은 같은 길이로 바로 앞 — 윤년 2월을 넘는다', () => {
    expect(previousRange('2032-03-01', '2032-03-14')).toEqual({ from: '2032-02-16', to: '2032-02-29' });
  });
});
