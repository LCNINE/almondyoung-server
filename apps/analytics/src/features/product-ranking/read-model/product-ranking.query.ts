import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql, and } from 'drizzle-orm';
import {
  aggProductOrderDaily,
  analyticsSchema,
  dimProductCategories,
} from '../../../schema';
import { ProductOrderMetricDto } from '../api/dto';

const PRODUCT_RANKING_DAYS = 90;

@Injectable()
export class ProductRankingQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  async getProductRanking(categoryId?: string, limit: number = 10): Promise<ProductOrderMetricDto[]> {
    const startDate = this.toDateOnly(
      this.addUtcDays(new Date(), -(PRODUCT_RANKING_DAYS - 1)),
    );

    const baseWhere = sql`${aggProductOrderDaily.aggDate} >= ${startDate}::date`;

    const query = this.db
      .select({
        masterId: aggProductOrderDaily.masterId,
        ordersCount: sql<number>`SUM(${aggProductOrderDaily.ordersCount})`,
        quantitySold: sql<number>`SUM(${aggProductOrderDaily.quantitySold})`,
        lastOrderAt: sql<string>`MAX(${aggProductOrderDaily.aggDate})`,
      })
      .from(aggProductOrderDaily);

    if (categoryId) {
      query.innerJoin(
        dimProductCategories,
        and(
          sql`${dimProductCategories.masterId} = ${aggProductOrderDaily.masterId}`,
          sql`${dimProductCategories.categoryId} = ${categoryId}`,
        ),
      );
      query.where(baseWhere);
    } else {
      query.where(baseWhere);
    }

    const rows = await query
      .groupBy(aggProductOrderDaily.masterId)
      .orderBy(sql`SUM(${aggProductOrderDaily.ordersCount}) DESC`)
      .limit(limit);

    return rows.map((row) => ({
      masterId: row.masterId,
      ordersCount: Number(row.ordersCount ?? 0),
      quantitySold: Number(row.quantitySold ?? 0),
      lastOrderAt: this.toIsoDate(row.lastOrderAt),
    }));
  }

  private addUtcDays(date: Date, days: number): Date {
    const utc = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ));
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc;
  }

  private toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private toIsoDate(value: string | Date | null): string | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
