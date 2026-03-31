import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { desc, eq } from 'drizzle-orm';
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
    limit: number = 20,
  ): Promise<FrequentlyPurchasedDto[]> {
    const rows = await this.db
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
      .limit(limit);

    return rows.map((row) => ({
      masterId: row.masterId,
      channelProductId: row.channelProductId,
      purchaseCount: row.purchaseCount,
      totalQuantity: row.totalQuantity,
      lastPurchasedAt: row.lastPurchasedAt?.toISOString() ?? null,
    }));
  }
}
