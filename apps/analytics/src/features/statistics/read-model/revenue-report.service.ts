import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, desc, gte, lt, lte, sql } from 'drizzle-orm';
import {
  aggChannelDaily,
  analyticsSchema,
  externalRevenueMonthly,
  externalRevenueHistory,
  factOrderItems,
} from '../../../schema';
import { seoulDayStart } from '../../../shared/date.util';
import type { ExternalRevenueRowDto } from '../api/revenue-report.controller';

@Injectable()
export class RevenueReportService {
  constructor(@InjectTypedDb<typeof analyticsSchema>() private readonly database: DbService<typeof analyticsSchema>) {}

  async get(year: number) {
    const [daily, external, history] = await Promise.all([
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
      this.database.db
        .select()
        .from(externalRevenueHistory)
        .where(
          sql`exists (select 1 from jsonb_array_elements(${externalRevenueHistory.after}) r where r->>'month' between ${`${year}-01`} and ${`${year}-12`})`,
        )
        .orderBy(desc(externalRevenueHistory.recordedAt))
        .limit(50),
    ]);

    return { history, year, extractedAt: new Date().toISOString(), daily, external };
  }

  async import(rows: ExternalRevenueRowDto[], recordedBy?: string) {
    await this.database.db.transaction(async (tx) => {
      // Serialize imports so the retained before-image matches the replaced values.
      await tx.execute(sql`select pg_advisory_xact_lock(724358, 1)`);
      const before = await tx.select().from(externalRevenueMonthly);
      const values = rows.map((row) => ({
        ...row,
        originalStatus: row.originalStatus ?? 'pending',
        monthlyStatus: row.monthlyStatus ?? 'pending',
        duplicateStatus: row.duplicateStatus ?? 'pending',
        settlementStatus: row.settlementStatus ?? 'pending',
        reviewNote: row.reviewNote?.trim() ?? '',
      }));
      const key = (row: ExternalRevenueRowDto) => JSON.stringify([row.channel, row.account, row.month, row.basis]);
      const keys = new Set(values.map(key));
      await tx
        .insert(externalRevenueHistory)
        .values({ recordedBy, before: before.filter((row) => keys.has(key(row))), after: values });
      await tx
        .insert(externalRevenueMonthly)
        .values(values)
        .onConflictDoUpdate({
          target: [
            externalRevenueMonthly.channel,
            externalRevenueMonthly.account,
            externalRevenueMonthly.month,
            externalRevenueMonthly.basis,
          ],
          set: {
            amount: sql`excluded.amount`,
            source: sql`excluded.source`,
            updatedAt: new Date(),
            originalStatus: sql`excluded.original_status`,
            monthlyStatus: sql`excluded.monthly_status`,
            duplicateStatus: sql`excluded.duplicate_status`,
            settlementStatus: sql`excluded.settlement_status`,
            reviewNote: sql`excluded.review_note`,
          },
        });
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
