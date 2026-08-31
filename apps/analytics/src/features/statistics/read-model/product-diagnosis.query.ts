import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, desc, eq, gte, lte, sql, SQL } from 'drizzle-orm';
import {
  aggProductOrderDaily,
  aggVariantOrderDaily,
  analyticsSchema,
  dimProductMasters,
  dimProductVariants,
  factOrderItems,
} from '../../../schema';
import { previousRange } from './statistics.query';
import { estimateCost, marginRateOf, ProfitQuery, ProfitTotals } from './profit.query';

/** 상품 하나의 기간 판매 실적. 판매가 없으면 전부 0 이다 — 0 과 '조회 불가'를 구분하려고 null 을 쓰지 않는다. */
export interface DiagnosisSales {
  ordersCount: number;
  quantitySold: number;
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
  netRevenue: number;
  /** 직전 동일 길이 기간의 순매출 */
  previousNetRevenue: number;
}

/** 상품 하나의 마진. 공급가 미입력이면 supplyPrice 를 포함해 전부 null — '계산 불가'다. */
export interface DiagnosisMargin {
  supplyPrice: number | null;
  estimatedCost: number | null;
  estimatedMargin: number | null;
  /** 분모는 이 상품의 netRevenue. 전사 기준(computedNetRevenue)과 분모가 다르다. */
  marginRate: number | null;
}

export interface DiagnosisVariantRow {
  variantId: string;
  variantName: string | null;
  isDefault: boolean;
  quantitySold: number;
  /** 옵션 단위는 취소·환불 귀속 정보가 없어 총매출만 낸다 */
  grossRevenue: number;
}

export interface ProductDiagnosis {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  masterId: string;
  name: string | null;
  sales: DiagnosisSales;
  margin: DiagnosisMargin;
  /**
   * 전사 이익 요약 — 마진율 비교 기준. 이익 탭이 보여주는 값과 같은 계산이다.
   * `marginRate` 의 분모는 **원가가 입력된 상품 몫**(computedNetRevenue)이라
   * 상품 행 marginRate 와 분모가 다르다. 화면이 그 사실을 밝혀야 한다.
   */
  benchmark: ProfitTotals;
  variants: DiagnosisVariantRow[];
}

const EMPTY_SALES_ROW = {
  ordersCount: 0,
  quantitySold: 0,
  grossRevenue: 0,
  cancelledAmount: 0,
  refundedAmount: 0,
};

/**
 * 상품 단건 진단(카르테)이 쓰는 읽기 전용 read-model.
 *
 * 기존 `/statistics/products` · `/statistics/profit` 에 masterId 필터를 얹는 대신 라우트를 나눴다.
 * 이유 두 가지:
 *  1. 이익 통계의 `totals` 는 **전사 비교 기준**이라 masterId 로 좁히면 비교할 상대가 사라진다.
 *     "파라미터가 응답의 일부만 좁힌다"는 계약은 호출자가 틀리기 쉽다.
 *  2. 목록 라우트는 카테고리 구성·일별 추이처럼 단건 화면이 안 쓰는 전 구간 집계를 같이 돈다.
 *     단건을 위해 그걸 태우면 새 화면이 여는 즉시 없어도 될 비용이 붙는다.
 * 그 결과 기존 두 라우트의 코드 경로는 **한 줄도 바뀌지 않는다**.
 */
