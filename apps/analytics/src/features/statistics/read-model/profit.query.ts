import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, eq, gte, inArray, lte, sql, SQL } from 'drizzle-orm';
import { aggProductOrderDaily, analyticsSchema, dimProductMasters, factOrderItems } from '../../../schema';

export type ProfitSort = 'revenue' | 'margin' | 'marginRate' | 'quantity';

/**
 * 기간 전사 이익 요약. 원가가 있는 상품(computed)과 없는 상품(uncomputed)을 항상 분리해
 * 내려준다 — 없는 쪽을 0 으로 뭉개면 이익이 과대/과소로 보이기 때문.
 */
export interface ProfitTotals {
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  netRevenue: number;
  quantitySold: number;
  productsCount: number;
  /** 원가가 입력된 상품들의 순매출 합 — 마진 계산의 분모 */
  computedNetRevenue: number;
  /** 원가 추정치 합 (판매수량×공급가를 순매출 비율로 보정) */
  estimatedCost: number;
  /** computedNetRevenue - estimatedCost */
  estimatedMargin: number;
  /** estimatedMargin / computedNetRevenue. 분모 0 이하이면 null. */
  marginRate: number | null;
  /** 원가 미입력 상품들의 순매출 합 — "계산 불가" 몫 */
  uncomputedNetRevenue: number;
  uncomputedProductsCount: number;
  /** computedNetRevenue / netRevenue. 분모 0 이하이면 null. */
  costCoverageRate: number | null;
}

export interface ProfitProductRow {
  masterId: string;
  name: string | null;
  quantitySold: number;
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  netRevenue: number;
  /** null = 원가 미입력 → 아래 세 값도 전부 null ("계산 불가") */
  supplyPrice: number | null;
  estimatedCost: number | null;
  estimatedMargin: number | null;
  marginRate: number | null;
}

export interface ProfitSeriesPoint {
  bucket: string;
  netRevenue: number;
  computedNetRevenue: number;
  estimatedCost: number;
  estimatedMargin: number;
}

export interface ProfitStatistics {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  totals: ProfitTotals;
  previousTotals: ProfitTotals;
  series: ProfitSeriesPoint[];
  items: ProfitProductRow[];
  page: number;
  limit: number;
  totalItems: number;
}

/**
 * 원가 추정: 판매수량 × 공급가에 순매출/총매출 비율(0~1 클램프)을 곱한다.
 * 취소·환불은 금액만 있고 수량이 없어서, 취소분 원가를 금액 비례로 덜어내는 근사다 —
 * 환불 금액을 master 별로 비례 배분하는 기존 파이프라인과 같은 정신.
 */
export function estimateCost(
  quantitySold: number,
  supplyPrice: number | null,
  grossRevenue: number,
  netRevenue: number,
): number | null {
  if (supplyPrice == null) {
    return null;
  }
  const fullCost = quantitySold * supplyPrice;
  if (grossRevenue <= 0) {
    return fullCost;
  }
  const ratio = Math.min(Math.max(netRevenue / grossRevenue, 0), 1);
  return Math.round(fullCost * ratio);
}

export function marginRateOf(margin: number | null, netRevenue: number): number | null {
  if (margin == null || netRevenue <= 0) {
    return null;
  }
  return margin / netRevenue;
}

function previousRange(from: string, to: string): { from: string; to: string } {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  const prevTo = new Date(fromDate.getTime() - 86_400_000);
  const prevFrom = new Date(prevTo.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(prevFrom), to: fmt(prevTo) };
}

const EMPTY_TOTALS: ProfitTotals = {
  grossRevenue: 0,
  cancelledAmount: 0,
  refundedAmount: 0,
  netRevenue: 0,
  quantitySold: 0,
  productsCount: 0,
  computedNetRevenue: 0,
  estimatedCost: 0,
  estimatedMargin: 0,
  marginRate: null,
  uncomputedNetRevenue: 0,
  uncomputedProductsCount: 0,
  costCoverageRate: null,
};

