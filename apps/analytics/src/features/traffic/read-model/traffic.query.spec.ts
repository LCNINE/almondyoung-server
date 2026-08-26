import { UpstreamUnavailableError } from '@app/shared';
import { Ga4Client } from '../ga4/ga4.client';
import { TrafficQuery, fromGa4Date, mapDailySeries } from './traffic.query';

function row(dimension: string, metrics: number[]) {
  return {
    dimensionValues: [{ value: dimension }],
    metricValues: metrics.map((value) => ({ value: String(value) })),
  };
}

type ReportRequest = { dimensions?: Array<{ name: string }> };

/** 요청의 차원 이름으로 어떤 리포트인지 판별해 응답을 돌려주는 가짜 GA4 */
function fakeReports(request: ReportRequest) {
  const dimension = request.dimensions?.[0]?.name;
  if (!dimension) {
    // totals: sessions, totalUsers, screenPageViews, engagedSessions
    return { rows: [{ metricValues: [100, 80, 500, 60].map((v) => ({ value: String(v) })) }] };
  }
  if (dimension === 'date') {
    return { rows: [row('20260801', [40, 30]), row('20260803', [60, 30])] };
  }
  if (dimension === 'landingPage') {
    return { rows: [row('/kr', [50, 40]), row('/kr/search', [10, 2])] };
  }
  if (dimension === 'deviceCategory') {
    return { rows: [row('mobile', [70]), row('desktop', [30])] };
  }
  return { rows: [row('South Korea', [90]), row('Japan', [10])] };
}

function buildQuery(overrides?: { enabled?: boolean; runReport?: jest.Mock }) {
  const client = new Ga4Client();
  jest.spyOn(client, 'enabled', 'get').mockReturnValue(overrides?.enabled ?? true);
  const runReport = overrides?.runReport ?? jest.fn().mockImplementation(async (req) => fakeReports(req));
  jest.spyOn(client, 'runReport').mockImplementation(runReport);
  return { query: new TrafficQuery(client), runReport };
}

describe('fromGa4Date', () => {
  it('YYYYMMDD 를 YYYY-MM-DD 로 바꾼다', () => {
    expect(fromGa4Date('20260801')).toBe('2026-08-01');
  });
});

describe('mapDailySeries', () => {
  it('세션 없는 날짜를 0으로 채워 기간 전체를 돌려준다', () => {
    const response = { rows: [row('20260801', [40, 30]), row('20260803', [60, 30])] };
    const series = mapDailySeries(response, '2026-08-01', '2026-08-03');
    expect(series).toEqual([
      { date: '2026-08-01', sessions: 40, engagementRate: 0.75 },
      { date: '2026-08-02', sessions: 0, engagementRate: null },
      { date: '2026-08-03', sessions: 60, engagementRate: 0.5 },
    ]);
  });
});

describe('TrafficQuery.getTraffic', () => {
  it('env 미배선이면 GA4 를 부르지 않고 enabled=false 를 돌려준다', async () => {
    const { query, runReport } = buildQuery({ enabled: false });
    const result = await query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10);
    expect(result.enabled).toBe(false);
    expect(result.totals).toBeNull();
    expect(result.series).toEqual([]);
    expect(runReport).not.toHaveBeenCalled();
  });

  it('다섯 리포트를 응답 모양으로 변환한다', async () => {
    const { query } = buildQuery();
    const result = await query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10);

    expect(result.enabled).toBe(true);
    expect(result.totals).toEqual({ sessions: 100, totalUsers: 80, pageViews: 500, engagementRate: 0.6 });
    expect(result.series).toHaveLength(3);
    expect(result.landingPages[0]).toEqual({ path: '/kr', sessions: 50, engagementRate: 0.8 });
    expect(result.devices).toEqual([
      { label: 'mobile', sessions: 70 },
      { label: 'desktop', sessions: 30 },
    ]);
    expect(result.countries[0]).toEqual({ label: 'South Korea', sessions: 90 });
  });

  it('organic 은 자연검색 필터를 싣고, all 은 필터 없이 부른다', async () => {
    const { query, runReport } = buildQuery();
    await query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10);
    expect(runReport.mock.calls.every(([req]) => req.dimensionFilter !== undefined)).toBe(true);

    await query.getTraffic('2026-08-01', '2026-08-03', 'all', 10);
    const allCalls = runReport.mock.calls.slice(5);
    expect(allCalls.every(([req]) => req.dimensionFilter === undefined)).toBe(true);
  });

  it('같은 조회는 캐시에서 돌려준다 (외부 API 쿼터 보호)', async () => {
    const { query, runReport } = buildQuery();
    await query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10);
    await query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10);
    expect(runReport).toHaveBeenCalledTimes(5);
  });

  it('GA4 호출 실패는 500 이 아니라 UpstreamUnavailableError(502)로 나간다', async () => {
    const { query } = buildQuery({ runReport: jest.fn().mockRejectedValue(new Error('quota exceeded')) });
    await expect(query.getTraffic('2026-08-01', '2026-08-03', 'organic', 10)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});
