import { UpstreamUnavailableError } from '@app/shared';
import { Ga4Client } from '../ga4/ga4.client';
import { ItemBehaviorQuery, mapItemTotals, mapSingleItem } from './item-behavior.query';

function itemRow(dimensions: string[], metrics: number[]) {
  return {
    dimensionValues: dimensions.map((value) => ({ value })),
    metricValues: metrics.map((value) => ({ value: String(value) })),
  };
}

type ReportRequest = {
  dimensions?: Array<{ name: string }>;
  dimensionFilter?: { filter?: { fieldName?: string; stringFilter?: { value?: string } } };
};

describe('mapSingleItem', () => {
  it('필터 리포트의 첫 행을 상품 행으로 읽는다', () => {
    const result = mapSingleItem(
      { rows: [itemRow(['prod_1', '골드키위'], [100, 20, 5, 50000])] },
      'prod_1',
    );
    expect(result).toEqual({
      itemId: 'prod_1',
      name: '골드키위',
      viewed: 100,
      addedToCart: 20,
      purchased: 5,
      revenue: 50000,
      cartRate: 0.2,
      purchaseRate: 0.25,
    });
  });

  it('구매 전환율의 분모는 조회가 아니라 담기다', () => {
    // 조회 100 · 담기 20 · 구매 5 → 담기 대비 25%. 조회 대비였다면 5% 가 나온다.
    const result = mapSingleItem({ rows: [itemRow(['prod_1', 'x'], [100, 20, 5, 0])] }, 'prod_1');
    expect(result?.purchaseRate).toBeCloseTo(0.25);
  });

  it('기간 내 행이 없으면 null 이다 — 0 으로 채우지 않는다', () => {
    expect(mapSingleItem({ rows: [] }, 'prod_1')).toBeNull();
    expect(mapSingleItem({}, 'prod_1')).toBeNull();
  });

  it('분모가 0 이면 비율은 null 이다', () => {
    const result = mapSingleItem({ rows: [itemRow(['prod_1', 'x'], [0, 0, 0, 0])] }, 'prod_1');
    expect(result?.cartRate).toBeNull();
    expect(result?.purchaseRate).toBeNull();
  });
});

describe('mapItemTotals', () => {
  it('차원 없는 리포트의 한 행을 전 상품 합계로 읽는다', () => {
    expect(mapItemTotals({ rows: [{ metricValues: [1000, 250, 50].map((v) => ({ value: String(v) })) }] })).toEqual({
      viewed: 1000,
      addedToCart: 250,
      purchased: 50,
      cartRate: 0.25,
      purchaseRate: 0.2,
    });
  });

  it('행이 없으면 0 과 null 이다', () => {
    expect(mapItemTotals({ rows: [] })).toEqual({
      viewed: 0,
      addedToCart: 0,
      purchased: 0,
      cartRate: null,
      purchaseRate: null,
    });
  });
});

describe('ItemBehaviorQuery', () => {
  function build(runReport: jest.Mock, enabled = true) {
    const ga4 = { enabled, runReport } as unknown as Ga4Client;
    return new ItemBehaviorQuery(ga4);
  }

  it('GA4 env 가 없으면 조회하지 않고 enabled=false 를 준다', async () => {
    const runReport = jest.fn();
    const result = await build(runReport, false).getItemBehavior('2026-08-01', '2026-08-30', 'prod_1');
    expect(result).toEqual({
      enabled: false,
      range: { from: '2026-08-01', to: '2026-08-30' },
      itemId: 'prod_1',
      item: null,
      totals: null,
    });
    expect(runReport).not.toHaveBeenCalled();
  });

  it('itemId 로 필터한 리포트와 차원 없는 합계 리포트를 각각 한 번씩만 부른다', async () => {
    const runReport = jest.fn(async (request: ReportRequest) => {
      if (request.dimensions?.length) {
        return { rows: [itemRow(['prod_1', '골드키위'], [100, 20, 5, 50000])] };
      }
      return { rows: [{ metricValues: [1000, 250, 50].map((v) => ({ value: String(v) })) }] };
    });

    const result = await build(runReport).getItemBehavior('2026-08-01', '2026-08-30', 'prod_1');

    expect(runReport).toHaveBeenCalledTimes(2);
    const filtered = runReport.mock.calls.map(([req]) => req as ReportRequest).find((req) => req.dimensions?.length);
    expect(filtered?.dimensionFilter?.filter?.fieldName).toBe('itemId');
    expect(filtered?.dimensionFilter?.filter?.stringFilter?.value).toBe('prod_1');
    expect(result.item?.viewed).toBe(100);
    expect(result.totals?.viewed).toBe(1000);
  });

  it('같은 조회는 캐시로 재사용한다 — GA4 호출이 늘지 않는다', async () => {
    const runReport = jest.fn(async () => ({ rows: [] }));
    const query = build(runReport);
    await query.getItemBehavior('2026-08-01', '2026-08-30', 'prod_1');
    await query.getItemBehavior('2026-08-01', '2026-08-30', 'prod_1');
    expect(runReport).toHaveBeenCalledTimes(2);
  });

  it('itemId 가 다르면 캐시를 공유하지 않는다', async () => {
    const runReport = jest.fn(async () => ({ rows: [] }));
    const query = build(runReport);
    await query.getItemBehavior('2026-08-01', '2026-08-30', 'prod_1');
    await query.getItemBehavior('2026-08-01', '2026-08-30', 'prod_2');
    expect(runReport).toHaveBeenCalledTimes(4);
  });

  it('GA4 가 실패하면 업스트림 오류로 바꿔 던진다', async () => {
    const runReport = jest.fn(async () => {
      throw new Error('quota exceeded');
    });
    await expect(build(runReport).getItemBehavior('2026-08-01', '2026-08-30', 'prod_1')).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });
});