@Injectable()
export class ProductDiagnosisQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
    private readonly profitQuery: ProfitQuery,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getDiagnosis(masterId: string, from: string, to: string, channel?: string): Promise<ProductDiagnosis> {
    if (from > to) {
      throw new BadRequestError(`조회 기간이 뒤집혔습니다: ${from} > ${to}`);
    }
    const prev = previousRange(from, to);

    const [dimRows, salesRows, previousRows, variantRows, benchmark] = await Promise.all([
      this.db
        .select({ name: dimProductMasters.name, supplyPrice: dimProductMasters.supplyPrice })
        .from(dimProductMasters)
        .where(eq(dimProductMasters.masterId, masterId))
        .limit(1),
      this.masterTotals(masterId, from, to, channel),
      this.masterNetRevenue(masterId, prev.from, prev.to, channel),
      this.variantRows(masterId, from, to, channel),
      this.profitQuery.getTotals(from, to, channel),
    ]);

    const dim = dimRows[0];
    const name = dim?.name ?? (await this.latestOrderedProductName(masterId));
    const supplyPrice = dim?.supplyPrice ?? null;

    const sales: DiagnosisSales = {
      ...salesRows,
      netRevenue: salesRows.grossRevenue - salesRows.cancelledAmount - salesRows.refundedAmount,
      previousNetRevenue: previousRows,
    };
    const estimatedCost = estimateCost(sales.quantitySold, supplyPrice, sales.grossRevenue, sales.netRevenue);
    const estimatedMargin = estimatedCost == null ? null : sales.netRevenue - estimatedCost;

    return {
      range: { from, to },
      previousRange: prev,
      masterId,
      name,
      sales,
      margin: {
        supplyPrice,
        estimatedCost,
        estimatedMargin,
        marginRate: marginRateOf(estimatedMargin, sales.netRevenue),
      },
      benchmark,
      variants: variantRows,
    };
  }

  private masterWhere(masterId: string, from: string, to: string, channel?: string): SQL | undefined {
    const parts: SQL[] = [
      eq(aggProductOrderDaily.masterId, masterId),
      gte(aggProductOrderDaily.aggDate, from),
      lte(aggProductOrderDaily.aggDate, to),
    ];
    if (channel) {
      parts.push(eq(aggProductOrderDaily.salesChannel, channel));
    }
    return and(...parts);
  }

  private async masterTotals(
    masterId: string,
    from: string,
    to: string,
    channel?: string,
  ): Promise<typeof EMPTY_SALES_ROW> {
    const rows = await this.db
      .select({
        ordersCount: sql<string>`COALESCE(SUM(${aggProductOrderDaily.ordersCount}), 0)`,
        quantitySold: sql<string>`COALESCE(SUM(${aggProductOrderDaily.quantitySold}), 0)`,
        grossRevenue: sql<string>`COALESCE(SUM(${aggProductOrderDaily.grossRevenue}), 0)`,
        cancelledAmount: sql<string>`COALESCE(SUM(${aggProductOrderDaily.cancelledAmount}), 0)`,
        refundedAmount: sql<string>`COALESCE(SUM(${aggProductOrderDaily.refundedAmount}), 0)`,
      })
      .from(aggProductOrderDaily)
      .where(this.masterWhere(masterId, from, to, channel));
    const row = rows[0];
    if (!row) return { ...EMPTY_SALES_ROW };
    return {
      ordersCount: Number(row.ordersCount),
      quantitySold: Number(row.quantitySold),
      grossRevenue: Number(row.grossRevenue),
      cancelledAmount: Number(row.cancelledAmount),
      refundedAmount: Number(row.refundedAmount),
    };
  }

  private async masterNetRevenue(
    masterId: string,
    from: string,
    to: string,
    channel?: string,
  ): Promise<number> {
    const rows = await this.db
      .select({
        netRevenue: sql<string>`COALESCE(SUM(${aggProductOrderDaily.grossRevenue} - ${aggProductOrderDaily.cancelledAmount} - ${aggProductOrderDaily.refundedAmount}), 0)`,
      })
      .from(aggProductOrderDaily)
      .where(this.masterWhere(masterId, from, to, channel));
    return Number(rows[0]?.netRevenue ?? 0);
  }

  private async variantRows(
    masterId: string,
    from: string,
    to: string,
    channel?: string,
  ): Promise<DiagnosisVariantRow[]> {
    const parts: SQL[] = [
      eq(aggVariantOrderDaily.masterId, masterId),
      gte(aggVariantOrderDaily.aggDate, from),
      lte(aggVariantOrderDaily.aggDate, to),
    ];
    if (channel) {
      parts.push(eq(aggVariantOrderDaily.salesChannel, channel));
    }
    const rows = await this.db
      .select({
        variantId: aggVariantOrderDaily.variantId,
        variantName: dimProductVariants.variantName,
        isDefault: dimProductVariants.isDefault,
        quantitySold: sql<string>`SUM(${aggVariantOrderDaily.quantitySold})`,
        grossRevenue: sql<string>`SUM(${aggVariantOrderDaily.grossRevenue})`,
      })
      .from(aggVariantOrderDaily)
      .leftJoin(dimProductVariants, eq(dimProductVariants.variantId, aggVariantOrderDaily.variantId))
      .where(and(...parts))
      .groupBy(aggVariantOrderDaily.variantId, dimProductVariants.variantName, dimProductVariants.isDefault)
      .orderBy(sql`SUM(${aggVariantOrderDaily.grossRevenue}) DESC`, sql`${aggVariantOrderDaily.variantId} ASC`);

    return rows.map((row) => ({
      variantId: row.variantId,
      variantName: row.variantName ?? null,
      isDefault: row.isDefault ?? false,
      quantitySold: Number(row.quantitySold ?? 0),
      grossRevenue: Number(row.grossRevenue ?? 0),
    }));
  }

  /** dim 에 이름이 없는 상품(집계 가동 전 발행분)은 주문 라인이 실어온 최신 상품명으로 폴백한다. */
  private async latestOrderedProductName(masterId: string): Promise<string | null> {
    const rows = await this.db
      .select({ productName: factOrderItems.productName })
      .from(factOrderItems)
      .where(and(eq(factOrderItems.masterId, masterId), sql`${factOrderItems.productName} IS NOT NULL`))
      .orderBy(desc(factOrderItems.occurredAt))
      .limit(1);
    return rows[0]?.productName ?? null;
  }
}