@Injectable()
export class ProfitQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getProfit(
    from: string,
    to: string,
    channel?: string,
    sort: ProfitSort = 'revenue',
    order: 'asc' | 'desc' = 'desc',
    page = 1,
    limit = 50,
  ): Promise<ProfitStatistics> {
    if (from > to) {
      throw new BadRequestError(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
    }
    const prev = previousRange(from, to);

    const [totals, previousTotals, series, pageResult] = await Promise.all([
      this.totals(from, to, channel),
      this.totals(prev.from, prev.to, channel),
      this.series(from, to, channel),
      this.pagedItems(from, to, channel, sort, order, page, limit),
    ]);

    return {
      range: { from, to },
      previousRange: prev,
      totals,
      previousTotals,
      series,
      items: pageResult.items,
      page,
      limit,
      totalItems: pageResult.totalItems,
    };
  }

  private rangeWhere(from: string, to: string, channel?: string): SQL | undefined {
    const parts: SQL[] = [gte(aggProductOrderDaily.aggDate, from), lte(aggProductOrderDaily.aggDate, to)];
    if (channel) {
      parts.push(eq(aggProductOrderDaily.salesChannel, channel));
    }
    return and(...parts);
  }

  /** 행 하나(그룹)의 순매출 비율 보정 원가 — SQL 판. estimateCost 와 같은 식이어야 한다. */
  private costExpr(qty: SQL, gross: SQL, net: SQL): SQL {
    return sql`ROUND(${qty} * ${dimProductMasters.supplyPrice} * CASE WHEN ${gross} > 0 THEN LEAST(GREATEST(${net}::numeric / ${gross}, 0), 1) ELSE 1 END)`;
  }

  private async totals(from: string, to: string, channel?: string): Promise<ProfitTotals> {
    const qty = sql`SUM(${aggProductOrderDaily.quantitySold})`;
    const gross = sql`SUM(${aggProductOrderDaily.grossRevenue})`;
    const net = sql`SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount})`;

    const perMaster = this.db
      .select({
        masterId: aggProductOrderDaily.masterId,
        quantitySold: sql<string>`${qty}`.as('quantity_sold'),
        grossRevenue: sql<string>`${gross}`.as('gross_revenue'),
        cancelledAmount: sql<string>`SUM(${aggProductOrderDaily.cancelledAmount})`.as('cancelled_amount'),
        refundedAmount: sql<string>`SUM(${aggProductOrderDaily.refundedAmount})`.as('refunded_amount'),
        netRevenue: sql<string>`${net}`.as('net_revenue'),
        supplyPrice: dimProductMasters.supplyPrice,
        estimatedCost: sql<string>`${this.costExpr(qty, gross, net)}`.as('estimated_cost'),
      })
      .from(aggProductOrderDaily)
      .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggProductOrderDaily.masterId))
      .where(this.rangeWhere(from, to, channel))
      .groupBy(aggProductOrderDaily.masterId, dimProductMasters.supplyPrice)
      .as('per_master');

    const rows = await this.db
      .select({
        grossRevenue: sql<string>`COALESCE(SUM(${perMaster.grossRevenue}), 0)`,
        cancelledAmount: sql<string>`COALESCE(SUM(${perMaster.cancelledAmount}), 0)`,
        refundedAmount: sql<string>`COALESCE(SUM(${perMaster.refundedAmount}), 0)`,
        netRevenue: sql<string>`COALESCE(SUM(${perMaster.netRevenue}), 0)`,
        quantitySold: sql<string>`COALESCE(SUM(${perMaster.quantitySold}), 0)`,
        productsCount: sql<string>`COUNT(*)`,
        computedNetRevenue: sql<string>`COALESCE(SUM(${perMaster.netRevenue}) FILTER (WHERE ${perMaster.supplyPrice} IS NOT NULL), 0)`,
        estimatedCost: sql<string>`COALESCE(SUM(${perMaster.estimatedCost}) FILTER (WHERE ${perMaster.supplyPrice} IS NOT NULL), 0)`,
        uncomputedNetRevenue: sql<string>`COALESCE(SUM(${perMaster.netRevenue}) FILTER (WHERE ${perMaster.supplyPrice} IS NULL), 0)`,
        uncomputedProductsCount: sql<string>`COUNT(*) FILTER (WHERE ${perMaster.supplyPrice} IS NULL)`,
      })
      .from(perMaster);

    const row = rows[0];
    if (!row || Number(row.productsCount) === 0) {
      return EMPTY_TOTALS;
    }

    const netRevenue = Number(row.netRevenue);
    const computedNetRevenue = Number(row.computedNetRevenue);
    const estimatedCost = Number(row.estimatedCost);
    const estimatedMargin = computedNetRevenue - estimatedCost;
    return {
      grossRevenue: Number(row.grossRevenue),
      cancelledAmount: Number(row.cancelledAmount),
      refundedAmount: Number(row.refundedAmount),
      netRevenue,
      quantitySold: Number(row.quantitySold),
      productsCount: Number(row.productsCount),
      computedNetRevenue,
      estimatedCost,
      estimatedMargin,
      marginRate: marginRateOf(estimatedMargin, computedNetRevenue),
      uncomputedNetRevenue: Number(row.uncomputedNetRevenue),
      uncomputedProductsCount: Number(row.uncomputedProductsCount),
      costCoverageRate: netRevenue > 0 ? computedNetRevenue / netRevenue : null,
    };
  }

  /** 일별 마진 추이 — 원가 있는 상품 부분만 cost/margin 에 반영된다. */
  private async series(from: string, to: string, channel?: string): Promise<ProfitSeriesPoint[]> {
    const qty = sql`SUM(${aggProductOrderDaily.quantitySold})`;
    const gross = sql`SUM(${aggProductOrderDaily.grossRevenue})`;
    const net = sql`SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount})`;

    const perMasterDay = this.db
      .select({
        aggDate: aggProductOrderDaily.aggDate,
        netRevenue: sql<string>`${net}`.as('net_revenue'),
        supplyPrice: dimProductMasters.supplyPrice,
        estimatedCost: sql<string>`${this.costExpr(qty, gross, net)}`.as('estimated_cost'),
      })
      .from(aggProductOrderDaily)
      .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggProductOrderDaily.masterId))
      .where(this.rangeWhere(from, to, channel))
      .groupBy(aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, dimProductMasters.supplyPrice)
      .as('per_master_day');

    const rows = await this.db
      .select({
        bucket: sql<string>`${perMasterDay.aggDate}::text`,
        netRevenue: sql<string>`COALESCE(SUM(${perMasterDay.netRevenue}), 0)`,
        computedNetRevenue: sql<string>`COALESCE(SUM(${perMasterDay.netRevenue}) FILTER (WHERE ${perMasterDay.supplyPrice} IS NOT NULL), 0)`,
        estimatedCost: sql<string>`COALESCE(SUM(${perMasterDay.estimatedCost}) FILTER (WHERE ${perMasterDay.supplyPrice} IS NOT NULL), 0)`,
      })
      .from(perMasterDay)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    return rows.map((row) => {
      const computedNetRevenue = Number(row.computedNetRevenue);
      const estimatedCost = Number(row.estimatedCost);
      return {
        bucket: row.bucket,
        netRevenue: Number(row.netRevenue),
        computedNetRevenue,
        estimatedCost,
        estimatedMargin: computedNetRevenue - estimatedCost,
      };
    });
  }

  private async pagedItems(
    from: string,
    to: string,
    channel: string | undefined,
    sort: ProfitSort,
    order: 'asc' | 'desc',
    page: number,
    limit: number,
  ): Promise<{ items: ProfitProductRow[]; totalItems: number }> {
    const where = this.rangeWhere(from, to, channel);

    const qty = sql`SUM(${aggProductOrderDaily.quantitySold})`;
    const gross = sql`SUM(${aggProductOrderDaily.grossRevenue})`;
    const net = sql`SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount})`;
    const cost = this.costExpr(qty, gross, net);
    const margin = sql`${net} - ${cost}`;

    const sortExpr =
      sort === 'quantity'
        ? qty
        : sort === 'margin'
          ? sql`CASE WHEN ${dimProductMasters.supplyPrice} IS NULL THEN NULL ELSE ${margin} END`
          : sort === 'marginRate'
            ? sql`CASE WHEN ${dimProductMasters.supplyPrice} IS NULL OR ${net} <= 0 THEN NULL ELSE (${margin})::numeric / ${net} END`
            : net;
    // 마진 정렬에서 "계산 불가" 행은 방향과 무관하게 항상 끝으로 보낸다
    const orderExpr = order === 'asc' ? sql`${sortExpr} ASC NULLS LAST` : sql`${sortExpr} DESC NULLS LAST`;

    const [countRows, rows] = await Promise.all([
      this.db
        .select({ value: sql<string>`COUNT(DISTINCT ${aggProductOrderDaily.masterId})` })
        .from(aggProductOrderDaily)
        .where(where),
      this.db
        .select({
          masterId: aggProductOrderDaily.masterId,
          name: dimProductMasters.name,
          quantitySold: sql<string>`${qty}`,
          grossRevenue: sql<string>`${gross}`,
          cancelledAmount: sql<string>`SUM(${aggProductOrderDaily.cancelledAmount})`,
          refundedAmount: sql<string>`SUM(${aggProductOrderDaily.refundedAmount})`,
          supplyPrice: dimProductMasters.supplyPrice,
        })
        .from(aggProductOrderDaily)
        .leftJoin(dimProductMasters, eq(dimProductMasters.masterId, aggProductOrderDaily.masterId))
        .where(where)
        .groupBy(aggProductOrderDaily.masterId, dimProductMasters.name, dimProductMasters.supplyPrice)
        .orderBy(orderExpr, sql`${aggProductOrderDaily.masterId} ASC`)
        .limit(limit)
        .offset((page - 1) * limit),
    ]);

    const items = rows.map((row) => {
      const quantitySold = Number(row.quantitySold);
      const grossRevenue = Number(row.grossRevenue);
      const cancelledAmount = Number(row.cancelledAmount);
      const refundedAmount = Number(row.refundedAmount);
      const netRevenue = grossRevenue - cancelledAmount - refundedAmount;
      const supplyPrice = row.supplyPrice ?? null;
      const estimatedCost = estimateCost(quantitySold, supplyPrice, grossRevenue, netRevenue);
      const estimatedMargin = estimatedCost == null ? null : netRevenue - estimatedCost;
      return {
        masterId: row.masterId,
        name: row.name ?? null,
        quantitySold,
        grossRevenue,
        cancelledAmount,
        refundedAmount,
        netRevenue,
        supplyPrice,
        estimatedCost,
        estimatedMargin,
        marginRate: marginRateOf(estimatedMargin, netRevenue),
      };
    });

    const nameless = items.filter((item) => !item.name).map((item) => item.masterId);
    if (nameless.length > 0) {
      const fallbackRows = await this.db
        .selectDistinctOn([factOrderItems.masterId], {
          masterId: factOrderItems.masterId,
          productName: factOrderItems.productName,
        })
        .from(factOrderItems)
        .where(and(inArray(factOrderItems.masterId, nameless), sql`${factOrderItems.productName} IS NOT NULL`))
        .orderBy(factOrderItems.masterId, sql`${factOrderItems.occurredAt} DESC`);
      const nameByMaster = new Map(fallbackRows.map((row) => [row.masterId, row.productName]));
      for (const item of items) {
        if (!item.name) {
          item.name = nameByMaster.get(item.masterId) ?? null;
        }
      }
    }

    return { items, totalItems: Number(countRows[0]?.value ?? 0) };
  }
}
