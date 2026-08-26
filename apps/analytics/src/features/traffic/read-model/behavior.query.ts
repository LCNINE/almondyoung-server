import { Injectable, Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { protos } from '@google-analytics/data';
import { Ga4Client } from '../ga4/ga4.client';
import {
  BehaviorDailyBucketDto,
  BehaviorStatisticsResponseDto,
  BehaviorTotalsDto,
  DeviceFunnelRowDto,
  ItemBehaviorRowDto,
  LandingRevenueRowDto,
} from '../api/behavior-query.dto';
import { fromGa4Date } from './traffic.query';

type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/** GA4 는 외부 API 라 지연·쿼터가 있다 — 같은 조회는 잠시 재사용한다. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

/** 스토어프론트가 발사하는 구매 퍼널 이벤트 — 이 순서가 퍼널 단계 순서다. */
export const FUNNEL_EVENTS = [
  'view_item',
  'add_to_cart',
  'begin_checkout',
  'add_payment_info',
  'purchase',
] as const;

const FUNNEL_FILTER = {
  filter: {
    fieldName: 'eventName',
    inListFilter: { values: [...FUNNEL_EVENTS] },
  },
};

function toNum(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** eventName 차원 리포트 → 이벤트별 건수 맵 */
export function mapEventCounts(response: RunReportResponse): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of response.rows ?? []) {
    const name = row.dimensionValues?.[0]?.value ?? '';
    counts[name] = toNum(row.metricValues?.[0]?.value);
  }
  return counts;
}

