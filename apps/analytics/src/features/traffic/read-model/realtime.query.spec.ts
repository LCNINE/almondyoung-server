import { mapRealtimeByMinute, mapRealtimeDimension, mapRealtimeTotal, REALTIME_WINDOW_MINUTES } from './realtime.query';

describe('mapRealtimeByMinute', () => {
  it('활동 없는 분을 0 으로 채워 30칸을 만든다', () => {
    const buckets = mapRealtimeByMinute({
      rows: [{ dimensionValues: [{ value: '3' }], metricValues: [{ value: '7' }] }],
    });
    expect(buckets).toHaveLength(REALTIME_WINDOW_MINUTES);
    expect(buckets.find((bucket) => bucket.minutesAgo === 3)?.activeUsers).toBe(7);
    expect(buckets.find((bucket) => bucket.minutesAgo === 4)?.activeUsers).toBe(0);
  });

  it('오래된 쪽이 왼쪽이다 — 스파크라인이 시간 순으로 읽혀야 한다', () => {
    const buckets = mapRealtimeByMinute({ rows: [] });
    expect(buckets[0].minutesAgo).toBe(REALTIME_WINDOW_MINUTES - 1);
    expect(buckets[buckets.length - 1].minutesAgo).toBe(0);
  });

  it('행이 없어도 빈 배열이 아니라 0 으로 채운 30칸을 준다', () => {
    expect(mapRealtimeByMinute({})).toHaveLength(REALTIME_WINDOW_MINUTES);
  });

  it('분 값이 숫자가 아니면 버린다', () => {
    const buckets = mapRealtimeByMinute({
      rows: [{ dimensionValues: [{ value: '(not set)' }], metricValues: [{ value: '9' }] }],
    });
    expect(buckets.every((bucket) => bucket.activeUsers === 0)).toBe(true);
  });
});

describe('mapRealtimeTotal', () => {
  it('총계는 분 단위 합이 아니라 별도 조회의 첫 행에서 읽는다', () => {
    expect(mapRealtimeTotal({ rows: [{ metricValues: [{ value: '42' }] }] })).toBe(42);
  });

  it('행이 없으면 0', () => {
    expect(mapRealtimeTotal({})).toBe(0);
  });
});

describe('mapRealtimeDimension', () => {
  it('라벨과 활성 사용자 수로 옮긴다', () => {
    expect(
      mapRealtimeDimension({
        rows: [{ dimensionValues: [{ value: '/products' }], metricValues: [{ value: '5' }] }],
      }),
    ).toEqual([{ label: '/products', activeUsers: 5 }]);
  });

  it('차원값이 비면 (not set) 으로 둔다', () => {
    expect(mapRealtimeDimension({ rows: [{ metricValues: [{ value: '2' }] }] })).toEqual([
      { label: '(not set)', activeUsers: 2 },
    ]);
  });
});
