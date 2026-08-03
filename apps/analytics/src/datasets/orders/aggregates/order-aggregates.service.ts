import { Injectable, Logger } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggProductOrderDaily } from '../../../schema';
import { DbTx } from '../../../db.types';
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

  async applyOrderCreated(seeds: OrderAggregateSeed[], tx?: DbTx): Promise<void> {
    if (seeds.length === 0) {
      return;
    }

    const increments = new Map<
      string,
      {
        aggDate: string;
        masterId: string;
        salesChannel: string;
        ordersCount: number;
        quantitySold: number;
        grossRevenue: number;
      }
    >();

    for (const seed of seeds) {
      const key = `${seed.occurredDate}|${seed.salesChannel}|${seed.masterId}`;
      const current = increments.get(key);
      if (current) {
        current.ordersCount += seed.orderCount;
        current.quantitySold += seed.quantitySold;
        current.grossRevenue += seed.revenue;
      } else {
        increments.set(key, {
          aggDate: seed.occurredDate,
          masterId: seed.masterId,
          salesChannel: seed.salesChannel,
          ordersCount: seed.orderCount,
          quantitySold: seed.quantitySold,
          grossRevenue: seed.revenue,
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
            ordersCount: increment.ordersCount,
            quantitySold: increment.quantitySold,
            grossRevenue: increment.grossRevenue,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, aggProductOrderDaily.salesChannel],
            set: {
              ordersCount: sql`${aggProductOrderDaily.ordersCount} + ${increment.ordersCount}`,
              quantitySold: sql`${aggProductOrderDaily.quantitySold} + ${increment.quantitySold}`,
              grossRevenue: sql`${aggProductOrderDaily.grossRevenue} + ${increment.grossRevenue}`,
              updatedAt: now,
            },
          });
      }
    }, tx);

    this.logger.debug(`OrderCreated aggregates updated: ${increments.size} rows`);
  }

  async applyCancellation(
    occurredDate: string,
    salesChannel: string,
    masterAmounts: Array<{ masterId: string; amount: number }>,
    tx?: DbTx,
  ): Promise<void> {
    if (masterAmounts.length === 0) {
      return;
    }

    await this.inTx(async (executor) => {
      const now = new Date();
      for (const { masterId, amount } of masterAmounts) {
        await executor
          .insert(aggProductOrderDaily)
          .values({
            aggDate: occurredDate,
            masterId,
            salesChannel,
            ordersCount: 0,
            quantitySold: 0,
            cancelledAmount: amount,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, aggProductOrderDaily.salesChannel],
            set: {
              cancelledAmount: sql`${aggProductOrderDaily.cancelledAmount} + ${amount}`,
              updatedAt: now,
            },
          });
      }
    }, tx);

    this.logger.debug(`OrderCancelled aggregates updated: ${masterAmounts.length} rows`);
  }

  /**
   * 환불액을 상품 단위 `refundedAmount` 에 누적한다.
   *
   * `applyCancellation` 과 같은 모양이고 컬럼만 다르다. 이 메서드가 생기기 전까지
   * `agg_product_order_daily.refundedAmount` 는 **컬럼만 있고 쓰는 곳이 없었다** —
   * 채널 단위(`agg_channel_daily`)만 환불을 반영해서, 상품 순매출은 환불을 빼먹고
   * 채널 순매출은 반영하는 상태였다. 두 테이블이 정확히 환불 총액만큼 어긋난다.
   *
   * `grossRevenue` 는 여기서도 건드리지 않는다 — 총매출은 감액하지 않고 감액분을 별도
   * 컬럼에 쌓아 조회 시점에 빼는 것이 이 스키마의 규약이다.
   */
  async applyRefund(
    occurredDate: string,
    salesChannel: string,
    masterAmounts: Array<{ masterId: string; amount: number }>,
    tx?: DbTx,
  ): Promise<void> {
    if (masterAmounts.length === 0) {
      return;
    }

    await this.inTx(async (executor) => {
      const now = new Date();
      for (const { masterId, amount } of masterAmounts) {
        await executor
          .insert(aggProductOrderDaily)
          .values({
            aggDate: occurredDate,
            masterId,
            salesChannel,
            ordersCount: 0,
            quantitySold: 0,
            refundedAmount: amount,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [aggProductOrderDaily.aggDate, aggProductOrderDaily.masterId, aggProductOrderDaily.salesChannel],
            set: {
              refundedAmount: sql`${aggProductOrderDaily.refundedAmount} + ${amount}`,
              updatedAt: now,
            },
          });
      }
    }, tx);

    this.logger.debug(`OrderRefundCreated aggregates updated: ${masterAmounts.length} rows`);
  }
}
