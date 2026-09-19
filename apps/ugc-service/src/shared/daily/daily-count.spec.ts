import { buildDailyCountSeries } from './daily-count';

describe('buildDailyCountSeries', () => {
  it('기록이 없는 날을 0 으로 채워 기간 전체를 준다', () => {
    expect(buildDailyCountSeries([{ day: '2026-09-15', count: 3 }], '2026-09-14', '2026-09-16')).toEqual([
      { bucket: '2026-09-14', count: 0 },
      { bucket: '2026-09-15', count: 3 },
      { bucket: '2026-09-16', count: 0 },
    ]);
  });
});
