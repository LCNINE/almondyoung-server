import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { max, sql } from 'drizzle-orm';
import { aggChannelDaily, analyticsSchema } from '../../../schema';
import { toSeoulDateOnly } from '../../../shared/date.util';
import { addDays } from '../domain/period';
import { RevenueGoal, RevenueGoalService } from '../settings/revenue-goal.service';
import { CustomerFlowQuery, CustomerFlowResult } from './customer-flow.query';
import { Ga4DailyPoint, Ga4Status, GrowthTrafficQuery } from './growth-traffic.query';
import { DailyRevenue, RevenueAxisQuery } from './revenue-axis.query';

/** 관리자 메인이 여는 경로라 짧게 재사용한다. 키는 «오늘» 하나뿐이라 상한이 필요 없다(날이 바뀌면 덮어쓴다). */
const SUMMARY_TTL_MS = 60 * 1000;
/** 변화 감지 기준선(같은 요일 최근 8주)에 필요한 일수 + 오늘. */
export const MONITOR_DAYS = 57;
/** 메인 카드·성장 탭 머리의 고객 흐름 창. 4주 = 요일이 고르게 들어간다. */
export const CUSTOMER_WINDOW_DAYS = 28;

export interface GrowthSummary {
  today: string;
  year: number;
  /** 집계 갱신 시각(UTC ISO). */
  dataAsOf: string | null;
  /** 집계 첫날. 연초보다 늦으면 그 이전 실적은 없다. */
  coverageStart: string | null;
  /** 최근 1년 집계에 들어온 판매채널 — 화면이 «전 채널» 범위를 열지 정한다 */
  channels: string[];
  goal: RevenueGoal | null;
  /** 올해 1월 1일(또는 집계 첫날)부터 오늘까지 일별 순매출. */
  ytdDaily: DailyRevenue[];
  /** 최근 MONITOR_DAYS 일 — 연초를 넘어가도 끊지 않는다(기준선·달성 확률용). */
  monitorDaily: DailyRevenue[];
  ga4Daily: { status: Ga4Status; points: Ga4DailyPoint[] };
  customers: Pick<CustomerFlowResult, 'range' | 'previousRange' | 'current' | 'previous' | 'growthAccounting' | 'repeatHeadline' | 'repurchaseDue' | 'timeToSecond'>;
}

/**
 * 관리자 메인 «올해 목표» 카드와 성장 탭 머리의 원천. 계산(페이싱·레버·확률)은 화면이 한다 —
 * wallet 상품 환불을 화면에서 병합해 차감해야 하므로 서버가 달성액을 확정할 수 없다.
 */
@Injectable()
export class GrowthSummaryQuery {
  private cache: { key: string; at: number; value: Promise<GrowthSummary> } | null = null;

  constructor(
    @InjectTypedDb<typeof analyticsSchema>() private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly revenue: RevenueAxisQuery,
    private readonly customers: CustomerFlowQuery,
    private readonly traffic: GrowthTrafficQuery,
    private readonly goals: RevenueGoalService,
  ) {}

  /** 같은 1분 안의 동시 요청은 한 번의 계산을 나눠 갖는다(약속 자체를 캐시). 실패한 약속은 버린다. */
  async get(now: Date = new Date()): Promise<GrowthSummary> {
    const today = toSeoulDateOnly(now);
    if (this.cache && this.cache.key === today && now.getTime() - this.cache.at < SUMMARY_TTL_MS) {
      return this.cache.value;
    }
    const value = this.compute(today);
    this.cache = { key: today, at: now.getTime(), value };
    value.catch(() => {
      if (this.cache?.value === value) this.cache = null;
    });
    return value;
  }

  invalidate() {
    this.cache = null;
  }

  private async compute(today: string): Promise<GrowthSummary> {
    const year = Number(today.slice(0, 4));
    const yearStart = `${year}-01-01`;
    const monitorFrom = addDays(today, -(MONITOR_DAYS - 1));
    const customerFrom = addDays(today, -(CUSTOMER_WINDOW_DAYS - 1));

    const [coverageStart, channels, goal, ytdDaily, monitorDaily, ga4Daily, flow, asOfRows] = await Promise.all([
      this.revenue.getCoverageStart(),
      this.revenue.getChannelsSince(addDays(today, -365)),
      this.goals.getCurrent(year),
      this.revenue.getDaily(yearStart, today),
      this.revenue.getDaily(monitorFrom, today),
      this.traffic.getDaily(monitorFrom, today),
      this.customers.getFlow(customerFrom, today, 'day', today),
      this.db
        .select({ updatedAt: sql<string | null>`to_char(${max(aggChannelDaily.updatedAt)}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` })
        .from(aggChannelDaily),
    ]);

    return {
      today,
      year,
      dataAsOf: asOfRows[0]?.updatedAt ?? null,
      coverageStart,
      channels,
      goal,
      ytdDaily,
      monitorDaily,
      ga4Daily,
      customers: {
        range: flow.range,
        previousRange: flow.previousRange,
        current: flow.current,
        previous: flow.previous,
        growthAccounting: flow.growthAccounting,
        repeatHeadline: flow.repeatHeadline,
        repurchaseDue: flow.repurchaseDue,
        timeToSecond: flow.timeToSecond,
      },
    };
  }

  private get db() {
    return this.dbService.db;
  }
}
