import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import * as schema from '../../shared/schemas/entities/schema';
import { and, between, eq, sql } from 'drizzle-orm';
import { startOfMonth, endOfMonth, parseISO } from 'date-fns';

export interface MonthlySavingsResult {
  totalSavings: number;
  orderCount: number;
  period: {
    startDate: Date;
    endDate: Date;
  };
}

export interface RangeSavingsResult {
  totalSavings: number;
  orderCount: number;
  period: {
    startDate: Date;
    endDate: Date;
  };
  monthlyBreakdown: Array<{
    yearMonth: string;
    savings: number;
    orderCount: number;
  }>;
}

/**
 * SavingsReader (Implementation Layer)
 *
 * 역할: 월별 절약액 데이터 조회
 * - 월별 절약액 조회
 * - 기간별 절약액 조회
 * - 월별 breakdown 조회
 */
@Injectable()
export class SavingsReader {
  constructor(private readonly dbService: DbService<typeof membershipSchema>) {}

  /**
   * 월별 절약액 조회
   *
   * @param userId - 사용자 ID
   * @param yearMonth - 조회할 년월 (YYYY-MM 형식)
   * @returns 월별 절약액 및 주문 건수
   */
  async getMonthSavings(
    userId: string,
    yearMonth: string,
  ): Promise<MonthlySavingsResult> {
    const targetDate = parseISO(`${yearMonth}-01`);
    const startDate = startOfMonth(targetDate);
    const endDate = endOfMonth(targetDate);

    const result = await this.dbService.db
      .select({
        totalSavings: sql<number>`COALESCE(SUM(${schema.membershipDiscountEvents.discountAmount}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.userId, userId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
          between(
            schema.membershipDiscountEvents.orderDate,
            startDate,
            endDate,
          ),
        ),
      );

    return {
      totalSavings: Number(result[0]?.totalSavings ?? 0),
      orderCount: Number(result[0]?.orderCount ?? 0),
      period: {
        startDate,
        endDate,
      },
    };
  }

  /**
   * 기간별 절약액 조회
   *
   * @param userId - 사용자 ID
   * @param startDate - 시작일
   * @param endDate - 종료일
   * @returns 기간별 절약액, 주문 건수, 월별 breakdown
   */
  async getRangeSavings(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<RangeSavingsResult> {
    // 전체 합계
    const totalResult = await this.dbService.db
      .select({
        totalSavings: sql<number>`COALESCE(SUM(${schema.membershipDiscountEvents.discountAmount}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.userId, userId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
          between(
            schema.membershipDiscountEvents.orderDate,
            startDate,
            endDate,
          ),
        ),
      );

    // 월별 breakdown
    const monthlyResult = await this.dbService.db
      .select({
        yearMonth: sql<string>`TO_CHAR(${schema.membershipDiscountEvents.orderDate}, 'YYYY-MM')`,
        savings: sql<number>`COALESCE(SUM(${schema.membershipDiscountEvents.discountAmount}), 0)`,
        orderCount: sql<number>`COUNT(*)`,
      })
      .from(schema.membershipDiscountEvents)
      .where(
        and(
          eq(schema.membershipDiscountEvents.userId, userId),
          eq(schema.membershipDiscountEvents.isCancelled, false),
          between(
            schema.membershipDiscountEvents.orderDate,
            startDate,
            endDate,
          ),
        ),
      )
      .groupBy(
        sql`TO_CHAR(${schema.membershipDiscountEvents.orderDate}, 'YYYY-MM')`,
      )
      .orderBy(
        sql`TO_CHAR(${schema.membershipDiscountEvents.orderDate}, 'YYYY-MM')`,
      );

    return {
      totalSavings: Number(totalResult[0]?.totalSavings ?? 0),
      orderCount: Number(totalResult[0]?.orderCount ?? 0),
      period: { startDate, endDate },
      monthlyBreakdown: monthlyResult.map((row) => ({
        yearMonth: row.yearMonth,
        savings: Number(row.savings),
        orderCount: Number(row.orderCount),
      })),
    };
  }
}
