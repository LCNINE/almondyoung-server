import { Injectable, Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { protos } from '@google-analytics/data';
import { Ga4Client } from '../ga4/ga4.client';
import {
  LandingPageRowDto,
  SessionsByDimensionRowDto,
  TrafficDailyBucketDto,
  TrafficStatisticsResponseDto,
  TrafficTotalsDto,
} from '../api/traffic-query.dto';

type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;

/** GA4 는 외부 API 라 지연·쿼터가 있다 — 같은 조회는 잠시 재사용한다. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 50;

const ORGANIC_FILTER = {
  filter: {
    fieldName: 'sessionDefaultChannelGroup',
    stringFilter: { matchType: 'EXACT' as const, value: 'Organic Search' },
  },
};

function toNum(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function engagementRate(engaged: number, sessions: number): number | null {
  return sessions > 0 ? engaged / sessions : null;
}

/** GA4 date 차원값(YYYYMMDD) → YYYY-MM-DD */
export function fromGa4Date(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** GA4 는 세션 0인 날짜를 행으로 주지 않는다 — 기간 전체를 0으로 채워 선이 끊기지 않게 한다. */
export function mapDailySeries(response: RunReportResponse, from: string, to: string): TrafficDailyBucketDto[] {
  const byDate = new Map<string, { sessions: number; engaged: number }>();
  for (const row of response.rows ?? []) {
    const date = fromGa4Date(row.dimensionValues?.[0]?.value ?? '');
    byDate.set(date, {
      sessions: toNum(row.metricValues?.[0]?.value),
      engaged: toNum(row.metricValues?.[1]?.value),
    });
  }
  const series: TrafficDailyBucketDto[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    const found = byDate.get(date);
    series.push({
      date,
      sessions: found?.sessions ?? 0,
      engagementRate: found ? engagementRate(found.engaged, found.sessions) : null,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

export function mapLandingPages(response: RunReportResponse): LandingPageRowDto[] {
  return (response.rows ?? []).map((row) => {
    const sessions = toNum(row.metricValues?.[0]?.value);
    return {
      path: row.dimensionValues?.[0]?.value ?? '(not set)',
      sessions,
      engagementRate: engagementRate(toNum(row.metricValues?.[1]?.value), sessions),
    };
  });
}

export function mapSessionsByDimension(response: RunReportResponse): SessionsByDimensionRowDto[] {
  return (response.rows ?? []).map((row) => ({
    label: row.dimensionValues?.[0]?.value ?? '(not set)',
    sessions: toNum(row.metricValues?.[0]?.value),
  }));
}

export function mapTotals(response: RunReportResponse): TrafficTotalsDto {
  const row = response.rows?.[0];
  const sessions = toNum(row?.metricValues?.[0]?.value);
  return {
    sessions,
    totalUsers: toNum(row?.metricValues?.[1]?.value),
    pageViews: toNum(row?.metricValues?.[2]?.value),
    engagementRate: engagementRate(toNum(row?.metricValues?.[3]?.value), sessions),
  };
}

@Injectable()
export class TrafficQuery {
  private readonly logger = new Logger(TrafficQuery.name);
  private readonly cache = new Map<string, { at: number; value: TrafficStatisticsResponseDto }>();

  constructor(private readonly ga4: Ga4Client) {}

  async getTraffic(
    from: string,
    to: string,
    channelGroup: 'organic' | 'all',
    limit: number,
  ): Promise<TrafficStatisticsResponseDto> {
    const base = { range: { from, to }, channelGroup };
    if (!this.ga4.enabled) {
      return { ...base, enabled: false, totals: null, series: [], landingPages: [], devices: [], countries: [] };
    }

    const cacheKey = `${from}|${to}|${channelGroup}|${limit}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    const dateRanges = [{ startDate: from, endDate: to }];
    const dimensionFilter = channelGroup === 'organic' ? ORGANIC_FILTER : undefined;

    let totals: RunReportResponse;
    let daily: RunReportResponse;
    let landing: RunReportResponse;
    let devices: RunReportResponse;
    let countries: RunReportResponse;
    try {
      [totals, daily, landing, devices, countries] = await Promise.all([
        this.ga4.runReport({
          dateRanges,
          dimensionFilter,
          metrics: [
            { name: 'sessions' },
            { name: 'totalUsers' },
            { name: 'screenPageViews' },
            { name: 'engagedSessions' },
          ],
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter,
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
          limit: 400,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter,
          dimensions: [{ name: 'landingPage' }],
          metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter,
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: 10,
        }),
        this.ga4.runReport({
          dateRanges,
          dimensionFilter,
          dimensions: [{ name: 'country' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit,
        }),
      ]);
    } catch (error) {
      this.logger.warn(`GA4 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw new UpstreamUnavailableError('GA4 조회에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const value: TrafficStatisticsResponseDto = {
      ...base,
      enabled: true,
      totals: mapTotals(totals),
      series: mapDailySeries(daily, from, to),
      landingPages: mapLandingPages(landing),
      devices: mapSessionsByDimension(devices),
      countries: mapSessionsByDimension(countries),
    };

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }
}
