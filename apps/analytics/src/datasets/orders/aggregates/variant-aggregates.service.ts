import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggVariantOrderDaily } from '../../../schema';
import { DbTx } from '../../../db.types';
import { VariantAggregateSeed } from '../facts/order-types';

@Injectable()
export class VariantAggregatesService {
  private readonly logger = new Logger(VariantAggregatesService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  async applyOrderCreated(seeds: VariantAggregateSeed[], tx?: DbTx): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    await this.dbService.run(async (trx) => {
      const now = new Date();
      for (const seed of seeds) {
        await trx
          .insert(aggVariantOrderDaily)
          .values({
            aggDate: seed.occurredDate,
            variantId: seed.variantId,
            masterId: seed.masterId,
            salesChannel: seed.salesChannel,
            quantitySold: seed.quantitySold,
            grossRevenue: seed.revenue,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggVariantOrderDaily.aggDate, aggVariantOrderDaily.variantId, aggVariantOrderDaily.salesChannel],
            set: {
              quantitySold: sql`${aggVariantOrderDaily.quantitySold} + ${seed.quantitySold}`,
              grossRevenue: sql`${aggVariantOrderDaily.grossRevenue} + ${seed.revenue}`,
              updatedAt: now,
            },
          });
      }
      this.logger.debug(`Variant aggregates updated: ${seeds.length} rows`);
    }, tx);
  }
}
