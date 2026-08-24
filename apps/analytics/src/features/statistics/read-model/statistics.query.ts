import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, SQL } from 'drizzle-orm';
import {
  aggChannelDaily,
  aggCustomerLifetime,
  aggMembershipDaily,
  aggProductOrderDaily,
  aggVariantOrderDaily,
  analyticsSchema,
  dimCustomerMembership,
  dimProductCategories,
  dimProductMasters,
  dimProductVariants,
  factMembershipEvents,
  factOrderItems,
} from '../../../schema';
import { SEOUL_TZ, seoulDayStart, toSeoulDateOnly } from '../../../shared/date.util';

export type Granularity = 'day' | 'month' | 'year';

/** 순매출을 낼 수 있는 표(agg_channel_daily·agg_product_order_daily)의 공통 금액 묶음. */
export interface RevenueTotals {
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  /** grossRevenue - cancelledAmount - refundedAmount. 취소가 취소일에 귀속되므로 음수가 될 수 있다. */
  netRevenue: number;
  ordersCount: number;
}

export interface SalesKpis extends RevenueTotals {
  /** 순매출 / 주문수. 주문이 없으면 null. */
  avgOrderValue: number | null;
  /** (취소+환불) / 총매출 — 금액 기준. 코호트 교차 비율이라 1을 넘을 수 있다. 총매출 0이면 null. */
  cancelRefundRate: number | null;
}

export interface SalesStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  kpis: SalesKpis;
  previousKpis: SalesKpis;
  series: Array<{ bucket: string } & RevenueTotals>;
  channels: Array<{ salesChannel: string } & RevenueTotals>;
  cancelReasons: Array<{ reason: string; count: number }>;
}

export interface ProductRankingRow extends RevenueTotals {
  masterId: string;
  name: string | null;
  quantitySold: number;
  /** 직전 동일 길이 기간의 순매출 — 급상승/급하락 판정용 */
  previousNetRevenue: number;
}

export interface ProductStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  ranking: ProductRankingRow[];
  /** primary 카테고리 기준 — 다중 카테고리 중복 가산을 피한다 */
  categories: Array<{ categoryId: string; grossRevenue: number; quantitySold: number }>;
  /** 옵션별은 총매출만 존재한다 — 순매출로 라벨링하지 말 것 */
  variants: Array<{
    variantId: string;
    variantName: string | null;
    masterId: string;
    masterName: string | null;
    quantitySold: number;
    grossRevenue: number;
  }>;
}

export interface CustomerStatistics {
  range: { from: string; to: string };
  /** 전 기간 누적 지표 — 기간 필터와 무관하다 (agg_customer_lifetime 이 전 기간 원장). */
  lifetime: {
    customersTotal: number;
    repeatCustomers: number;
    /** ordersCount>=2 고객 비율. 고객이 없으면 null. 비회원 주문은 분모에 없다. */
    repurchaseRate: number | null;
    ordersTotal: number;
    totalRevenue: number;
    avgRevenuePerCustomer: number | null;
  };
  /** 기간 내 첫 주문 고객 수 추이 (신규 고객) */
  newCustomers: Array<{ bucket: string; count: number }>;
  /** 총매출 기준 — 취소·환불 미차감 */
  lifetimeDistribution: Array<{ bucket: string; count: number }>;
  /** agg_membership_daily 스냅샷 (status=ACTIVE). 스냅샷 크론 가동 이후 날짜만 존재한다. */
  membershipTrend: Array<{ aggDate: string; tierId: string; membersCount: number }>;
  cancellationReasons: Array<{ reasonCode: string; count: number }>;
  /** 시점 조인(fact ⋈ dim SCD2) — 주문 발생 시각의 등급으로 귀속. 총매출 기준. */
  tierRevenue: Array<{
    tierId: string;
    grossRevenue: number;
    ordersCount: number;
    customersCount: number;
    avgOrderValue: number | null;
  }>;
}

export interface StatisticsOverview {
  today: { date: string } & RevenueTotals & { avgOrderValue: number | null };
  yesterday: { date: string } & RevenueTotals & { avgOrderValue: number | null };
  /** 최근 스냅샷 기준 활성 멤버십 회원 수. 스냅샷이 아직 없으면 null. */
  activeMembers: number | null;
  activeMembersAsOf: string | null;
}

