import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, desc, eq, gte, inArray, isNull, lt, ne, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  aggCustomerLifetime,
  aggUserProductPurchase,
  analyticsSchema,
  dimCustomerMembership,
  dimProductMasters,
  factOrderItems,
} from '../../../schema';
import { SEOUL_TZ, seoulDayStart } from '../../../shared/date.util';

/** 코호트 매트릭스가 다루는 개월 수 — 코호트 12개 × 경과 최대 +11개월. */
export const COHORT_MONTHS = 12;

export interface CohortRow {
  /** 첫 주문 월 (KST, YYYY-MM) */
  cohortMonth: string;
  size: number;
  /** 경과 개월별 재구매 고객 비율. 아직 오지 않은 달은 null. [0]은 정의상 1에 가깝다. */
  retention: Array<number | null>;
}

export interface RfmCell {
  recency: string;
  frequency: string;
  customers: number;
  totalRevenue: number;
}

export interface RfmSegment {
  key: string;
  label: string;
  customers: number;
}

export interface RepurchaseItem {
  masterId: string;
  name: string | null;
  buyers: number;
  repeatBuyers: number;
  repurchaseRate: number;
  /** 재구매 고객의 (마지막-첫 구매)/(구매횟수-1) 평균 일수. 재구매자가 없으면 null. */
  avgCycleDays: number | null;
}

export interface CustomerInsights {
  range: { from: string; to: string };
  /** to 가 속한 달을 끝으로 하는 최근 12개월 첫구매 코호트 — from 과 무관하다. */
  cohorts: { rows: CohortRow[]; maxOffset: number };
  /** 전 고객 기준 (기간 필터 무관) — R=마지막 주문 경과, F=주문수, M=누적 총매출. */
  rfm: {
    recencyBuckets: string[];
    frequencyBuckets: string[];
    cells: RfmCell[];
    segments: RfmSegment[];
    totalCustomers: number;
  };
  /** 전 기간 누적 상품별 재구매 (agg_user_product_purchase) — 기간 필터 무관. */
  repurchase: { minBuyers: number; items: RepurchaseItem[] };
  /** 기간 내 등급 전환 + 현재 등급 분포. 실시간 수집 이전 이력은 없어 과거는 과소집계다. */
  tierFlow: {
    transitions: Array<{ fromTier: string; toTier: string; count: number }>;
    currentDistribution: Array<{ tierId: string; count: number }>;
  };
}

export const RECENCY_BUCKETS: Array<{ label: string; maxDays: number | null }> = [
  { label: '30일 이내', maxDays: 30 },
  { label: '31~90일', maxDays: 90 },
  { label: '91~180일', maxDays: 180 },
  { label: '181~365일', maxDays: 365 },
  { label: '1년 이상', maxDays: null },
];

export const FREQUENCY_BUCKETS: Array<{ label: string; min: number; max: number | null }> = [
  { label: '1회', min: 1, max: 1 },
  { label: '2~3회', min: 2, max: 3 },
  { label: '4~9회', min: 4, max: 9 },
  { label: '10회 이상', min: 10, max: null },
];

const SEGMENT_LABELS: Record<string, string> = {
  vip: 'VIP',
  loyal: '단골',
  new: '신규',
  'one-time': '1회 구매 후 무소식',
  'at-risk': '이탈 위험',
  dormant: '휴면',
};

/**
 * R×F 셀 → 세그먼트. 모든 셀이 정확히 하나의 세그먼트에 속한다 (합 = 전체 고객).
 * M(금액)은 세그먼트 판정에 쓰지 않는다 — 축이 셋이면 표로 보여줄 수 없다.
 */
export function segmentOf(recencyIndex: number, frequencyIndex: number): string {
  if (recencyIndex >= 4) return 'dormant';
  if (recencyIndex <= 1) {
    if (frequencyIndex >= 2) return 'vip';
    if (frequencyIndex === 1) return 'loyal';
    return recencyIndex === 0 ? 'new' : 'one-time';
  }
  return frequencyIndex === 0 ? 'one-time' : 'at-risk';
}

