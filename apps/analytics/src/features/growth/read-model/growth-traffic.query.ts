import { Injectable, Logger } from '@nestjs/common';
import { protos } from '@google-analytics/data';
import { Ga4Client } from '../../traffic/ga4/ga4.client';
import { FUNNEL_EVENTS } from '../../traffic/read-model/behavior.query';
import { fromGa4Date } from '../../traffic/read-model/traffic.query';
import type { GrowthGranularity } from '../api/growth-query.dto';
import { bucketLabelOf, bucketLabels, previousRange } from '../domain/period';

type RunReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;
type RunReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;

/** 기존 유입·행동 탭과 같은 5분. 캐시는 따로 둔다 — 같은 FIFO 를 쓰면 서로의 엔트리를 밀어내 GA4 호출이 는다. */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 30;

/**
 * 결제사(PG) 도메인이 유입원으로 잡힌 방문. 결제창을 다녀온 고객이 «추천(Referral) 유입»으로 새로 잡히고
 * 그 구매가 원래 채널(대부분 검색)에서 빠져나간다. 랜딩 경로로는 거의 안 잡혀(복귀 페이지가 결제 경로가 아님)
 * 유입원으로 잰다. 근본 처방은 GA4 관리 화면의 «원치 않는 참조»에 결제사 도메인을 넣는 것이다.
 */
const PAYMENT_GATEWAY_SOURCES = 'tosspayments|nicepay|inicis|kcp\\.|kakaopay|pay\\.naver|payco|danal';

export type Ga4Status = 'ok' | 'disabled' | 'failed';

export interface Ga4Totals {
  sessions: number;
  totalUsers: number;
  newUsers: number;
  transactions: number;
}

export interface Ga4SplitRow {
  label: string;
  current: { sessions: number; transactions: number };
  previous: { sessions: number; transactions: number };
}

export interface GrowthTrafficResult {
  status: Ga4Status;
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  totals: { current: Ga4Totals; previous: Ga4Totals } | null;
  /** 세션·신규 방문자·GA4 구매는 날짜끼리 더해도 된다. 방문자(totalUsers)는 더할 수 없어 시계열에 없다. */
  series: Array<{ bucket: string; sessions: number; newUsers: number; transactions: number }>;
  channelSeries: Array<{ bucket: string; channel: string; sessions: number }>;
  channels: Ga4SplitRow[];
  devices: Ga4SplitRow[];
  visitorTypes: Ga4SplitRow[];
  funnel: { current: Record<string, number>; previous: Record<string, number> } | null;
  /** 결제사에서 돌아와 Referral 로 잡힌 방문과 그 구매 */
  paymentReturns: { current: { sessions: number; transactions: number }; previous: { sessions: number; transactions: number } } | null;
}

export interface Ga4DailyPoint {
  date: string;
  sessions: number;
  transactions: number;
}

