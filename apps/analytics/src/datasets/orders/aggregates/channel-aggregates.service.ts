import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggChannelDaily } from '../../../schema';
import { DbTx } from '../../../db.types';
import { ChannelAggregateSeed } from '../facts/order-types';

type ChannelIncrement = {
  ordersCount: number;
  grossRevenue: number;
  cancelledAmount: number;
  refundedAmount: number;
};

const ZERO: ChannelIncrement = {
  ordersCount: 0,
  grossRevenue: 0,
  cancelledAmount: 0,
  refundedAmount: 0,
};

@Injectable()
export class ChannelAggregatesService {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  async applyOrderCreated(seed: ChannelAggregateSeed, tx?: DbTx): Promise<void> {
    await this.upsert(
      seed.occurredDate,
      seed.salesChannel,
      {
        ...ZERO,
        ordersCount: seed.ordersCount,
        grossRevenue: seed.grossRevenue,
      },
      tx,
    );
  }

  async applyCancellation(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void> {
    await this.upsert(occurredDate, salesChannel, { ...ZERO, cancelledAmount: amount }, tx);
  }

  async applyRefund(occurredDate: string, salesChannel: string, amount: number, tx?: DbTx): Promise<void> {
    await this.upsert(occurredDate, salesChannel, { ...ZERO, refundedAmount: amount }, tx);
  }

  private async upsert(aggDate: string, salesChannel: string, increment: ChannelIncrement, tx?: DbTx): Promise<void> {
    return this.dbService.run(async (trx) => {
      const now = new Date();
      await trx
        .insert(aggChannelDaily)
        .values({ aggDate, salesChannel, ...increment, updatedAt: now })
        .onConflictDoUpdate({
          target: [aggChannelDaily.aggDate, aggChannelDaily.salesChannel],
          set: {
            ordersCount: sql`${aggChannelDaily.ordersCount} + ${increment.ordersCount}`,
            grossRevenue: sql`${aggChannelDaily.grossRevenue} + ${increment.grossRevenue}`,
            cancelledAmount: sql`${aggChannelDaily.cancelledAmount} + ${increment.cancelledAmount}`,
            refundedAmount: sql`${aggChannelDaily.refundedAmount} + ${increment.refundedAmount}`,
            updatedAt: now,
          },
        });
    }, tx);
  }
}
