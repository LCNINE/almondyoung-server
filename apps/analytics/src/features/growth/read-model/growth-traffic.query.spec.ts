import { Ga4Client } from '../../traffic/ga4/ga4.client';
import { GrowthTrafficQuery, foldDailySeries, mapPaymentReturnsByRange, mapSplit } from './growth-traffic.query';

const dims = (...names: string[]) => names.map((name) => ({ name }));
const row = (d: string[], m: number[]) => ({
  dimensionValues: d.map((value) => ({ value })),
  metricValues: m.map((v) => ({ value: String(v) })),
});

function fakeGa4(enabled: boolean, impl: (req: { dimensions?: Array<{ name: string }> }) => unknown) {
  const calls: unknown[] = [];
  const client = {
    get enabled() {
      return enabled;
    },
    runReport: async (req: { dimensions?: Array<{ name: string }> }) => {
      calls.push(req);
      return impl(req);
    },
  } as unknown as Ga4Client;
  return { client, calls };
}

describe('GrowthTrafficQuery', () => {
  it('두 기간을 한 요청에 넣으면 dateRange 차원으로 갈라 담는다 — 위치가 아니라 헤더로 찾는다', () => {
    const split = mapSplit({
      dimensionHeaders: dims('dateRange', 'sessionDefaultChannelGroup').reverse(),
      rows: [row(['Organic Search', 'current'], [100, 3]), row(['Organic Search', 'previous'], [80, 1]), row(['Direct', 'current'], [50, 2])],
    });
    expect(split).toEqual([
      { label: 'Organic Search', current: { sessions: 100, transactions: 3 }, previous: { sessions: 80, transactions: 1 } },
      { label: 'Direct', current: { sessions: 50, transactions: 2 }, previous: { sessions: 0, transactions: 0 } },
    ]);
  });

  it('일별 GA4 행을 주 버킷(월요일 시작)으로 접고 빈 버킷은 0', () => {
    const series = foldDailySeries(
      { rows: [row(['20320302'], [10, 2, 1]), row(['20320307'], [5, 1, 0]), row(['20320308'], [7, 0, 1])] },
      '2032-03-01',
      '2032-03-21',
      'week',
    );
    expect(series).toEqual([
      { bucket: '2032-03-01', sessions: 15, newUsers: 3, transactions: 1 },
      { bucket: '2032-03-08', sessions: 7, newUsers: 0, transactions: 1 },
      { bucket: '2032-03-15', sessions: 0, newUsers: 0, transactions: 0 },
    ]);
  });

  it('GA4 미연동이면 호출 없이 disabled', async () => {
    const { client, calls } = fakeGa4(false, () => ({}));
    const result = await new GrowthTrafficQuery(client).getTraffic('2032-03-01', '2032-03-14', 'day');
    expect(result.status).toBe('disabled');
    expect(calls).toHaveLength(0);
  });

  it('GA4 가 실패해도 throw 하지 않고 failed — 같은 화면의 주문 숫자를 막지 않는다', async () => {
    const { client } = fakeGa4(true, () => {
      throw new Error('quota');
    });
    const result = await new GrowthTrafficQuery(client).getTraffic('2032-03-01', '2032-03-14', 'day');
    expect(result.status).toBe('failed');
    expect(result.totals).toBeNull();
  });

  it('같은 조회는 5분 안에 GA4 를 다시 부르지 않는다 (화면 1회 = 리포트 8개, 적중 시 0개)', async () => {
    const { client, calls } = fakeGa4(true, () => ({ rows: [] }));
    const query = new GrowthTrafficQuery(client);
    await query.getTraffic('2032-03-01', '2032-03-14', 'day');
    expect(calls).toHaveLength(8);
    await query.getTraffic('2032-03-01', '2032-03-14', 'day');
    expect(calls).toHaveLength(8);
  });

  it('결제사 복귀는 랜딩 경로가 아니라 유입원(sessionSource) 정규식으로 잰다', async () => {
    const { client, calls } = fakeGa4(true, () => ({ rows: [] }));
    await new GrowthTrafficQuery(client).getTraffic('2032-03-01', '2032-03-14', 'day');
    const pg = (calls as Array<{ dimensionFilter?: { filter?: { fieldName?: string; stringFilter?: { matchType?: string; value?: string } } } }>)
      .find((c) => c.dimensionFilter?.filter?.fieldName === 'sessionSource');
    expect(pg?.dimensionFilter?.filter?.stringFilter?.matchType).toBe('PARTIAL_REGEXP');
    expect(new RegExp(pg?.dimensionFilter?.filter?.stringFilter?.value ?? '').test('payment-gateway.tosspayments.com')).toBe(true);
    expect(new RegExp(pg?.dimensionFilter?.filter?.stringFilter?.value ?? '').test('m.search.naver.com')).toBe(false);
    expect(mapPaymentReturnsByRange({
      dimensionHeaders: [{ name: 'sessionSource' }, { name: 'dateRange' }],
      rows: [row(['payment-gateway.tosspayments.com', 'current'], [120, 3]), row(['payment-gateway.tosspayments.com', 'previous'], [80, 2])],
    })).toEqual({ current: { sessions: 120, transactions: 3 }, previous: { sessions: 80, transactions: 2 } });
  });
});