const toNum = (value: string | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** 여러 기간을 한 요청에 넣으면 GA4 가 `dateRange` 차원을 붙인다. 위치에 기대지 않고 헤더로 찾는다. */
function rangeIndex(response: RunReportResponse): number {
  return (response.dimensionHeaders ?? []).findIndex((h) => h.name === 'dateRange');
}

export function mapSplit(response: RunReportResponse): Ga4SplitRow[] {
  const ri = rangeIndex(response);
  const rows = new Map<string, Ga4SplitRow>();
  for (const row of response.rows ?? []) {
    const label = row.dimensionValues?.[0]?.value ?? '(not set)';
    const which = ri >= 0 ? row.dimensionValues?.[ri]?.value : 'current';
    const entry = rows.get(label) ?? {
      label,
      current: { sessions: 0, transactions: 0 },
      previous: { sessions: 0, transactions: 0 },
    };
    const values = { sessions: toNum(row.metricValues?.[0]?.value), transactions: toNum(row.metricValues?.[1]?.value) };
    if (which === 'previous') entry.previous = values;
    else entry.current = values;
    rows.set(label, entry);
  }
  return [...rows.values()].sort((a, b) => b.current.sessions - a.current.sessions);
}

function mapTotalsByRange(response: RunReportResponse): { current: Ga4Totals; previous: Ga4Totals } {
  const ri = rangeIndex(response);
  const empty = (): Ga4Totals => ({ sessions: 0, totalUsers: 0, newUsers: 0, transactions: 0 });
  const out = { current: empty(), previous: empty() };
  for (const row of response.rows ?? []) {
    const which = ri >= 0 ? row.dimensionValues?.[ri]?.value : 'current';
    const m = row.metricValues ?? [];
    out[which === 'previous' ? 'previous' : 'current'] = {
      sessions: toNum(m[0]?.value),
      totalUsers: toNum(m[1]?.value),
      newUsers: toNum(m[2]?.value),
      transactions: toNum(m[3]?.value),
    };
  }
  return out;
}

function mapEventsByRange(response: RunReportResponse): { current: Record<string, number>; previous: Record<string, number> } {
  const ri = rangeIndex(response);
  const out = { current: {} as Record<string, number>, previous: {} as Record<string, number> };
  for (const row of response.rows ?? []) {
    const which = ri >= 0 ? row.dimensionValues?.[ri]?.value : 'current';
    out[which === 'previous' ? 'previous' : 'current'][row.dimensionValues?.[0]?.value ?? ''] = toNum(row.metricValues?.[0]?.value);
  }
  return out;
}

export function mapPaymentReturnsByRange(response: RunReportResponse) {
  const ri = rangeIndex(response);
  const out = { current: { sessions: 0, transactions: 0 }, previous: { sessions: 0, transactions: 0 } };
  for (const row of response.rows ?? []) {
    const which = ri >= 0 ? row.dimensionValues?.[ri]?.value : 'current';
    const target = out[which === 'previous' ? 'previous' : 'current'];
    target.sessions += toNum(row.metricValues?.[0]?.value);
    target.transactions += toNum(row.metricValues?.[1]?.value);
  }
  return out;
}

/** GA4 일자(YYYYMMDD) 행을 버킷으로 접는다. 빈 버킷은 0. */
export function foldDailySeries(response: RunReportResponse, from: string, to: string, granularity: GrowthGranularity) {
  const byBucket = new Map<string, { sessions: number; newUsers: number; transactions: number }>();
  for (const row of response.rows ?? []) {
    const date = fromGa4Date(row.dimensionValues?.[0]?.value ?? '');
    const bucket = bucketLabelOf(date, granularity);
    const entry = byBucket.get(bucket) ?? { sessions: 0, newUsers: 0, transactions: 0 };
    entry.sessions += toNum(row.metricValues?.[0]?.value);
    entry.newUsers += toNum(row.metricValues?.[1]?.value);
    entry.transactions += toNum(row.metricValues?.[2]?.value);
    byBucket.set(bucket, entry);
  }
  return bucketLabels(from, to, granularity).map((bucket) => ({
    bucket,
    ...(byBucket.get(bucket) ?? { sessions: 0, newUsers: 0, transactions: 0 }),
  }));
}

function foldChannelSeries(response: RunReportResponse, granularity: GrowthGranularity) {
  const byKey = new Map<string, { bucket: string; channel: string; sessions: number }>();
  for (const row of response.rows ?? []) {
    const bucket = bucketLabelOf(fromGa4Date(row.dimensionValues?.[0]?.value ?? ''), granularity);
    const channel = row.dimensionValues?.[1]?.value ?? '(not set)';
    const key = `${bucket}|${channel}`;
    const entry = byKey.get(key) ?? { bucket, channel, sessions: 0 };
    entry.sessions += toNum(row.metricValues?.[0]?.value);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => a.bucket.localeCompare(b.bucket) || b.sessions - a.sessions);
}

/**
 * 성장 탭의 GA4 축. 전 채널이 기본이다(유입 탭의 organic 기본값과 다르다 — 그 라우트는 손대지 않는다).
 * GA4 가 꺼져 있거나 실패해도 throw 하지 않고 status 로 알린다 — 같은 화면의 주문·재구매 숫자는 GA4 와 무관하게 떠야 한다.
 */
@Injectable()
export class GrowthTrafficQuery {
  private readonly logger = new Logger(GrowthTrafficQuery.name);
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(private readonly ga4: Ga4Client) {}

  private cached<T>(key: string): T | undefined {
    const hit = this.cache.get(key);
    if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) return undefined;
    this.cache.delete(key);
    this.cache.set(key, hit); // 최근 사용을 뒤로 — 오래 안 쓴 것부터 축출(LRU)
    return hit.value as T;
  }

  private remember(key: string, value: unknown) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), value });
  }

  private run(request: Omit<RunReportRequest, 'property'>) {
    return this.ga4.runReport(request);
  }

  async getTraffic(from: string, to: string, granularity: GrowthGranularity): Promise<GrowthTrafficResult> {
    const prev = previousRange(from, to);
    const base = {
      range: { from, to },
      previousRange: prev,
      totals: null,
      series: [],
      channelSeries: [],
      channels: [],
      devices: [],
      visitorTypes: [],
      funnel: null,
      paymentReturns: null,
    };
    if (!this.ga4.enabled) return { status: 'disabled', ...base };

    const key = `traffic|${from}|${to}|${granularity}`;
    const hit = this.cached<GrowthTrafficResult>(key);
    if (hit) return hit;

    const both = [
      { startDate: from, endDate: to, name: 'current' },
      { startDate: prev.from, endDate: prev.to, name: 'previous' },
    ];
    const current = [{ startDate: from, endDate: to }];
    try {
      const [totals, daily, channelDaily, channels, devices, visitorTypes, funnel, checkout] = await Promise.all([
        this.run({ dateRanges: both, metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'transactions' }] }),
        this.run({
          dateRanges: current,
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'transactions' }],
          limit: 1000,
        }),
        this.run({
          dateRanges: current,
          dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          limit: 10000,
        }),
        this.run({
          dateRanges: both,
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }, { name: 'transactions' }],
          limit: 50,
        }),
        this.run({
          dateRanges: both,
          dimensions: [{ name: 'deviceCategory' }],
          metrics: [{ name: 'sessions' }, { name: 'transactions' }],
          limit: 20,
        }),
        this.run({
          dateRanges: both,
          dimensions: [{ name: 'newVsReturning' }],
          metrics: [{ name: 'sessions' }, { name: 'transactions' }],
          limit: 10,
        }),
        this.run({
          dateRanges: both,
          dimensions: [{ name: 'eventName' }],
          metrics: [{ name: 'eventCount' }],
          dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: [...FUNNEL_EVENTS] } } },
        }),
        this.run({
          dateRanges: both,
          dimensions: [{ name: 'sessionSource' }],
          metrics: [{ name: 'sessions' }, { name: 'transactions' }],
          dimensionFilter: {
            filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'PARTIAL_REGEXP', value: PAYMENT_GATEWAY_SOURCES } },
          },
          limit: 200,
        }),
      ]);
      const value: GrowthTrafficResult = {
        status: 'ok',
        ...base,
        totals: mapTotalsByRange(totals),
        series: foldDailySeries(daily, from, to, granularity),
        channelSeries: foldChannelSeries(channelDaily, granularity),
        channels: mapSplit(channels),
        devices: mapSplit(devices),
        visitorTypes: mapSplit(visitorTypes),
        funnel: mapEventsByRange(funnel),
        paymentReturns: mapPaymentReturnsByRange(checkout),
      };
      this.remember(key, value);
      return value;
    } catch (error) {
      this.logger.warn(`GA4 성장 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'failed', ...base };
    }
  }

  /** 변화 감지용 일별 세션·GA4 구매. 실패해도 throw 하지 않는다. */
  async getDaily(from: string, to: string): Promise<{ status: Ga4Status; points: Ga4DailyPoint[] }> {
    if (!this.ga4.enabled) return { status: 'disabled', points: [] };
    const key = `daily|${from}|${to}`;
    const hit = this.cached<{ status: Ga4Status; points: Ga4DailyPoint[] }>(key);
    if (hit) return hit;
    try {
      const response = await this.run({
        dateRanges: [{ startDate: from, endDate: to }],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }, { name: 'newUsers' }, { name: 'transactions' }],
        limit: 1000,
      });
      const points = foldDailySeries(response, from, to, 'day').map((p) => ({
        date: p.bucket,
        sessions: p.sessions,
        transactions: p.transactions,
      }));
      const value = { status: 'ok' as const, points };
      this.remember(key, value);
      return value;
    } catch (error) {
      this.logger.warn(`GA4 일별 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return { status: 'failed', points: [] };
    }
  }
}
