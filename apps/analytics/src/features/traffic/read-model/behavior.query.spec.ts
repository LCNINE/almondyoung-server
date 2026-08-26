import { UpstreamUnavailableError } from '@app/shared';
import { Ga4Client } from '../ga4/ga4.client';
import { BehaviorQuery, mapBehaviorDailySeries, mapDeviceFunnel, mapEventCounts, mapItemBehavior } from './behavior.query';

function row(dimensions: string[], metrics: number[]) {
  return {
    dimensionValues: dimensions.map((value) => ({ value })),
    metricValues: metrics.map((value) => ({ value: String(value) })),
  };
}

type ReportRequest = { dimensions?: Array<{ name: string }> };

/** 요청의 차원 이름으로 어떤 리포트인지 판별해 응답을 돌려주는 가짜 GA4 */
function fakeReports(request: ReportRequest) {
  const names = (request.dimensions ?? []).map((d) => d.name).join(',');
  if (!names) {
    // sessions, totalUsers
    return { rows: [{ metricValues: [200, 150].map((v) => ({ value: String(v) })) }] };
  }
  if (names === 'eventName') {
    return {
      rows: [
        row(['view_item'], [100]),
        row(['add_to_cart'], [40]),
        row(['begin_checkout'], [20]),
        row(['add_payment_info'], [15]),
        row(['purchase'], [10]),
      ],
    };
  }
  if (names === 'date,eventName') {
    return {
      rows: [
        row(['20260801', 'view_item'], [60]),
        row(['20260801', 'purchase'], [6]),
        row(['20260803', 'view_item'], [40]),
        row(['20260803', 'add_to_cart'], [12]),
      ],
    };
  }
  if (names === 'date') {
    return { rows: [row(['20260801'], [120]), row(['20260803'], [80])] };
  }
  if (names === 'itemName') {
    return { rows: [row(['골드키위'], [50, 20, 5, 150000]), row(['퍼마블렌드'], [30, 0, 0, 0])] };
  }
  // deviceCategory,eventName
  return {
    rows: [
      row(['mobile', 'view_item'], [70]),
      row(['mobile', 'purchase'], [7]),
      row(['desktop', 'view_item'], [30]),
    ],
  };
}

function buildQuery(overrides?: { enabled?: boolean; runReport?: jest.Mock }) {
  const client = new Ga4Client();
  jest.spyOn(client, 'enabled', 'get').mockReturnValue(overrides?.enabled ?? true);
  const runReport = overrides?.runReport ?? jest.fn().mockImplementation(async (req) => fakeReports(req));
  jest.spyOn(client, 'runReport').mockImplementation(runReport);
  return { query: new BehaviorQuery(client), runReport };
}

describe('mapEventCounts', () => {
  it('eventName 행을 이벤트별 건수 맵으로 바꾼다', () => {
    const counts = mapEventCounts({ rows: [row(['view_item'], [100]), row(['purchase'], [10])] });
    expect(counts).toEqual({ view_item: 100, purchase: 10 });
  });
});

describe('mapBehaviorDailySeries', () => {
  it('이벤트 없는 날짜를 0으로 채우고 일별 전환율(구매÷세션)을 계산한다', () => {
    const events = {
      rows: [row(['20260801', 'view_item'], [60]), row(['20260801', 'purchase'], [6]), row(['20260803', 'add_to_cart'], [12])],
    };
    const sessions = { rows: [row(['20260801'], [120]), row(['20260803'], [80])] };
    const series = mapBehaviorDailySeries(events, sessions, '2026-08-01', '2026-08-03');
    expect(series).toEqual([
      { date: '2026-08-01', sessions: 120, viewItem: 60, addToCart: 0, purchase: 6, conversionRate: 0.05 },
      { date: '2026-08-02', sessions: 0, viewItem: 0, addToCart: 0, purchase: 0, conversionRate: null },
      { date: '2026-08-03', sessions: 80, viewItem: 0, addToCart: 12, purchase: 0, conversionRate: 0 },
    ]);
  });
});

describe('mapItemBehavior', () => {
  it('상품별 조회·담기·구매와 비율을 계산하고, 조회 0 이면 비율은 null 이다', () => {
    const rows = mapItemBehavior({
      rows: [row(['골드키위'], [50, 20, 5, 150000]), row(['미조회상품'], [0, 0, 0, 0])],
    });
    expect(rows[0]).toEqual({
      name: '골드키위',
      viewed: 50,
      addedToCart: 20,
      purchased: 5,
      revenue: 150000,
      cartRate: 0.4,
      purchaseRate: 0.1,
    });
    expect(rows[1].cartRate).toBeNull();
    expect(rows[1].purchaseRate).toBeNull();
  });
});

describe('mapDeviceFunnel', () => {
  it('기기별로 이벤트를 묶고 상품조회 많은 순으로 정렬한다', () => {
    const rows = mapDeviceFunnel({
      rows: [
        row(['desktop', 'view_item'], [30]),
        row(['mobile', 'view_item'], [70]),
        row(['mobile', 'purchase'], [7]),
      ],
    });
    expect(rows).toEqual([
      { device: 'mobile', viewItem: 70, addToCart: 0, purchase: 7, conversionRate: 0.1 },
      { device: 'desktop', viewItem: 30, addToCart: 0, purchase: 0, conversionRate: 0 },
    ]);
  });
});

describe('BehaviorQuery.getBehavior', () => {
  it('env 미배선이면 GA4 를 부르지 않고 enabled=false 를 돌려준다', async () => {
    const { query, runReport } = buildQuery({ enabled: false });
    const result = await query.getBehavior('2026-08-01', '2026-08-03', 20);
    expect(result.enabled).toBe(false);
    expect(result.totals).toBeNull();
    expect(result.series).toEqual([]);
    expect(runReport).not.toHaveBeenCalled();
  });

  it('여섯 리포트를 응답 모양으로 변환한다', async () => {
    const { query } = buildQuery();
    const result = await query.getBehavior('2026-08-01', '2026-08-03', 20);

    expect(result.enabled).toBe(true);
    expect(result.totals).toEqual({
      sessions: 200,
      totalUsers: 150,
      viewItem: 100,
      addToCart: 40,
      beginCheckout: 20,
      addPaymentInfo: 15,
      purchase: 10,
    });
    expect(result.series).toHaveLength(3);
    expect(result.items[0].name).toBe('골드키위');
    expect(result.devices[0].device).toBe('mobile');
  });

  it('같은 조회는 캐시에서 돌려준다 (외부 API 쿼터 보호)', async () => {
    const { query, runReport } = buildQuery();
    await query.getBehavior('2026-08-01', '2026-08-03', 20);
    await query.getBehavior('2026-08-01', '2026-08-03', 20);
    expect(runReport).toHaveBeenCalledTimes(6);
  });

  it('GA4 호출 실패는 500 이 아니라 UpstreamUnavailableError(502)로 나간다', async () => {
    const { query } = buildQuery({ runReport: jest.fn().mockRejectedValue(new Error('quota exceeded')) });
    await expect(query.getBehavior('2026-08-01', '2026-08-03', 20)).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });
});
