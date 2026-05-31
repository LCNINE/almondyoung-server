import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggUserProductPurchase } from '../../../schema';
import { DbTx } from '../../../db.types';
import { OrderItem } from '@packages/event-contracts/streams/orders.stream';

@Injectable()
export class UserPurchaseAggregatesService {
  private readonly logger = new Logger(UserPurchaseAggregatesService.name);

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
    customerId: string | null,
    items: OrderItem[],
    occurredAt: Date,
    tx?: DbTx,
  ): Promise<void> {
    if (!customerId || items.length === 0) {
      return;
    }

    const aggregated = new Map<
      string,
      {
        masterId: string;
        channelProductId: string;
        quantity: number;
      }
    >();

    for (const item of items) {
      const key = item.masterId;
      const current = aggregated.get(key);
      if (current) {
        current.quantity += item.quantity;
      } else {
        aggregated.set(key, {
          masterId: item.masterId,
          channelProductId: item.channelProductId,
          quantity: item.quantity,
        });
      }
    }

    await this.inTx(async (executor) => {
      const now = new Date();
      for (const item of aggregated.values()) {
        await executor
          .insert(aggUserProductPurchase)
          .values({
            customerId,
            masterId: item.masterId,
            channelProductId: item.channelProductId,
            purchaseCount: 1,
            totalQuantity: item.quantity,
            lastPurchasedAt: occurredAt,
            firstPurchasedAt: occurredAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggUserProductPurchase.customerId, aggUserProductPurchase.masterId],
            set: {
              purchaseCount: sql`${aggUserProductPurchase.purchaseCount} + 1`,
              totalQuantity: sql`${aggUserProductPurchase.totalQuantity} + ${item.quantity}`,
              lastPurchasedAt: occurredAt,
              updatedAt: now,
            },
          });
      }
    }, tx);

    this.logger.debug(`User purchase aggregates updated: ${customerId}, ${aggregated.size} products`);
  }
}
