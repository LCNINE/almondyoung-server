import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, asc, eq, gte, lte, min, sql } from 'drizzle-orm';
import { aggChannelDaily, analyticsSchema } from '../../../schema';
import type { GrowthGranularity } from '../api/growth-query.dto';
import { bucketLabel, bucketLabels, bucketStart, previousRange } from '../domain/period';
import { OWN_MALL_CHANNEL } from './customer-flow.query';

export interface RevenueTotals {
  orders: number;
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  /** 총매출 − 취소 − 환불. 매출 탭의 순매출과 같은 정의다. */
  netRevenue: number;
}

export interface RevenueBucket extends RevenueTotals {
  bucket: string;
}

export interface ChannelShare {
  salesChannel: string;
  current: RevenueTotals;
  previous: RevenueTotals;
}

export interface RevenueAxisResult {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  granularity: GrowthGranularity;
  ownMall: { series: RevenueBucket[]; current: RevenueTotals; previous: RevenueTotals };
  channels: ChannelShare[];
}

export interface DailyRevenue {
  date: string;
  allChannels: number;
  ownMall: number;
  ownMallOrders: number;
}

const ZERO: RevenueTotals = { orders: 0, grossRevenue: 0, cancelledAmount: 0, refundedAmount: 0, netRevenue: 0 };

function totals(row: { orders: unknown; gross: unknown; cancelled: unknown; refunded: unknown } | undefined): RevenueTotals {
  const orders = Number(row?.orders ?? 0);
  const grossRevenue = Number(row?.gross ?? 0);
  const cancelledAmount = Number(row?.cancelled ?? 0);
  const refundedAmount = Number(row?.refunded ?? 0);
  return { orders, grossRevenue, cancelledAmount, refundedAmount, netRevenue: grossRevenue - cancelledAmount - refundedAmount };
}

const SUMS = {
  orders: sql<string>`COALESCE(SUM(${aggChannelDaily.ordersCount}), 0)`,
  gross: sql<string>`COALESCE(SUM(${aggChannelDaily.grossRevenue}), 0)`,
  cancelled: sql<string>`COALESCE(SUM(${aggChannelDaily.cancelledAmount}), 0)`,
  refunded: sql<string>`COALESCE(SUM(${aggChannelDaily.refundedAmount}), 0)`,
};

/** 매출 축. `agg_channel_daily` 만 읽는다 — 매출 탭과 같은 원천이라 두 화면의 순매출이 같은 숫자를 말한다. */
@Injectable()
export class RevenueAxisQuery {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly dbService: DbService<typeof analyticsSchema>) {}

  private get db() {
    return this.dbService.db;
  }

  async getAxis(from: string, to: string, granularity: GrowthGranularity): Promise<RevenueAxisResult> {
    const prev = previousRange(from, to);
    const start = bucketStart(sql`${aggChannelDaily.aggDate}`, granularity);
    const label = bucketLabel(start, granularity);

    const [seriesRows, channelRows] = await Promise.all([
      this.db
        .select({ bucket: sql<string>`${label}`, ...SUMS })
        .from(aggChannelDaily)
        .where(
          and(
            eq(aggChannelDaily.salesChannel, OWN_MALL_CHANNEL),
            gte(aggChannelDaily.aggDate, from),
            lte(aggChannelDaily.aggDate, to),
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      this.db
        .select({
          salesChannel: aggChannelDaily.salesChannel,
          isCurrent: sql<boolean>`${aggChannelDaily.aggDate} >= ${from}::date`,
          ...SUMS,
        })
        .from(aggChannelDaily)
        .where(and(gte(aggChannelDaily.aggDate, prev.from), lte(aggChannelDaily.aggDate, to)))
        .groupBy(sql`1`, sql`2`),
    ]);

    const byBucket = new Map(seriesRows.map((row) => [row.bucket, totals(row)]));
    const series = bucketLabels(from, to, granularity).map((bucket) => ({ bucket, ...(byBucket.get(bucket) ?? ZERO) }));

    const channelMap = new Map<string, ChannelShare>();
    for (const row of channelRows) {
      const entry = channelMap.get(row.salesChannel) ?? { salesChannel: row.salesChannel, current: ZERO, previous: ZERO };
      if (row.isCurrent) entry.current = totals(row);
      else entry.previous = totals(row);
      channelMap.set(row.salesChannel, entry);
    }
    const channels = [...channelMap.values()].sort((a, b) => b.current.netRevenue - a.current.netRevenue);
    const own = channelMap.get(OWN_MALL_CHANNEL);

    return {
      range: { from, to },
      previousRange: prev,
      granularity,
      ownMall: { series, current: own?.current ?? ZERO, previous: own?.previous ?? ZERO },
      channels,
    };
  }

  /** 일별 순매출(전 채널·자사몰). 비어 있는 날도 0 으로 채운다 — 목표 페이싱·달성 확률의 원천. */
  async getDaily(from: string, to: string): Promise<DailyRevenue[]> {
    const rows = await this.db
      .select({
        date: sql<string>`to_char(${aggChannelDaily.aggDate}, 'YYYY-MM-DD')`,
        isOwn: sql<boolean>`${aggChannelDaily.salesChannel} = ${OWN_MALL_CHANNEL}`,
        ...SUMS,
      })
      .from(aggChannelDaily)
      .where(and(gte(aggChannelDaily.aggDate, from), lte(aggChannelDaily.aggDate, to)))
      .groupBy(sql`1`, sql`2`)
      .orderBy(asc(sql`1`));
    const byDate = new Map<string, DailyRevenue>();
    for (const row of rows) {
      const entry = byDate.get(row.date) ?? { date: row.date, allChannels: 0, ownMall: 0, ownMallOrders: 0 };
      const t = totals(row);
      entry.allChannels += t.netRevenue;
      if (row.isOwn) {
        entry.ownMall += t.netRevenue;
        entry.ownMallOrders += t.orders;
      }
      byDate.set(row.date, entry);
    }
    return bucketLabels(from, to, 'day').map(
      (date) => byDate.get(date) ?? { date, allChannels: 0, ownMall: 0, ownMallOrders: 0 },
    );
  }

  /** 최근 1년 사이 집계에 실제로 들어온 판매채널. 외부 채널이 없으면 «전 채널» 목표는 자사몰과 같은 숫자다. */
  async getChannelsSince(from: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ salesChannel: aggChannelDaily.salesChannel })
      .from(aggChannelDaily)
      .where(gte(aggChannelDaily.aggDate, from));
    return rows.map((r) => r.salesChannel).sort();
  }

  /** 집계가 시작된 첫날(전 채널). 연초 이후면 그 이전 실적은 이 표에 없다. */
  async getCoverageStart(): Promise<string | null> {
    const [row] = await this.db.select({ first: min(aggChannelDaily.aggDate) }).from(aggChannelDaily);
    return row?.first ? String(row.first) : null;
  }
}