/** date×eventName 리포트 + date 세션 리포트 → 이벤트 없는 날짜를 0으로 채운 일별 시리즈 */
export function mapBehaviorDailySeries(
  events: RunReportResponse,
  sessions: RunReportResponse,
  from: string,
  to: string,
): BehaviorDailyBucketDto[] {
  const eventsByDate = new Map<string, Record<string, number>>();
  for (const row of events.rows ?? []) {
    const date = fromGa4Date(row.dimensionValues?.[0]?.value ?? '');
    const eventName = row.dimensionValues?.[1]?.value ?? '';
    const bucket = eventsByDate.get(date) ?? {};
    bucket[eventName] = toNum(row.metricValues?.[0]?.value);
    eventsByDate.set(date, bucket);
  }
  const sessionsByDate = new Map<string, number>();
  for (const row of sessions.rows ?? []) {
    sessionsByDate.set(fromGa4Date(row.dimensionValues?.[0]?.value ?? ''), toNum(row.metricValues?.[0]?.value));
  }

  const series: BehaviorDailyBucketDto[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    const bucket = eventsByDate.get(date) ?? {};
    const daySessions = sessionsByDate.get(date) ?? 0;
    const purchase = bucket['purchase'] ?? 0;
    series.push({
      date,
      sessions: daySessions,
      viewItem: bucket['view_item'] ?? 0,
      addToCart: bucket['add_to_cart'] ?? 0,
      purchase,
      conversionRate: rate(purchase, daySessions),
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

/** itemName 차원 e-commerce 리포트 → 상품별 조회·담기·구매 행 */
export function mapItemBehavior(response: RunReportResponse): ItemBehaviorRowDto[] {
  return (response.rows ?? []).map((row) => {
    const viewed = toNum(row.metricValues?.[0]?.value);
    const addedToCart = toNum(row.metricValues?.[1]?.value);
    const purchased = toNum(row.metricValues?.[2]?.value);
    return {
      name: row.dimensionValues?.[0]?.value ?? '(not set)',
      viewed,
      addedToCart,
      purchased,
      revenue: toNum(row.metricValues?.[3]?.value),
      cartRate: rate(addedToCart, viewed),
      purchaseRate: rate(purchased, viewed),
    };
  });
}

/** landingPage 차원 리포트 → 랜딩페이지별 세션·구매·매출 행 */
export function mapLandingRevenue(response: RunReportResponse): LandingRevenueRowDto[] {
  return (response.rows ?? []).map((row) => {
    const sessions = toNum(row.metricValues?.[0]?.value);
    const transactions = toNum(row.metricValues?.[1]?.value);
    return {
      path: row.dimensionValues?.[0]?.value ?? '(not set)',
      sessions,
      transactions,
      revenue: toNum(row.metricValues?.[2]?.value),
      conversionRate: rate(transactions, sessions),
    };
  });
}

/** deviceCategory×eventName 리포트 → 기기별 퍼널 행 (상품조회 많은 순) */
export function mapDeviceFunnel(response: RunReportResponse): DeviceFunnelRowDto[] {
  const byDevice = new Map<string, Record<string, number>>();
  for (const row of response.rows ?? []) {
    const device = row.dimensionValues?.[0]?.value ?? '(not set)';
    const eventName = row.dimensionValues?.[1]?.value ?? '';
    const bucket = byDevice.get(device) ?? {};
    bucket[eventName] = toNum(row.metricValues?.[0]?.value);
    byDevice.set(device, bucket);
  }
  return [...byDevice.entries()]
    .map(([device, bucket]) => {
      const viewItem = bucket['view_item'] ?? 0;
      const purchase = bucket['purchase'] ?? 0;
      return {
        device,
        viewItem,
        addToCart: bucket['add_to_cart'] ?? 0,
        purchase,
        conversionRate: rate(purchase, viewItem),
      };
    })
    .sort((a, b) => b.viewItem - a.viewItem);
}

@Injectable()
export class BehaviorQuery {
  private readonly logger = new Logger(BehaviorQuery.name);
  private readonly cache = new Map<string, { at: number; value: BehaviorStatisticsResponseDto }>();

  constructor(private readonly ga4: Ga4Client) {}

  async getBehavior(from: string, to: string, limit: number): Promise<BehaviorStatisticsResponseDto> {
    const base = { range: { from, to } };
    if (!this.ga4.enabled) {
      return { ...base, enabled: false, totals: null, series: [], items: [], devices: [], landingRevenue: [] };
    }

    const cacheKey = `${from}|${to}|${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const dateRanges = [{ startDate: from, endDate: to }];

    let sessions: RunReportResponse;
    let funnel: RunReportResponse;
    let dailyEvents: RunReportResponse;
    let dailySessions: RunReportResponse;
    let items: RunReportResponse;
    let devices: RunReportResponse;
    let landing: RunReportResponse;
    try {
      [sessions, funnel, dailyEvents, dailySessions, items, devices, landing] = await Promise.all([
        this.ga4.runReport({
          dateRanges,
          metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter: FUNNEL_FILTER,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter: FUNNEL_FILTER,
          dimensions: [{ name: 'date' }, { name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          limit: 2500,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }],
          limit: 400,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensions: [{ name: 'itemName' }],
          metrics: [
            { name: 'itemsViewed' },
            { name: 'itemsAddedToCart' },
            { name: 'itemsPurchased' },
            { name: 'itemRevenue' },
          ],
          orderBys: [{ metric: { metricName: 'itemsViewed' }, desc: true }],
          limit,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter: FUNNEL_FILTER,
          dimensions: [{ name: 'deviceCategory' }, { name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          limit: 50,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensions: [{ name: 'landingPage' }],
          metrics: [{ name: 'sessions' }, { name: 'transactions' }, { name: 'purchaseRevenue' }],
          orderBys: [{ metric: { metricName: 'purchaseRevenue' }, desc: true }],
          limit,
        }),
      ]);
    } catch (error) {
      this.logger.warn(`GA4 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw new UpstreamUnavailableError('GA4 조회에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const sessionRow = sessions.rows?.[0];
    const eventCounts = mapEventCounts(funnel);
    const totals: BehaviorTotalsDto = {
      sessions: toNum(sessionRow?.metricValues?.[0]?.value),
      totalUsers: toNum(sessionRow?.metricValues?.[1]?.value),
      viewItem: eventCounts['view_item'] ?? 0,
      addToCart: eventCounts['add_to_cart'] ?? 0,
      beginCheckout: eventCounts['begin_checkout'] ?? 0,
      addPaymentInfo: eventCounts['add_payment_info'] ?? 0,
      purchase: eventCounts['purchase'] ?? 0,
    };

    const value: BehaviorStatisticsResponseDto = {
      ...base,
      enabled: true,
      totals,
      series: mapBehaviorDailySeries(dailyEvents, dailySessions, from, to),
      items: mapItemBehavior(items),
      devices: mapDeviceFunnel(devices),
      landingRevenue: mapLandingRevenue(landing),
    };

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
}
