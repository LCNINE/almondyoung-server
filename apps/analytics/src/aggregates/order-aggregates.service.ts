import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggProductOrderDaily } from '../schema';
import { DbTx } from '../db.types';
import { OrderAggregateSeed } from '../facts/order-types';

@Injectable()
export class OrderAggregatesService {
  private readonly logger = new Logger(OrderAggregatesService.name);

  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  private get db() {
    return this.dbService.db;
  }

  private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  async applyOrderCreated(
    seeds: OrderAggregateSeed[],
    tx?: DbTx,
  ): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    const increments = new Map<
      string,
      { aggDate: string; masterId: string; salesChannel: string; count: number }
    >();

    for (const seed of seeds) {
      const key = `${seed.occurredDate}|${seed.salesChannel}|${seed.masterId}`;
      const current = increments.get(key);
      if (current) {
        current.count += 1;
      } else {
        increments.set(key, {
          aggDate: seed.occurredDate,
          masterId: seed.masterId,
          salesChannel: seed.salesChannel,
          count: 1,
        });
      }
    }

    await this.inTx(async (executor) => {
      const now = new Date();
      for (const increment of increments.values()) {
        await executor
          .insert(aggProductOrderDaily)
          .values({
            aggDate: increment.aggDate,
            masterId: increment.masterId,
            salesChannel: increment.salesChannel,
            ordersCount: increment.count,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              aggProductOrderDaily.aggDate,
              aggProductOrderDaily.masterId,
              aggProductOrderDaily.salesChannel,
            ],
            set: {
              ordersCount: sql`${aggProductOrderDaily.ordersCount} + ${increment.count}`,
              updatedAt: now,
            },
          });
      }
    }, tx);

    this.logger.debug(
      `OrderCreated aggregates updated: ${increments.size} rows`,
    );
  }
}