const LIFETIME_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: '1만원 미만', min: 0, max: 10_000 },
  { label: '1~5만원', min: 10_000, max: 50_000 },
  { label: '5~10만원', min: 50_000, max: 100_000 },
  { label: '10~30만원', min: 100_000, max: 300_000 },
  { label: '30~50만원', min: 300_000, max: 500_000 },
  { label: '50~100만원', min: 500_000, max: 1_000_000 },
  { label: '100만원 이상', min: 1_000_000, max: null },
];

@Injectable()
export class StatisticsQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getSales(
    from: string,
    to: string,
    channel?: string,
    granularity: Granularity = 'day',
  ): Promise<SalesStatistics> {
    this.assertRange(from, to);
    const prev = previousRange(from, to);

    const [kpis, previousKpis, series, channels, cancelReasons] = await Promise.all([
      this.channelTotals(from, to, channel),
      this.channelTotals(prev.from, prev.to, channel),
      this.channelSeries(from, to, channel, granularity),
      this.channelBreakdown(from, to, channel),
      this.cancelReasonDistribution(from, to),
    ]);

    return {
      range: { from, to },
      previousRange: prev,
      kpis: withDerivedKpis(kpis),
      previousKpis: withDerivedKpis(previousKpis),
      series,
      channels,
      cancelReasons,
    };
  }

  async getProducts(
    from: string,
    to: string,
    channel?: string,
    sort: 'revenue' | 'quantity' | 'orders' = 'revenue',
    limit = 20,
  ): Promise<ProductStatistics> {
    this.assertRange(from, to);
    const prev = previousRange(from, to);
    const where = this.productRangeWhere(from, to, channel);

    const sortExpr =
      sort === 'quantity'
        ? sql`SUM(${aggProductOrderDaily.quantitySold})`
        : sort === 'orders'
          ? sql`SUM(${aggProductOrderDaily.ordersCount})`
          : sql`SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount})`;

    const rankingRows = await this.db
      .select({
        masterId: aggProductOrderDaily.masterId,
        name: dimProductMasters.name,
        ordersCount: sql<string>`SUM(${aggProductOrderDaily.ordersCount})`,
        quantitySold: sql<string>`SUM(${aggProductOrderDaily.quantitySold})`,
        grossRevenue: sql<string>`SUM(${aggProductOrderDaily.grossRevenue})`,
        cancelledAmount: sql<string>`SUM(${aggProductOrderDaily.cancelledAmount})`,
        refundedAmount: sql<string>`SUM(${aggProductOrderDaily.refundedAmount})`,
      })
      .from(aggProductOrderDaily)
      .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggProductOrderDaily.masterId))
      .where(where)
      .groupBy(aggProductOrderDaily.masterId, dimProductMasters.name)
      .orderBy(sql`${sortExpr} DESC`)
      .limit(limit);

    const masterIds = rankingRows.map((row) => row.masterId);
    const previousByMaster = new Map<string, number>();
    if (masterIds.length > 0) {
      const prevRows = await this.db
        .select({
          masterId: aggProductOrderDaily.masterId,
          netRevenue: sql<string>`SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount})`,
        })
        .from(aggProductOrderDaily)
        .where(and(this.productRangeWhere(prev.from, prev.to, channel), inArray(aggProductOrderDaily.masterId, masterIds)))
        .groupBy(aggProductOrderDaily.masterId);
      for (const row of prevRows) {
        previousByMaster.set(row.masterId, Number(row.netRevenue ?? 0));
      }
    }

    const ranking: ProductRankingRow[] = rankingRows.map((row) => {
      const grossRevenue = Number(row.grossRevenue ?? 0);
      const cancelledAmount = Number(row.cancelledAmount ?? 0);
      const refundedAmount = Number(row.refundedAmount ?? 0);
      return {
        masterId: row.masterId,
        name: row.name ?? null,
        ordersCount: Number(row.ordersCount ?? 0),
        quantitySold: Number(row.quantitySold ?? 0),
        grossRevenue,
        cancelledAmount,
        refundedAmount,
        netRevenue: grossRevenue - cancelledAmount - refundedAmount,
        previousNetRevenue: previousByMaster.get(row.masterId) ?? 0,
      };
    });

    const categoryRows = await this.db
      .select({
        categoryId: dimProductCategories.categoryId,
        grossRevenue: sql<string>`SUM(${aggProductOrderDaily.grossRevenue})`,
        quantitySold: sql<string>`SUM(${aggProductOrderDaily.quantitySold})`,
      })
      .from(aggProductOrderDaily)
      .innerJoin(
        dimProductCategories,
        and(
          eq(dimProductCategories.masterId, aggProductOrderDaily.masterId),
          eq(dimProductCategories.isPrimary, true),
        ),
      )
      .where(where)
      .groupBy(dimProductCategories.categoryId)
      .orderBy(sql`SUM(${aggProductOrderDaily.grossRevenue}) DESC`);

    const variantWhereParts: SQL[] = [
      gte(aggVariantOrderDaily.aggDate, from),
      lte(aggVariantOrderDaily.aggDate, to),
    ];
    if (channel) {
      variantWhereParts.push(eq(aggVariantOrderDaily.salesChannel, channel));
    }
    const variantRows = await this.db
      .select({
        variantId: aggVariantOrderDaily.variantId,
        variantName: dimProductVariants.variantName,
        masterId: aggVariantOrderDaily.masterId,
        masterName: dimProductMasters.name,
        quantitySold: sql<string>`SUM(${aggVariantOrderDaily.quantitySold})`,
        grossRevenue: sql<string>`SUM(${aggVariantOrderDaily.grossRevenue})`,
      })
      .from(aggVariantOrderDaily)
      .leftJoin(dimProductVariants, eq(dimProductVariants.variantId, aggVariantOrderDaily.variantId))
      .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggVariantOrderDaily.masterId))
      .where(and(...variantWhereParts))
      .groupBy(
        aggVariantOrderDaily.variantId,
        dimProductVariants.variantName,
        aggVariantOrderDaily.masterId,
        dimProductMasters.name,
      )
      .orderBy(sql`SUM(${aggVariantOrderDaily.grossRevenue}) DESC`)
      .limit(limit);

    return {
      range: { from, to },
      previousRange: prev,
      ranking,
      categories: categoryRows.map((row) => ({
        categoryId: row.categoryId,
        grossRevenue: Number(row.grossRevenue ?? 0),
        quantitySold: Number(row.quantitySold ?? 0),
      })),
      variants: variantRows.map((row) => ({
        variantId: row.variantId,
        variantName: row.variantName ?? null,
        masterId: row.masterId,
        masterName: row.masterName ?? null,
        quantitySold: Number(row.quantitySold ?? 0),
        grossRevenue: Number(row.grossRevenue ?? 0),
      })),
    };
  }

  async getCustomers(from: string, to: string, granularity: Granularity = 'day'): Promise<CustomerStatistics> {
    this.assertRange(from, to);
    const fromInstant = seoulDayStart(from);
    const toExclusive = seoulDayStart(nextDay(to));

    const [lifetimeRows, newCustomerRows, distributionRows, trendRows, reasonRows, tierRows] = await Promise.all([
      this.db
        .select({
          customersTotal: sql<string>`COUNT(*)`,
          repeatCustomers: sql<string>`COUNT(*) FILTER (WHERE ${aggCustomerLifetime.ordersCount} >= 2)`,
          ordersTotal: sql<string>`COALESCE(SUM(${aggCustomerLifetime.ordersCount}), 0)`,
          totalRevenue: sql<string>`COALESCE(SUM(${aggCustomerLifetime.totalRevenue}), 0)`,
        })
        .from(aggCustomerLifetime),
      this.db
        .select({
          bucket: sql<string>`to_char(${aggCustomerLifetime.firstOrderAt} AT TIME ZONE ${SEOUL_TZ}, ${bucketFormat(granularity)})`,
          count: sql<string>`COUNT(*)`,
        })
        .from(aggCustomerLifetime)
        .where(and(gte(aggCustomerLifetime.firstOrderAt, fromInstant), lt(aggCustomerLifetime.firstOrderAt, toExclusive)))
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      this.db
        .select({
          bucket: sql<string>`${lifetimeBucketCase()}`,
          count: sql<string>`COUNT(*)`,
        })
        .from(aggCustomerLifetime)
        .groupBy(sql`1`),
      this.db
        .select({
          aggDate: aggMembershipDaily.aggDate,
          tierId: aggMembershipDaily.tierId,
          membersCount: aggMembershipDaily.membersCount,
        })
        .from(aggMembershipDaily)
        .where(
          and(
            gte(aggMembershipDaily.aggDate, from),
            lte(aggMembershipDaily.aggDate, to),
            eq(aggMembershipDaily.status, 'ACTIVE'),
          ),
        )
        .orderBy(aggMembershipDaily.aggDate),
      this.db
        .select({
          reasonCode: sql<string>`COALESCE(${factMembershipEvents.reasonCode}, 'UNKNOWN')`,
          count: sql<string>`COUNT(*)`,
        })
        .from(factMembershipEvents)
        .where(
          and(
            gte(factMembershipEvents.occurredAt, fromInstant),
            lt(factMembershipEvents.occurredAt, toExclusive),
            inArray(factMembershipEvents.status, ['CANCELLED', 'RECURRING_CANCELLED']),
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`COUNT(*) DESC`),
      this.db
        .select({
          tierId: sql<string>`CASE WHEN ${factOrderItems.customerId} IS NULL THEN 'GUEST' ELSE COALESCE(${dimCustomerMembership.tierId}, 'NON_MEMBER') END`,
          grossRevenue: sql<string>`COALESCE(SUM(${factOrderItems.totalPrice}), 0)`,
          ordersCount: sql<string>`COUNT(DISTINCT ${factOrderItems.orderKey})`,
          customersCount: sql<string>`COUNT(DISTINCT ${factOrderItems.customerId})`,
        })
        .from(factOrderItems)
        .leftJoin(
          dimCustomerMembership,
          and(
            eq(dimCustomerMembership.userId, factOrderItems.customerId),
            lte(dimCustomerMembership.validFrom, factOrderItems.occurredAt),
            or(isNull(dimCustomerMembership.validTo), gt(dimCustomerMembership.validTo, factOrderItems.occurredAt)),
          ),
        )
        .where(and(gte(factOrderItems.occurredAt, fromInstant), lt(factOrderItems.occurredAt, toExclusive)))
        .groupBy(sql`1`)
        .orderBy(sql`COALESCE(SUM(${factOrderItems.totalPrice}), 0) DESC`),
    ]);

    const lifetime = lifetimeRows[0];
    const customersTotal = Number(lifetime?.customersTotal ?? 0);
    const repeatCustomers = Number(lifetime?.repeatCustomers ?? 0);
    const totalRevenue = Number(lifetime?.totalRevenue ?? 0);

    // 히스토그램은 버킷 정의 순서로 정렬해 내려준다 — 문자열 정렬로는 금액 순서가 나오지 않는다.
    const distributionByLabel = new Map(distributionRows.map((row) => [row.bucket, Number(row.count ?? 0)]));

    return {
      range: { from, to },
      lifetime: {
        customersTotal,
        repeatCustomers,
        repurchaseRate: customersTotal > 0 ? repeatCustomers / customersTotal : null,
        ordersTotal: Number(lifetime?.ordersTotal ?? 0),
        totalRevenue,
        avgRevenuePerCustomer: customersTotal > 0 ? totalRevenue / customersTotal : null,
      },
      newCustomers: newCustomerRows.map((row) => ({ bucket: row.bucket, count: Number(row.count ?? 0) })),
      lifetimeDistribution: LIFETIME_BUCKETS.map((bucket) => ({
        bucket: bucket.label,
        count: distributionByLabel.get(bucket.label) ?? 0,
      })),
      membershipTrend: trendRows.map((row) => ({
        aggDate: String(row.aggDate),
        tierId: row.tierId,
        membersCount: row.membersCount,
      })),
      cancellationReasons: reasonRows.map((row) => ({ reasonCode: row.reasonCode, count: Number(row.count ?? 0) })),
      tierRevenue: tierRows.map((row) => {
        const grossRevenue = Number(row.grossRevenue ?? 0);
        const ordersCount = Number(row.ordersCount ?? 0);
        return {
          tierId: row.tierId,
          grossRevenue,
          ordersCount,
          customersCount: Number(row.customersCount ?? 0),
          avgOrderValue: ordersCount > 0 ? grossRevenue / ordersCount : null,
        };
      }),
    };
  }

  /** 대시보드 홈 요약 — 오늘/어제(KST) 매출과 최근 스냅샷의 활성 멤버십 수. */
  async getOverview(): Promise<StatisticsOverview> {
    const today = toSeoulDateOnly(new Date());
    const yesterday = previousRange(today, today).from;

    const [todayTotals, yesterdayTotals, latestSnapshotRows] = await Promise.all([
      this.channelTotals(today, today),
      this.channelTotals(yesterday, yesterday),
      this.db
        .select({
          aggDate: aggMembershipDaily.aggDate,
          membersCount: sql<string>`SUM(${aggMembershipDaily.membersCount})`,
        })
        .from(aggMembershipDaily)
        .where(eq(aggMembershipDaily.status, 'ACTIVE'))
        .groupBy(aggMembershipDaily.aggDate)
        .orderBy(desc(aggMembershipDaily.aggDate))
        .limit(1),
    ]);

    const snapshot = latestSnapshotRows[0];
    return {
      today: { date: today, ...todayTotals, avgOrderValue: avgOrderValue(todayTotals) },
      yesterday: { date: yesterday, ...yesterdayTotals, avgOrderValue: avgOrderValue(yesterdayTotals) },
      activeMembers: snapshot ? Number(snapshot.membersCount ?? 0) : null,
      activeMembersAsOf: snapshot ? String(snapshot.aggDate) : null,
    };
  }

  private assertRange(from: string, to: string): void {
    if (from > to) {
      throw new BadRequestError(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
    }
  }

  private channelRangeWhere(from: string, to: string, channel?: string): SQL | undefined {
    const parts: SQL[] = [gte(aggChannelDaily.aggDate, from), lte(aggChannelDaily.aggDate, to)];
    if (channel) {
      parts.push(eq(aggChannelDaily.salesChannel, channel));
    }
    return and(...parts);
  }

  private productRangeWhere(from: string, to: string, channel?: string): SQL | undefined {
    const parts: SQL[] = [gte(aggProductOrderDaily.aggDate, from), lte(aggProductOrderDaily.aggDate, to)];
    if (channel) {
      parts.push(eq(aggProductOrderDaily.salesChannel, channel));
    }
    return and(...parts);
  }

  private async channelTotals(from: string, to: string, channel?: string): Promise<RevenueTotals> {
    const rows = await this.db
      .select({
        grossRevenue: sql<string>`COALESCE(SUM(${aggChannelDaily.grossRevenue}), 0)`,
        cancelledAmount: sql<string>`COALESCE(SUM(${aggChannelDaily.cancelledAmount}), 0)`,
        refundedAmount: sql<string>`COALESCE(SUM(${aggChannelDaily.refundedAmount}), 0)`,
        ordersCount: sql<string>`COALESCE(SUM(${aggChannelDaily.ordersCount}), 0)`,
      })
      .from(aggChannelDaily)
      .where(this.channelRangeWhere(from, to, channel));
    return toRevenueTotals(rows[0]);
  }

  private async channelSeries(
    from: string,
    to: string,
    channel: string | undefined,
    granularity: Granularity,
  ): Promise<Array<{ bucket: string } & RevenueTotals>> {
    const bucketExpr =
      granularity === 'day'
        ? sql<string>`${aggChannelDaily.aggDate}::text`
        : sql<string>`to_char(${aggChannelDaily.aggDate}, ${bucketFormat(granularity)})`;

    const rows = await this.db
      .select({
        bucket: bucketExpr,
        grossRevenue: sql<string>`SUM(${aggChannelDaily.grossRevenue})`,
        cancelledAmount: sql<string>`SUM(${aggChannelDaily.cancelledAmount})`,
        refundedAmount: sql<string>`SUM(${aggChannelDaily.refundedAmount})`,
        ordersCount: sql<string>`SUM(${aggChannelDaily.ordersCount})`,
      })
      .from(aggChannelDaily)
      .where(this.channelRangeWhere(from, to, channel))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows.map((row) => ({ bucket: row.bucket, ...toRevenueTotals(row) }));
  }

  private async channelBreakdown(
    from: string,
    to: string,
    channel?: string,
  ): Promise<Array<{ salesChannel: string } & RevenueTotals>> {
    const rows = await this.db
      .select({
        salesChannel: aggChannelDaily.salesChannel,
        grossRevenue: sql<string>`SUM(${aggChannelDaily.grossRevenue})`,
        cancelledAmount: sql<string>`SUM(${aggChannelDaily.cancelledAmount})`,
        refundedAmount: sql<string>`SUM(${aggChannelDaily.refundedAmount})`,
        ordersCount: sql<string>`SUM(${aggChannelDaily.ordersCount})`,
      })
      .from(aggChannelDaily)
      .where(this.channelRangeWhere(from, to, channel))
      .groupBy(aggChannelDaily.salesChannel)
      .orderBy(sql`SUM(${aggChannelDaily.grossRevenue}) DESC`);

    return rows.map((row) => ({ salesChannel: row.salesChannel, ...toRevenueTotals(row) }));
  }

  /**
   * 취소 사유 분포 — fact 스캔. 취소 봉투에는 salesChannel 이 실리지 않아 채널 필터가 없다.
   * OrderCancelled payload 의 `reason` 을 그대로 센다 (없으면 UNKNOWN).
   */
  private async cancelReasonDistribution(from: string, to: string): Promise<Array<{ reason: string; count: number }>> {
    const fromInstant = seoulDayStart(from);
    const toExclusive = seoulDayStart(nextDay(to));
    const { factOrderEvents } = analyticsSchema;

    const rows = await this.db
      .select({
        reason: sql<string>`COALESCE(${factOrderEvents.payload} ->> 'reason', 'UNKNOWN')`,
        count: sql<string>`COUNT(*)`,
      })
      .from(factOrderEvents)
      .where(
        and(
          eq(factOrderEvents.messageType, 'OrderCancelled'),
          gte(factOrderEvents.occurredAt, fromInstant),
          lt(factOrderEvents.occurredAt, toExclusive),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`COUNT(*) DESC`);

    return rows.map((row) => ({ reason: row.reason, count: Number(row.count ?? 0) }));
  }
}

function toRevenueTotals(row?: {
  grossRevenue: string | number | null;
  cancelledAmount: string | number | null;
  refundedAmount: string | number | null;
  ordersCount: string | number | null;
}): RevenueTotals {
  const grossRevenue = Number(row?.grossRevenue ?? 0);
  const cancelledAmount = Number(row?.cancelledAmount ?? 0);
  const refundedAmount = Number(row?.refundedAmount ?? 0);
  return {
    grossRevenue,
    cancelledAmount,
    refundedAmount,
    netRevenue: grossRevenue - cancelledAmount - refundedAmount,
    ordersCount: Number(row?.ordersCount ?? 0),
  };
}

function avgOrderValue(totals: RevenueTotals): number | null {
  return totals.ordersCount > 0 ? totals.netRevenue / totals.ordersCount : null;
}

function withDerivedKpis(totals: RevenueTotals): SalesKpis {
  return {
    ...totals,
    avgOrderValue: avgOrderValue(totals),
    cancelRefundRate:
      totals.grossRevenue > 0 ? (totals.cancelledAmount + totals.refundedAmount) / totals.grossRevenue : null,
  };
}

/** 누적 구매액 히스토그램 버킷 CASE — LIFETIME_BUCKETS 정의와 1:1 이어야 한다. */
function lifetimeBucketCase(): SQL<string> {
  const chunks = LIFETIME_BUCKETS.map((bucket) =>
    bucket.max === null
      ? sql`WHEN ${aggCustomerLifetime.totalRevenue} >= ${bucket.min} THEN ${bucket.label}`
      : sql`WHEN ${aggCustomerLifetime.totalRevenue} >= ${bucket.min} AND ${aggCustomerLifetime.totalRevenue} < ${bucket.max} THEN ${bucket.label}`,
  );
  return sql<string>`CASE ${sql.join(chunks, sql` `)} ELSE 'UNKNOWN' END`;
}

function bucketFormat(granularity: Granularity): string {
  return granularity === 'year' ? 'YYYY' : granularity === 'month' ? 'YYYY-MM' : 'YYYY-MM-DD';
}

/** 날짜 문자열 산술은 KST 오프셋과 무관하다 — 달력 날짜끼리의 덧뺄셈은 UTC 기준으로 해도 같다. */
function addDays(dateOnly: string, days: number): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function nextDay(dateOnly: string): string {
  return addDays(dateOnly, 1);
}

/** 직전 동일 길이 기간 — [from-len, from-1] */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const lengthDays =
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from: addDays(from, -lengthDays), to: addDays(from, -1) };
}
