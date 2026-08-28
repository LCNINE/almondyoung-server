import { Injectable, Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '@app/shared';
import { protos } from '@google-analytics/data';
import { Ga4Client } from '../ga4/ga4.client';
import { RealtimeBucketDto, RealtimeDimensionRowDto, RealtimeTrafficResponseDto } from '../api/traffic-query.dto';

type RunRealtimeReportResponse = protos.google.analytics.data.v1beta.IRunRealtimeReportResponse;

/** GA4 실시간 창은 30분 고정이다 — 0(지금)부터 29분 전까지. */
export const REALTIME_WINDOW_MINUTES = 30;

/**
 * 실시간은 화면이 자주 다시 부르는 축이라 캐시가 짧아야 뜻이 있다.
 * GA4 실시간 리포트도 쿼터를 소모하므로 20초는 재사용한다.
 */
const CACHE_TTL_MS = 20 * 1000;

function toNum(value: string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 활동이 없는 분(分)은 GA4 가 행을 주지 않는다 — 30칸을 0 으로 채워
 * 스파크라인이 실제보다 짧거나 끊겨 보이지 않게 한다. 오래된 쪽이 왼쪽이다.
 */
export function mapRealtimeByMinute(response: RunRealtimeReportResponse): RealtimeBucketDto[] {
  const byMinute = new Map<number, number>();
  for (const row of response.rows ?? []) {
    const minutesAgo = Number(row.dimensionValues?.[0]?.value ?? NaN);
    if (!Number.isInteger(minutesAgo)) continue;
    byMinute.set(minutesAgo, toNum(row.metricValues?.[0]?.value));
  }
  const buckets: RealtimeBucketDto[] = [];
  for (let minutesAgo = REALTIME_WINDOW_MINUTES - 1; minutesAgo >= 0; minutesAgo -= 1) {
    buckets.push({ minutesAgo, activeUsers: byMinute.get(minutesAgo) ?? 0 });
  }
  return buckets;
}

export function mapRealtimeDimension(response: RunRealtimeReportResponse): RealtimeDimensionRowDto[] {
  return (response.rows ?? []).map((row) => ({
    label: row.dimensionValues?.[0]?.value ?? '(not set)',
    activeUsers: toNum(row.metricValues?.[0]?.value),
  }));
}

/**
 * 분 단위 합은 전체 활성 사용자와 다르다 — 한 사람이 여러 분에 걸쳐 활동하면 중복으로 세진다.
 * 그래서 총계는 반드시 차원 없는 별도 조회에서 읽는다.
 */
export function mapRealtimeTotal(response: RunRealtimeReportResponse): number {
  return toNum(response.rows?.[0]?.metricValues?.[0]?.value);
}

@Injectable()
export class RealtimeQuery {
  private readonly logger = new Logger(RealtimeQuery.name);
  private cached: { at: number; value: RealtimeTrafficResponseDto } | null = null;

  constructor(private readonly ga4: Ga4Client) {}

  async getRealtime(limit: number): Promise<RealtimeTrafficResponseDto> {
    if (!this.ga4.enabled) {
      return {
        enabled: false,
        activeUsers: 0,
        observedAt: new Date().toISOString(),
        byMinute: [],
        pages: [],
        devices: [],
      };
    }

    const cached = this.cached;
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

    let totals: RunRealtimeReportResponse;
    let byMinute: RunRealtimeReportResponse;
    let pages: RunRealtimeReportResponse;
    let devices: RunRealtimeReportResponse;
    try {
      [totals, byMinute, pages, devices] = await Promise.all([
        this.ga4.runRealtimeReport({ metrics: [{ name: 'activeUsers' }] }),
        this.ga4.runRealtimeReport({
          dimensions: [{ name: 'minutesAgo' }],
          metrics: [{ name: 'activeUsers' }],
          limit: REALTIME_WINDOW_MINUTES,
        }),
        this.ga4.runRealtimeReport({
          dimensions: [{ name: 'unifiedScreenName' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit,
        }),
        this.ga4.runRealtimeReport({
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'activeUsers' }],
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
          limit: 10,
        }),
      ]);
    } catch (error) {
      this.logger.warn(`GA4 실시간 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      throw new UpstreamUnavailableError('실시간 접속 조회에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    const value: RealtimeTrafficResponseDto = {
      enabled: true,
      activeUsers: mapRealtimeTotal(totals),
      observedAt: new Date().toISOString(),
      byMinute: mapRealtimeByMinute(byMinute),
      pages: mapRealtimeDimension(pages),
      devices: mapRealtimeDimension(devices),
    };
    this.cached = { at: Date.now(), value };
    return value;
  }
}