/** 'YYYY-MM' 두 달 사이의 개월 차. */
export function monthDiff(fromMonth: string, toMonth: string): number {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** 'YYYY-MM' 에 개월을 더한다. */
export function addMonths(month: string, months: number): string {
  const [year, monthNum] = month.split('-').map(Number);
  const total = year * 12 + (monthNum - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * (코호트월, 활동월, 고객수) 행들을 코호트 매트릭스로 만든다.
 * 활동이 없는 (코호트, 경과월) 칸은 0, endMonth 이후의 칸은 null.
 */
export function buildCohortMatrix(
  sizes: Array<{ cohortMonth: string; size: number }>,
  activity: Array<{ cohortMonth: string; activeMonth: string; customers: number }>,
  endMonth: string,
): CohortRow[] {
  const activeByKey = new Map<string, number>();
  for (const row of activity) {
    activeByKey.set(`${row.cohortMonth}|${row.activeMonth}`, row.customers);
  }
  return sizes
    .slice()
    .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth))
    .map(({ cohortMonth, size }) => {
      const retention: Array<number | null> = [];
      for (let offset = 0; offset < COHORT_MONTHS; offset += 1) {
        const activeMonth = addMonths(cohortMonth, offset);
        if (activeMonth > endMonth) {
          retention.push(null);
          continue;
        }
        const active = activeByKey.get(`${cohortMonth}|${activeMonth}`) ?? 0;
        retention.push(size > 0 ? active / size : null);
      }
      return { cohortMonth, size, retention };
    });
}

export function buildSegments(cells: RfmCell[]): RfmSegment[] {
  const byKey = new Map<string, number>();
  for (const cell of cells) {
    const recencyIndex = RECENCY_BUCKETS.findIndex((bucket) => bucket.label === cell.recency);
    const frequencyIndex = FREQUENCY_BUCKETS.findIndex((bucket) => bucket.label === cell.frequency);
    if (recencyIndex < 0 || frequencyIndex < 0) continue;
    const key = segmentOf(recencyIndex, frequencyIndex);
    byKey.set(key, (byKey.get(key) ?? 0) + cell.customers);
  }
  return Object.keys(SEGMENT_LABELS).map((key) => ({
    key,
    label: SEGMENT_LABELS[key],
    customers: byKey.get(key) ?? 0,
  }));
}

@Injectable()
export class CustomerInsightsQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getInsights(from: string, to: string, limit = 20, minBuyers = 5): Promise<CustomerInsights> {
    if (from > to) {
      throw new BadRequestError(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
    }

    const [cohorts, rfm, repurchase, tierFlow] = await Promise.all([
      this.cohortRetention(to),
      this.rfmDistribution(),
      this.productRepurchase(limit, minBuyers),
      this.tierTransitions(from, to),
    ]);

    return { range: { from, to }, cohorts, rfm, repurchase, tierFlow };
  }

  /** to 가 속한 달을 마지막으로 하는 최근 12개월 코호트. */
  private async cohortRetention(to: string): Promise<{ rows: CohortRow[]; maxOffset: number }> {
    const endMonth = to.slice(0, 7);
    const startMonth = addMonths(endMonth, -(COHORT_MONTHS - 1));
    const windowStart = seoulDayStart(`${startMonth}-01`);
    const windowEnd = seoulDayStart(`${addMonths(endMonth, 1)}-01`);

    const cohortMonthExpr = sql<string>`to_char(${aggCustomerLifetime.firstOrderAt} AT TIME ZONE ${SEOUL_TZ}, 'YYYY-MM')`;
    const cohortWhere = and(
      gte(aggCustomerLifetime.firstOrderAt, windowStart),
      lt(aggCustomerLifetime.firstOrderAt, windowEnd),
    );

    const [sizeRows, activityRows] = await Promise.all([
      this.db
        .select({ cohortMonth: cohortMonthExpr, size: sql<string>`COUNT(*)` })
        .from(aggCustomerLifetime)
        .where(cohortWhere)
        .groupBy(sql`1`),
      this.db
        .select({
          cohortMonth: cohortMonthExpr,
          activeMonth: sql<string>`to_char(${factOrderItems.occurredAt} AT TIME ZONE ${SEOUL_TZ}, 'YYYY-MM')`,
          customers: sql<string>`COUNT(DISTINCT ${factOrderItems.customerId})`,
        })
        .from(factOrderItems)
        .innerJoin(aggCustomerLifetime, eq(aggCustomerLifetime.customerId, factOrderItems.customerId))
        .where(and(cohortWhere, gte(factOrderItems.occurredAt, windowStart), lt(factOrderItems.occurredAt, windowEnd)))
        .groupBy(sql`1`, sql`2`),
    ]);

    const rows = buildCohortMatrix(
      sizeRows.map((row) => ({ cohortMonth: row.cohortMonth, size: Number(row.size ?? 0) })),
      activityRows.map((row) => ({
        cohortMonth: row.cohortMonth,
        activeMonth: row.activeMonth,
        customers: Number(row.customers ?? 0),
      })),
      endMonth,
    );
    return { rows, maxOffset: COHORT_MONTHS - 1 };
  }

  private async rfmDistribution(): Promise<CustomerInsights['rfm']> {
    const rows = await this.db
      .select({
        recency: sql<string>`${recencyBucketCase()}`,
        frequency: sql<string>`${frequencyBucketCase()}`,
        customers: sql<string>`COUNT(*)`,
        totalRevenue: sql<string>`COALESCE(SUM(${aggCustomerLifetime.totalRevenue}), 0)`,
      })
      .from(aggCustomerLifetime)
      .where(sql`${aggCustomerLifetime.lastOrderAt} IS NOT NULL`)
      .groupBy(sql`1`, sql`2`);

    const cells: RfmCell[] = rows.map((row) => ({
      recency: row.recency,
      frequency: row.frequency,
      customers: Number(row.customers ?? 0),
      totalRevenue: Number(row.totalRevenue ?? 0),
    }));

    return {
      recencyBuckets: RECENCY_BUCKETS.map((bucket) => bucket.label),
      frequencyBuckets: FREQUENCY_BUCKETS.map((bucket) => bucket.label),
      cells,
      segments: buildSegments(cells),
      totalCustomers: cells.reduce((sum, cell) => sum + cell.customers, 0),
    };
  }

  private async productRepurchase(limit: number, minBuyers: number): Promise<CustomerInsights['repurchase']> {
    const buyersExpr = sql`COUNT(*)`;
    const repeatExpr = sql`COUNT(*) FILTER (WHERE ${aggUserProductPurchase.purchaseCount} >= 2)`;
    const rows = await this.db
      .select({
        masterId: aggUserProductPurchase.masterId,
        name: dimProductMasters.name,
        buyers: sql<string>`${buyersExpr}`,
        repeatBuyers: sql<string>`${repeatExpr}`,
        avgCycleDays: sql<string | null>`AVG(
          EXTRACT(EPOCH FROM (${aggUserProductPurchase.lastPurchasedAt} - ${aggUserProductPurchase.firstPurchasedAt}))
            / 86400.0 / (${aggUserProductPurchase.purchaseCount} - 1)
        ) FILTER (WHERE ${aggUserProductPurchase.purchaseCount} >= 2
          AND ${aggUserProductPurchase.lastPurchasedAt} > ${aggUserProductPurchase.firstPurchasedAt})`,
      })
      .from(aggUserProductPurchase)
      .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggUserProductPurchase.masterId))
      .groupBy(aggUserProductPurchase.masterId, dimProductMasters.name)
      .having(sql`${buyersExpr} >= ${minBuyers}`)
      .orderBy(sql`${repeatExpr}::float / ${buyersExpr} DESC`, sql`${buyersExpr} DESC`)
      .limit(limit);

    const namelessMasterIds = rows.filter((row) => !row.name).map((row) => row.masterId);
    const fallbackNames = await this.latestOrderedProductNames(namelessMasterIds);

    return {
      minBuyers,
      items: rows.map((row) => {
        const buyers = Number(row.buyers ?? 0);
        const repeatBuyers = Number(row.repeatBuyers ?? 0);
        return {
          masterId: row.masterId,
          name: row.name ?? fallbackNames.get(row.masterId) ?? null,
          buyers,
          repeatBuyers,
          repurchaseRate: buyers > 0 ? repeatBuyers / buyers : 0,
          avgCycleDays: row.avgCycleDays == null ? null : Number(row.avgCycleDays),
        };
      }),
    };
  }

  private async tierTransitions(from: string, to: string): Promise<CustomerInsights['tierFlow']> {
    const fromInstant = seoulDayStart(from);
    const toExclusive = seoulDayStart(nextDay(to));
    const previousMembership = alias(dimCustomerMembership, 'previous_membership');

    const [transitionRows, currentRows] = await Promise.all([
      this.db
        .select({
          fromTier: previousMembership.tierId,
          toTier: dimCustomerMembership.tierId,
          count: sql<string>`COUNT(*)`,
        })
        .from(dimCustomerMembership)
        .innerJoin(
          previousMembership,
          and(
            eq(previousMembership.userId, dimCustomerMembership.userId),
            eq(previousMembership.validTo, dimCustomerMembership.validFrom),
          ),
        )
        .where(
          and(
            gte(dimCustomerMembership.validFrom, fromInstant),
            lt(dimCustomerMembership.validFrom, toExclusive),
            ne(previousMembership.tierId, dimCustomerMembership.tierId),
          ),
        )
        .groupBy(previousMembership.tierId, dimCustomerMembership.tierId)
        .orderBy(sql`COUNT(*) DESC`),
      this.db
        .select({ tierId: dimCustomerMembership.tierId, count: sql<string>`COUNT(*)` })
        .from(dimCustomerMembership)
        .where(isNull(dimCustomerMembership.validTo))
        .groupBy(dimCustomerMembership.tierId)
        .orderBy(sql`COUNT(*) DESC`),
    ]);

    return {
      transitions: transitionRows.map((row) => ({
        fromTier: row.fromTier,
        toTier: row.toTier,
        count: Number(row.count ?? 0),
      })),
      currentDistribution: currentRows.map((row) => ({ tierId: row.tierId, count: Number(row.count ?? 0) })),
    };
  }

  /** masterId 별 최근 주문 라인의 상품명 — statistics.query 와 같은 폴백. */
  private async latestOrderedProductNames(masterIds: string[]): Promise<Map<string, string>> {
    if (masterIds.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([factOrderItems.masterId], {
        masterId: factOrderItems.masterId,
        productName: factOrderItems.productName,
      })
      .from(factOrderItems)
      .where(and(inArray(factOrderItems.masterId, masterIds), sql`${factOrderItems.productName} IS NOT NULL`))
      .orderBy(factOrderItems.masterId, desc(factOrderItems.occurredAt));
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.productName) map.set(row.masterId, row.productName);
    }
    return map;
  }
}

function recencyBucketCase(): SQL<string> {
  const days = sql`EXTRACT(EPOCH FROM (now() - ${aggCustomerLifetime.lastOrderAt})) / 86400.0`;
  const chunks = RECENCY_BUCKETS.map((bucket) =>
    bucket.maxDays === null
      ? sql`ELSE ${bucket.label}`
      : sql`WHEN ${days} <= ${bucket.maxDays} THEN ${bucket.label}`,
  );
  return sql<string>`CASE ${sql.join(chunks, sql` `)} END`;
}

function frequencyBucketCase(): SQL<string> {
  const chunks = FREQUENCY_BUCKETS.map((bucket) =>
    bucket.max === null
      ? sql`ELSE ${bucket.label}`
      : sql`WHEN ${aggCustomerLifetime.ordersCount} <= ${bucket.max} THEN ${bucket.label}`,
  );
  return sql<string>`CASE ${sql.join(chunks, sql` `)} END`;
}

function nextDay(dateOnly: string): string {
  const base = new Date(`${dateOnly}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + 1);
  return base.toISOString().slice(0, 10);
}
