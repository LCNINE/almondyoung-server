import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, gte, lt, lte, sql } from 'drizzle-orm';
import { aggChannelDaily, analyticsSchema, externalRevenueMonthly, factOrderItems } from '../../../schema';
import { seoulDayStart } from '../../../shared/date.util';
import type { ExternalRevenueRowDto } from '../api/revenue-report.controller';

@Injectable()
export class RevenueReportService {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly database: DbService<typeof analyticsSchema>) {}

  async get(year: number) {
    const [daily, external] = await Promise.all([
      this.database.db
        .select({
          date: aggChannelDaily.aggDate,
          channel: aggChannelDaily.salesChannel,
          orders: aggChannelDaily.ordersCount,
          gross: aggChannelDaily.grossRevenue,
          cancelled: aggChannelDaily.cancelledAmount,
          refunded: aggChannelDaily.refundedAmount,
        })
        .from(aggChannelDaily)
        .where(and(gte(aggChannelDaily.aggDate, `${year}-01-01`), lte(aggChannelDaily.aggDate, `${year}-12-31`)))
        .orderBy(asc(aggChannelDaily.aggDate), asc(aggChannelDaily.salesChannel)),
      this.database.db
        .select()
        .from(externalRevenueMonthly)
        .where(and(gte(externalRevenueMonthly.month, `${year}-01`), lte(externalRevenueMonthly.month, `${year}-12`)))
        .orderBy(asc(externalRevenueMonthly.month), asc(externalRevenueMonthly.channel)),
    ]);

    return { year, extractedAt: new Date().toISOString(), daily, external };
  }

  async import(rows: ExternalRevenueRowDto[]) {
    // One atomic upsert. Re-uploading the same report replaces its monthly values instead of adding sales twice.
    await this.database.db
      .insert(externalRevenueMonthly)
      .values(rows)
      .onConflictDoUpdate({
        target: [
          externalRevenueMonthly.channel,
          externalRevenueMonthly.account,
          externalRevenueMonthly.month,
          externalRevenueMonthly.basis,
        ],
        set: { amount: sql`excluded.amount`, source: sql`excluded.source`, updatedAt: new Date() },
      });

    return { imported: rows.length };
  }

  async raw(year: number, page: number) {
    const limit = 1000;
    const rows = await this.database.db
      .select({
        id: factOrderItems.id,
        occurredAt: factOrderItems.occurredAt,
        channel: factOrderItems.salesChannel,
        orderKey: factOrderItems.orderKey,
        orderId: factOrderItems.orderId,
        externalOrderId: factOrderItems.externalOrderId,
        orderItemId: factOrderItems.orderItemId,
        productName: factOrderItems.productName,
        quantity: factOrderItems.quantity,
        unitPrice: factOrderItems.unitPrice,
        totalPrice: factOrderItems.totalPrice,
        currency: factOrderItems.currency,
      })
      .from(factOrderItems)
      .where(
        and(
          gte(factOrderItems.occurredAt, seoulDayStart(`${year}-01-01`)),
          lt(factOrderItems.occurredAt, seoulDayStart(`${year + 1}-01-01`)),
        ),
      )
      .orderBy(asc(factOrderItems.id))
      .limit(limit + 1)
      .offset(page * limit);

    return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
  }
}
