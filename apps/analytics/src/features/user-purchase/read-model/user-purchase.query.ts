import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { PaginatedResponseDto } from '@app/shared/dto';
import { desc, eq, sql } from 'drizzle-orm';
import { analyticsSchema, aggUserProductPurchase } from '../../../schema';
import { FrequentlyPurchasedDto } from '../api/dto';

@Injectable()
export class UserPurchaseQuery {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) { }

  private get db() {
    return this.dbService.db;
  }

  async getFrequentlyPurchased(
    customerId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponseDto<FrequentlyPurchasedDto>> {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
    const offset = (safePage - 1) * safeLimit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          masterId: aggUserProductPurchase.masterId,
          channelProductId: aggUserProductPurchase.channelProductId,
          purchaseCount: aggUserProductPurchase.purchaseCount,
          totalQuantity: aggUserProductPurchase.totalQuantity,
          lastPurchasedAt: aggUserProductPurchase.lastPurchasedAt,
        })
        .from(aggUserProductPurchase)
        .where(eq(aggUserProductPurchase.customerId, customerId))
        .orderBy(desc(aggUserProductPurchase.purchaseCount))
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(aggUserProductPurchase)
        .where(eq(aggUserProductPurchase.customerId, customerId)),
    ]);

    const data: FrequentlyPurchasedDto[] = rows.map((row) => ({
      masterId: row.masterId,
      channelProductId: row.channelProductId,
      purchaseCount: row.purchaseCount,
      totalQuantity: row.totalQuantity,
      lastPurchasedAt: row.lastPurchasedAt?.toISOString() ?? null,
    }));

    return {
      data,
      total: totalRows[0]?.count ?? 0,
      page: safePage,
      limit: safeLimit,
    };
  }
}
